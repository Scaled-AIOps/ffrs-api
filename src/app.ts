import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import { capture } from './domain/feedback.js';
import type { Store, Tracker } from './domain/ports.js';
import { REF_PATTERN, newRef } from './domain/ref.js';
import { FeedbackInput } from './domain/schema.js';
import { statusOf } from './domain/status.js';
import { handleGithubEvent, verifyGithubSignature } from './domain/webhook.js';
import type { Mailer } from './effects/mailer.js';
import { statusUrl, type Branding } from './effects/templates.js';
import { isHoneypotTripped } from './guards/honeypot.js';
import type { RateLimiter } from './guards/rateLimit.js';
import type { TurnstileVerify } from './guards/turnstile.js';
import { clientIp, corsHeaders, error, header, isForm, json, originAllowed, parseBody, redirect, type Res } from './http.js';
import { log } from './log.js';
import type { Tenant, TenantRegistry } from './tenants.js';

/** What a request needs once its tenant is known. Built per tenant by the handler, cached there. */
export interface TenantRuntime { tenant: Tenant; tracker: Tracker; rateLimiter: RateLimiter; turnstile?: TurnstileVerify }

/** Everything the HTTP app needs, injected — tests build it with in-memory adapters. */
export interface AppDeps {
  cfg: Config;
  store: Store;
  mailer?: Mailer;
  tenants: () => Promise<TenantRegistry>;
  runtime: (t: Tenant) => TenantRuntime;
  isEnabled: () => Promise<boolean>;
}

const POST_FEEDBACK = /^\/api\/feedback\/?$/;
const GET_FEEDBACK = /^\/api\/feedback\/(FB-[A-Z0-9]{6})\/?$/;
const GITHUB_WEBHOOK = /^\/api\/webhooks\/github\/?$/;

export const branding = (t: Tenant): Branding => ({ siteName: t.name, siteUrl: t.siteUrl, feedbackPage: t.feedbackPage });

export function createApp(deps: AppDeps): (evt: APIGatewayProxyEventV2) => Promise<Res> {
  return async (evt) => {
    const { method, path } = evt.requestContext.http;
    const reg = await deps.tenants();
    const origin = header(evt, 'origin');
    try {
      if (method === 'OPTIONS') return { statusCode: 204, headers: origin ? corsHeaders(evt, reg.byOrigin(origin)?.origins ?? []) : {} };
      if (method === 'POST' && POST_FEEDBACK.test(path)) return postFeedback(deps, reg, evt);
      if (method === 'POST' && GITHUB_WEBHOOK.test(path)) return githubWebhook(deps, reg, evt);
      if (method === 'GET') {
        const ref = GET_FEEDBACK.exec(path)?.[1];
        if (ref) return withCors(evt, reg, await getFeedback(deps, reg, ref));
      }
      return error(404, 'not_found', 'no such route');
    } catch (err) {
      log('error', 'unhandled', { path, err: err instanceof Error ? err.stack : String(err) });
      return error(500, 'internal', 'internal error');
    }
  };
}

/** Reads (status lookups) may come from any tenant's page; the Origin alone says which. */
function withCors(evt: APIGatewayProxyEventV2, reg: TenantRegistry, r: Res): Res {
  const origin = header(evt, 'origin');
  const t = origin ? reg.byOrigin(origin) : undefined;
  return t ? { ...r, headers: { ...r.headers, ...corsHeaders(evt, t.origins) } } : r;
}

/**
 * The tenant comes from the request (`site`, or the page's Origin); no clue means the default
 * tenant, which is what the original single-site widget relies on. A page can only submit to a
 * tenant that lists it: a copied `site` value on someone else's host gets a 403, not a CORS pass.
 */
function resolveTenant(reg: TenantRegistry, origin: string | undefined, site: string | undefined): Tenant | Res {
  const t = site ? reg.get(site) : origin ? (reg.byOrigin(origin) ?? reg.default) : reg.default;
  if (!t) return error(404, 'unknown_site', `no tenant "${site}"`);
  if (origin && !originAllowed(t.origins, origin)) return error(403, 'origin_not_allowed', 'this site is not registered for that origin');
  return t;
}

const isTenant = (x: Tenant | Res): x is Tenant => 'slug' in x;

async function postFeedback(deps: AppDeps, reg: TenantRegistry, evt: APIGatewayProxyEventV2): Promise<Res> {
  let raw: unknown;
  try { raw = parseBody(evt); }
  catch (err) { if (err instanceof SyntaxError) return error(400, 'invalid_json', 'body must be JSON'); throw err; }
  const site = typeof raw === 'object' && raw !== null && typeof (raw as { site?: unknown }).site === 'string' ? (raw as { site: string }).site : undefined;
  const resolved = resolveTenant(reg, header(evt, 'origin'), site);
  if (!isTenant(resolved)) return resolved;
  const rt = deps.runtime(resolved);
  const cors = corsHeaders(evt, rt.tenant.origins);
  const withT = (r: Res): Res => ({ ...r, headers: { ...r.headers, ...cors } });

  if (!isForm(evt)) return withT(await postFeedbackJson(deps, rt, evt, raw));
  // No-JS path: the tenant's feedback page posts a form; answer with a redirect back to it instead of JSON.
  const res = await postFeedbackJson(deps, rt, evt, raw);
  const body = JSON.parse(res.body ?? '{}') as { ref?: string; error?: { message?: string; details?: Array<{ path: string; message: string }> } };
  if (body.ref) return redirect(`${rt.tenant.feedbackPage}?sent=1&ref=${body.ref}`);
  const msg = body.error?.details?.map((d) => `${d.path}: ${d.message}`).join('; ') ?? body.error?.message ?? 'unknown error';
  return redirect(`${rt.tenant.feedbackPage}?error=${encodeURIComponent(msg)}`);
}

