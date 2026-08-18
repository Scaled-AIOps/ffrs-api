import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import { capture, type CaptureDeps } from './domain/feedback.js';
import { REF_PATTERN, newRef } from './domain/ref.js';
import { FeedbackInput } from './domain/schema.js';
import { statusOf } from './domain/status.js';
import { handleGithubEvent, verifyGithubSignature } from './domain/webhook.js';
import { isHoneypotTripped } from './guards/honeypot.js';
import type { RateLimiter } from './guards/rateLimit.js';
import type { TurnstileVerify } from './guards/turnstile.js';
import { clientIp, corsHeaders, error, header, isForm, json, parseBody, redirect, type Res } from './http.js';
import { log } from './log.js';

/** Everything the HTTP app needs, injected — tests build it with in-memory adapters. */
export interface AppDeps extends CaptureDeps {
  cfg: Config;
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
  if (!isForm(evt)) return postFeedbackJson(deps, evt);
  // No-JS path: the /feedback/ page posts a form; answer with a redirect back to it instead of JSON.
  const res = await postFeedbackJson(deps, evt);
  const page = `${deps.cfg.SITE_URL}/feedback/`;
  const body = JSON.parse(res.body ?? '{}') as { ref?: string; error?: { message?: string; details?: Array<{ path: string; message: string }> } };
  if (body.ref) return redirect(`${page}?sent=1&ref=${body.ref}`);
  const msg = body.error?.details?.map((d) => `${d.path}: ${d.message}`).join('; ') ?? body.error?.message ?? 'unknown error';
  return redirect(`${page}?error=${encodeURIComponent(msg)}`);
}

async function postFeedbackJson(deps: AppDeps, evt: APIGatewayProxyEventV2): Promise<Res> {
  if (!(await deps.isEnabled())) return error(503, 'ffrs_disabled', 'feedback is temporarily disabled');
  const ip = clientIp(evt);
  if (!deps.rateLimiter.allow(ip)) return error(429, 'rate_limited', 'too many submissions, try again in a minute');

  let input: FeedbackInput;
  try {
    input = FeedbackInput.parse(parseBody(evt));
  } catch (err) {
    if (err instanceof ZodError) return error(400, 'invalid_input', 'validation failed', err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    if (err instanceof SyntaxError) return error(400, 'invalid_json', 'body must be JSON');
    throw err;
  }
  if (isHoneypotTripped(input)) { log('info', 'honeypot', {}); return json(202, { ref: newRef(), status: 'received' }); } // bots get a convincing 202
  if (deps.turnstile) {
    if (!input.turnstileToken) return error(400, 'turnstile_required', 'missing turnstile token');
    if (!(await deps.turnstile(input.turnstileToken, ip))) return error(403, 'turnstile_failed', 'human verification failed');
  }

  const idem = header(evt, 'idempotency-key'), ua = header(evt, 'user-agent');
  try {
    const r = await capture(deps, input, { ...(idem ? { idempotencyKey: idem } : {}), ...(ua ? { userAgent: ua } : {}) });
    log('info', r.created ? 'captured' : 'idempotent_replay', { ref: r.ref, kind: input.kind, screenshot: Boolean(input.screenshot), issue: r.issueUrl });
    return json(r.created ? 202 : 200, { ref: r.ref, status: 'received' });
  } catch (err) {
    // GitHub is the store: if it is down we cannot accept — say so honestly; the widget retries with the same key.
    log('error', 'capture_failed', { err: String(err) });
    return error(502, 'route_failed', 'could not file your feedback right now — please retry in a minute');
  }
}

async function getFeedback(deps: AppDeps, ref: string): Promise<Res> {
  if (!REF_PATTERN.test(ref)) return error(404, 'not_found', 'unknown reference');
  const s = await deps.store.getSidecar(ref);
  const view = s ? await statusOf(deps.tracker, s) : undefined;
  return view ? json(200, view) : error(404, 'not_found', 'unknown reference');
}

async function githubWebhook(deps: AppDeps, evt: APIGatewayProxyEventV2, secret: string): Promise<Res> {
  const raw = evt.isBase64Encoded ? Buffer.from(evt.body ?? '', 'base64').toString('utf8') : (evt.body ?? '');
  if (!verifyGithubSignature(secret, raw, header(evt, 'x-hub-signature-256'))) return error(401, 'bad_signature', 'signature mismatch');
  try {
    const out = await handleGithubEvent(deps, header(evt, 'x-github-event') ?? '', JSON.parse(raw));
    log('info', 'webhook', out);
    return json(200, out);
  } catch (err) {
    if (err instanceof ZodError || err instanceof SyntaxError) return error(400, 'invalid_payload', 'unrecognised webhook payload');
    throw err;
  }
}
