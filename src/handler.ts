import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { githubTracker } from './adapters/githubTracker.js';
import { s3Store } from './adapters/s3Store.js';
import { createApp } from './app.js';
import { loadSecretsFromSsm } from './bootstrap.js';
import { isEnabled, loadConfig } from './config.js';
import { sesMailer } from './effects/mailer.js';
import { RateLimiter } from './guards/rateLimit.js';
import { turnstileVerifier } from './guards/turnstile.js';
import { log } from './log.js';
import { runWeeklyReport } from './reports/run.js';

/** EventBridge passes `{ job }` as target input. */
type JobEvent = { job: 'weekly_report' };
interface Wiring { app: ReturnType<typeof createApp>; weekly: () => Promise<unknown> }
let wiring: Promise<Wiring> | undefined;

// Cold-start wiring, once per instance. Fails fast on bad config — a mis-deployed Lambda must not serve requests.
async function init(): Promise<Wiring> {
  if (process.env['SSM_PREFIX']) await loadSecretsFromSsm(process.env['SSM_PREFIX']);
  const cfg = loadConfig();
  const tracker = githubTracker(cfg.GITHUB_REPO, cfg.GITHUB_TOKEN);
  const store = s3Store(cfg.DATA_BUCKET);
  const branding = { siteName: cfg.SITE_NAME, siteUrl: cfg.SITE_URL };
  const mailer = cfg.FROM_EMAIL ? sesMailer(cfg.FROM_EMAIL) : undefined;
  const turnstile = cfg.TURNSTILE_SECRET ? turnstileVerifier(cfg.TURNSTILE_SECRET) : undefined;
  if (!mailer) log('warn', 'email_disabled', { hint: 'set FROM_EMAIL to enable ack/alert/close emails' });
  if (!turnstile) log('warn', 'turnstile_disabled', { hint: 'set /ffrs/turnstile_secret in SSM' });
  const app = createApp({
    cfg, tracker, store, branding,
    ...(mailer ? { mailer } : {}), ...(cfg.ALERT_EMAIL ? { alertTo: cfg.ALERT_EMAIL } : {}), ...(turnstile ? { turnstile } : {}),
    rateLimiter: new RateLimiter(cfg.RATE_LIMIT_PER_MIN),
    isEnabled: () => isEnabled(cfg),
  });
  return { app, weekly: () => runWeeklyReport(tracker, cfg) };
}

export async function handler(event: APIGatewayProxyEventV2 | JobEvent, _ctx: Context) {
  const w = await (wiring ??= init().catch((e) => { wiring = undefined; throw e; }));
  if ('requestContext' in event) return w.app(event);
  if (event.job === 'weekly_report') return w.weekly();
  throw new Error(`unknown job ${String((event as { job?: string }).job)}`);
}