async function postFeedbackJson(deps: AppDeps, rt: TenantRuntime, evt: APIGatewayProxyEventV2, raw: unknown): Promise<Res> {
  const t = rt.tenant;
  if (!t.enabled || !(await deps.isEnabled())) return error(503, 'ffrs_disabled', 'feedback is temporarily disabled');
  const ip = clientIp(evt);
  if (!rt.rateLimiter.allow(ip)) return error(429, 'rate_limited', 'too many submissions, try again in a minute');

  let input: FeedbackInput;
  try {
    input = FeedbackInput.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) return error(400, 'invalid_input', 'validation failed', err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    throw err;
  }
  if (isHoneypotTripped(input)) { log('info', 'honeypot', { tenant: t.slug }); return json(202, { ref: newRef(), status: 'received' }); } // bots get a convincing 202
  if (rt.turnstile) {
    if (!input.turnstileToken) return error(400, 'turnstile_required', 'missing turnstile token');
    if (!(await rt.turnstile(input.turnstileToken, ip))) return error(403, 'turnstile_failed', 'human verification failed');
  }

  const idem = header(evt, 'idempotency-key'), ua = header(evt, 'user-agent');
  const b = branding(t);
  try {
    const r = await capture(
      { tenant: t.slug, tracker: rt.tracker, store: deps.store, branding: b, ...(deps.mailer ? { mailer: deps.mailer } : {}), ...(t.alertEmail ? { alertTo: t.alertEmail } : {}) },
      input, { ...(idem ? { idempotencyKey: idem } : {}), ...(ua ? { userAgent: ua } : {}) },
    );
    log('info', r.created ? 'captured' : 'idempotent_replay', { tenant: t.slug, ref: r.ref, kind: input.kind, screenshot: Boolean(input.screenshot), issue: r.issueUrl });
    return json(r.created ? 202 : 200, { ref: r.ref, status: 'received', statusUrl: statusUrl(b, r.ref) });
  } catch (err) {
    // GitHub is the store: if it is down we cannot accept — say so honestly; the widget retries with the same key.
    log('error', 'capture_failed', { tenant: t.slug, err: String(err) });
    return error(502, 'route_failed', 'could not file your feedback right now — please retry in a minute');
  }
}

async function getFeedback(deps: AppDeps, reg: TenantRegistry, ref: string): Promise<Res> {
  if (!REF_PATTERN.test(ref)) return error(404, 'not_found', 'unknown reference');
  const s = await deps.store.getSidecar(ref);
  // Sidecars from before tenancy carry no tenant: they belong to the site that existed then.
  const t = s ? (s.tenant ? reg.get(s.tenant) : reg.default) : undefined;
  const view = s && t ? await statusOf(deps.runtime(t).tracker, s) : undefined;
  return view ? json(200, view) : error(404, 'not_found', 'unknown reference');
}

/** The webhook's tenant is the repository it fires from; each tenant verifies with its own secret. */
async function githubWebhook(deps: AppDeps, reg: TenantRegistry, evt: APIGatewayProxyEventV2): Promise<Res> {
  const raw = evt.isBase64Encoded ? Buffer.from(evt.body ?? '', 'base64').toString('utf8') : (evt.body ?? '');
  let repo: string | undefined;
  try { repo = (JSON.parse(raw) as { repository?: { full_name?: string } }).repository?.full_name; }
  catch { return error(400, 'invalid_payload', 'unrecognised webhook payload'); }
  const t = repo ? reg.byRepo(repo) : undefined;
  if (!t?.webhookSecret) return error(404, 'not_found', 'no such route');
  if (!verifyGithubSignature(t.webhookSecret, raw, header(evt, 'x-hub-signature-256'))) return error(401, 'bad_signature', 'signature mismatch');
  try {
    const out = await handleGithubEvent({ store: deps.store, tracker: deps.runtime(t).tracker, branding: branding(t), ...(deps.mailer ? { mailer: deps.mailer } : {}) }, header(evt, 'x-github-event') ?? '', JSON.parse(raw));
    log('info', 'webhook', { tenant: t.slug, ...out });
    return json(200, out);
  } catch (err) {
    if (err instanceof ZodError || err instanceof SyntaxError) return error(400, 'invalid_payload', 'unrecognised webhook payload');
    throw err;
  }
}
