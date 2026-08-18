import type { APIGatewayProxyEventV2, Context, ScheduledEvent } from 'aws-lambda';
import { createApp } from './app.js';
import { loadSecretsFromSsm } from './bootstrap.js';
import { isEnabled, loadConfig } from './config.js';
import { neonRepo } from './db/neonRepo.js';
import { s3Blobs } from './db/s3Blobs.js';
import type { EffectRegistry } from './effects/types.js';
import { RateLimiter } from './guards/rateLimit.js';
import { turnstileVerifier } from './guards/turnstile.js';
import { log } from './log.js';
import { drainOutbox } from './outbox.js';

// Effects are registered in Phase 3 (ack email, GitHub issue, alert). Empty registry = rows are parked, not lost.
const effects: EffectRegistry = {};

interface Wiring { app: ReturnType<typeof createApp>; repo: ReturnType<typeof neonRepo> }
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
  return { app, repo };
}

export async function handler(event: APIGatewayProxyEventV2 | ScheduledEvent, _ctx: Context) {
  const { app, repo } = await (wiring ??= init().catch((e) => { wiring = undefined; throw e; }));
  if ('requestContext' in event) return app(event);
  const result = await drainOutbox(repo, effects);
  log('info', 'outbox_drained', result);
  return result;
}
