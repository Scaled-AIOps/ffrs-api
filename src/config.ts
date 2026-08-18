import { z } from 'zod';

const Env = z.object({
  DATABASE_URL: z.string().url(),
  SITE_NAME: z.string().min(1),
  ALLOWED_ORIGINS: z.string().default(''), // comma-separated; empty = same-origin only
  TURNSTILE_SECRET: z.string().min(1).optional(), // absent = guard off (logged at startup)
  SCREENSHOT_BUCKET: z.string().min(1).optional(), // absent = screenshots rejected
  SSM_PREFIX: z.string().optional(), // e.g. /ffrs — enables the runtime kill switch
  FFRS_ENABLED: z.enum(['true', 'false']).default('true'),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(5),
  // Effects (Phase 3). Each effect registers only when its settings are present.
  SITE_URL: z.string().url().default('https://www.scaledaiops.org'),
  FROM_EMAIL: z.string().email().optional(),
  ALERT_EMAIL: z.string().email().optional(),
  GITHUB_REPO: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'owner/repo').optional(),
  GITHUB_TOKEN: z.string().min(1).optional(),
});
export type Config = z.infer<typeof Env> & { allowedOrigins: string[] };

let cached: Config | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (cached) return cached;
  const parsed = Env.parse(env);
  cached = { ...parsed, allowedOrigins: parsed.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean) };
  return cached;
}

/** Test hook — never call from production code. */
export function resetConfig(): void {
  cached = undefined;
}

// Runtime kill switch: SSM `${SSM_PREFIX}/enabled`, cached 60 s so it flips without a deploy.
const KILL_SWITCH_TTL_MS = 60_000;
let killSwitch: { value: boolean; fetchedAt: number } | undefined;

export async function isEnabled(cfg: Config, now = Date.now()): Promise<boolean> {
  if (!cfg.SSM_PREFIX) return cfg.FFRS_ENABLED === 'true';
  if (killSwitch && now - killSwitch.fetchedAt < KILL_SWITCH_TTL_MS) return killSwitch.value;
  const { SSMClient, GetParameterCommand } = await import('@aws-sdk/client-ssm');
  const out = await new SSMClient({}).send(new GetParameterCommand({ Name: `${cfg.SSM_PREFIX}/enabled` }));
  const value = out.Parameter?.Value !== 'false';
  killSwitch = { value, fetchedAt: now };
  return value;
}
