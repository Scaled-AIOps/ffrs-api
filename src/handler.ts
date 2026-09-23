import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { githubTracker } from './adapters/githubTracker.js';
import { s3Store } from './adapters/s3Store.js';
import { createApp, type TenantRuntime } from './app.js';
import { isEnabled, loadConfig } from './config.js';
import { sesMailer } from './effects/mailer.js';
import { RateLimiter } from './guards/rateLimit.js';
import { turnstileVerifier } from './guards/turnstile.js';
import { log } from './log.js';
import { runWeeklyReports } from './reports/run.js';
import { loadTenants, type Tenant, type TenantRegistry } from './tenants.js';

/** EventBridge passes `{ job }` as target input. */
type JobEvent = { job: 'weekly_report' };
interface Wiring { app: ReturnType<typeof createApp>; weekly: () => Promise<unknown> }
let wiring: Promise<Wiring> | undefined;

// Cold-start wiring, once per instance. Fails fast on bad config — a mis-deployed Lambda must not serve requests.
async function init(): Promise<Wiring> {
  const cfg = loadConfig();
  const store = s3Store(cfg.DATA_BUCKET);
  const mailer = cfg.FROM_EMAIL ? sesMailer(cfg.FROM_EMAIL) : undefined;
  if (!mailer) log('warn', 'email_disabled', { hint: 'set FROM_EMAIL to enable ack/alert/close emails' });

  // Tenants refresh on a TTL so onboarding needs no deploy. Rate-limit buckets outlive a refresh.
  let reg: { value: TenantRegistry; fetchedAt: number } | undefined;
  const tenants = async (): Promise<TenantRegistry> => {
    if (!reg || Date.now() - reg.fetchedAt > cfg.TENANT_TTL_S * 1000) reg = { value: await loadTenants(cfg.SSM_PREFIX, cfg.DEFAULT_TENANT), fetchedAt: Date.now() };
    return reg.value;
  };
  const limiters = new Map<string, RateLimiter>();
  const runtime = (t: Tenant): TenantRuntime => {
    let rateLimiter = limiters.get(t.slug);
    if (!rateLimiter) limiters.set(t.slug, (rateLimiter = new RateLimiter(t.rateLimitPerMin)));
    return {
      tenant: t, tracker: githubTracker(t.trackerRepo, t.githubToken), rateLimiter,
      ...(t.turnstileSecret ? { turnstile: turnstileVerifier(t.turnstileSecret) } : {}),
    };
  };

  const deps = { cfg, store, tenants, runtime, isEnabled: () => isEnabled(cfg), ...(mailer ? { mailer } : {}) };
  return { app: createApp(deps), weekly: () => runWeeklyReports(deps) };
}

export async function handler(event: APIGatewayProxyEventV2 | JobEvent, _ctx: Context) {
  const w = await (wiring ??= init().catch((e) => { wiring = undefined; throw e; }));
  if ('requestContext' in event) return w.app(event);
  if (event.job === 'weekly_report') return w.weekly();
  throw new Error(`unknown job ${String((event as { job?: string }).job)}`);
}
