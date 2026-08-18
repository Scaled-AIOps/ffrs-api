import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import { capture, CaptureError } from './domain/feedback.js';
import { REF_PATTERN, newRef } from './domain/ref.js';
import type { BlobStore, FeedbackRepo } from './domain/repo.js';
import { FeedbackInput } from './domain/schema.js';
import { githubTransition, verifyGithubSignature } from './domain/webhook.js';
import { isHoneypotTripped } from './guards/honeypot.js';
import type { RateLimiter } from './guards/rateLimit.js';
import type { TurnstileVerify } from './guards/turnstile.js';
import { clientIp, corsHeaders, error, header, isForm, json, parseBody, redirect, type Res } from './http.js';
import { log } from './log.js';

/** Everything the HTTP app needs, injected — so tests build it with memory implementations. */
export interface AppDeps {
  cfg: Config;
  repo: FeedbackRepo;
  blobs?: BlobStore;
  rateLimiter: RateLimiter;
  turnstile?: TurnstileVerify;
  isEnabled: () => Promise<boolean>;
}

const POST_FEEDBACK = /^\/api\/feedback\/?$/;
const GET_FEEDBACK = /^\/api\/feedback\/(FB-[A-Z0-9]{6})\/?$/;
const GITHUB_WEBHOOK = /^\/api\/webhooks\/github\/?$/;

export function createApp(deps: AppDeps): (evt: APIGatewayProxyEventV2) => Promise<Res> {
  return async (evt) => {
    const cors = corsHeaders(evt, deps.cfg.allowedOrigins);
    const { method, path } = evt.requestContext.http;
    const withCors = (r: Res): Res => ({ ...r, headers: { ...r.headers, ...cors } });

    try {
      if (method === 'OPTIONS') return withCors({ statusCode: 204, headers: {} });
      if (method === 'POST' && POST_FEEDBACK.test(path)) return withCors(await postFeedback(deps, evt));
      if (method === 'POST' && GITHUB_WEBHOOK.test(path) && deps.cfg.GITHUB_WEBHOOK_SECRET) return githubWebhook(deps, evt, deps.cfg.GITHUB_WEBHOOK_SECRET);
      if (method === 'GET') {
        const ref = GET_FEEDBACK.exec(path)?.[1];
        if (ref) return withCors(await getFeedback(deps, ref));
      }
      return withCors(error(404, 'not_found', 'no such route'));
    } catch (err) {
      log('error', 'unhandled', { path, err: err instanceof Error ? err.stack : String(err) });
      return withCors(error(500, 'internal', 'internal error'));
    }
  };
}

async function postFeedback(deps: AppDeps, evt: APIGatewayProxyEventV2): Promise<Res> {
  // No-JS path: the /feedback/ page posts a form; answer with a redirect back to it instead of JSON.
  if (isForm(evt)) {
    const res = await postFeedbackJson(deps, evt);
    const page = `${deps.cfg.SITE_URL}/feedback/`;
    const body = JSON.parse(res.body ?? '{}') as { ref?: string; error?: { message?: string; details?: Array<{ path: string; message: string }> } };
    if (body.ref) return redirect(`${page}?sent=1&ref=${body.ref}`);
    const msg = body.error?.details?.map((d) => `${d.path}: ${d.message}`).join('; ') ?? body.error?.message ?? 'unknown error';
    return redirect(`${page}?error=${encodeURIComponent(msg)}`);
  }
  return postFeedbackJson(deps, evt);
}

async function postFeedbackJson(deps: AppDeps, evt: APIGatewayProxyEventV2): Promise<Res> {
  if (!(await deps.isEnabled())) return error(503, 'ffrs_disabled', 'feedback is temporarily disabled');

  const ip = clientIp(evt);
  if (!deps.rateLimiter.allow(ip)) return error(429, 'rate_limited', 'too many submissions, try again in a minute', undefined);

  let input: FeedbackInput;
  try {
    input = FeedbackInput.parse(parseBody(evt));
  } catch (err) {
    if (err instanceof ZodError) return error(400, 'invalid_input', 'validation failed', err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    if (err instanceof SyntaxError) return error(400, 'invalid_json', 'body must be JSON');
    throw err;
  }

  // Bots get a convincing 202 and nothing is stored.
  if (isHoneypotTripped(input)) {
    log('info', 'honeypot', { ip_hash: ip.length }); // never log the IP itself
    return json(202, { ref: newRef(), status: 'received' });
  }

  if (deps.turnstile) {
    if (!input.turnstileToken) return error(400, 'turnstile_required', 'missing turnstile token');
    if (!(await deps.turnstile(input.turnstileToken, ip))) return error(403, 'turnstile_failed', 'human verification failed');
  }

  try {
    const idem = header(evt, 'idempotency-key');
    const result = await capture({ repo: deps.repo, ...(deps.blobs ? { blobs: deps.blobs } : {}) }, input, {
      ...(idem ? { idempotencyKey: idem } : {}),
      ...(header(evt, 'user-agent') ? { userAgent: header(evt, 'user-agent')! } : {}),
    });
    log('info', result.created ? 'captured' : 'idempotent_replay', { ref: result.ref, kind: input.kind, screenshot: Boolean(input.screenshot) });
    return json(result.created ? 202 : 200, { ref: result.ref, status: 'received' });
  } catch (err) {
    if (err instanceof CaptureError) return error(400, err.code, err.message);
    throw err;
  }
}

async function getFeedback(deps: AppDeps, ref: string): Promise<Res> {
  if (!REF_PATTERN.test(ref)) return error(404, 'not_found', 'unknown reference');
  const row = await deps.repo.findByRef(ref);
  if (!row) return error(404, 'not_found', 'unknown reference');
  // Public view: status timeline only — never body, email or screenshot.
  return json(200, {
    ref: row.ref,
    kind: row.kind,
    status: row.status,
    outcome: row.outcome,
    githubIssueUrl: row.githubIssueUrl,
    createdAt: row.createdAt,
    acknowledgedAt: row.acknowledgedAt,
    routedAt: row.routedAt,
    respondedAt: row.respondedAt,
    closedAt: row.closedAt,
  });
}

async function githubWebhook(deps: AppDeps, evt: APIGatewayProxyEventV2, secret: string): Promise<Res> {
  const raw = evt.isBase64Encoded ? Buffer.from(evt.body ?? '', 'base64').toString('utf8') : (evt.body ?? '');
  if (!verifyGithubSignature(secret, raw, header(evt, 'x-hub-signature-256'))) return error(401, 'bad_signature', 'signature mismatch');
  const event = header(evt, 'x-github-event') ?? '';
  let t;
  try {
    t = githubTransition(event, JSON.parse(raw), new Date());
  } catch (err) {
    if (err instanceof ZodError || err instanceof SyntaxError) return error(400, 'invalid_payload', 'unrecognised webhook payload');
    throw err;
  }
  if (!t) return json(200, { ignored: true });
  const row = await deps.repo.findByIssueUrl(t.issueUrl);
  if (!row) return json(200, { ignored: true, reason: 'not an FFRS issue' });
  const patch = t.patch(row);
  const effects = t.effects(row);
  await deps.repo.update(row.id, patch, effects);
  log('info', 'webhook_applied', { ref: row.ref, event, patch: Object.keys(patch), effects });
  return json(200, { ref: row.ref, ...patch });
}
