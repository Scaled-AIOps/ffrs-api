import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { createApp } from './app.js';
import { loadSecretsFromSsm } from './bootstrap.js';
import { isEnabled, loadConfig } from './config.js';
import { neonRepo } from './db/neonRepo.js';
import { s3Blobs } from './db/s3Blobs.js';
import { buildEffects } from './effects/index.js';
import type { EffectRegistry } from './effects/types.js';
import { RateLimiter } from './guards/rateLimit.js';
import { turnstileVerifier } from './guards/turnstile.js';
import { log } from './log.js';
import { drainOutbox } from './outbox.js';
import { runWeeklyReport } from './reports/run.js';

interface Wiring { app: ReturnType<typeof createApp>; repo: ReturnType<typeof neonRepo>; effects: EffectRegistry; cfg: ReturnType<typeof loadConfig> }
/** EventBridge targets pass `{ job }` as their input. */
type JobEvent = { job: 'drain_outbox' | 'weekly_report' };
let wiring: Promise<Wiring> | undefined;

// Cold-start wiring, once per instance. Fails fast on bad config — a mis-deployed Lambda must not serve requests.
async function init(): Promise<Wiring> {
  if (process.env['SSM_PREFIX']) await loadSecretsFromSsm(process.env['SSM_PREFIX']);
  const cfg = loadConfig();
  const repo = neonRepo(cfg.DATABASE_URL);
  const blobs = cfg.SCREENSHOT_BUCKET ? s3Blobs(cfg.SCREENSHOT_BUCKET) : undefined;
  const turnstile = cfg.TURNSTILE_SECRET ? turnstileVerifier(cfg.TURNSTILE_SECRET) : undefined;
  if (!turnstile) log('warn', 'turnstile_disabled', { hint: 'set /ffrs/turnstile_secret in SSM' });
  const app = createApp({
    cfg,
    repo,
    ...(blobs ? { blobs } : {}),
    rateLimiter: new RateLimiter(cfg.RATE_LIMIT_PER_MIN),
    ...(turnstile ? { turnstile } : {}),
    isEnabled: () => isEnabled(cfg),
  });
  return { app, repo, effects: buildEffects(cfg, blobs ? { blobs } : {}), cfg };
}

export async function handler(event: APIGatewayProxyEventV2 | JobEvent, _ctx: Context) {
  const { app, repo, effects, cfg } = await (wiring ??= init().catch((e) => { wiring = undefined; throw e; }));
  if ('requestContext' in event) return app(event);
  if (event.job === 'weekly_report') return runWeeklyReport(repo, cfg);
  const result = await drainOutbox(repo, effects);
  log('info', 'outbox_drained', result);
  return result;
}
