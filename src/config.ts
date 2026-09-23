import { z } from 'zod';

/** Service-wide settings only. Anything per site is a tenant field (tenants.ts). */
const Env = z.object({
  DATA_BUCKET: z.string().min(1), // private S3 bucket: sidecars, idempotency map, screenshots, research exports
  SSM_PREFIX: z.string().min(1),  // e.g. /ffrs — tenants live under <prefix>/tenants/, the kill switch at <prefix>/enabled
  DEFAULT_TENANT: z.string().min(1), // serves requests that name no site (the original single-site widget)
  SERVICE_URL: z.string().url().default('https://ffrs.scaledaiops.org'), // hosts /status/ for tenants without their own page
  FROM_EMAIL: z.string().email().optional(), // absent = no emails at all
  TENANT_TTL_S: z.coerce.number().int().positive().default(300),
});
export type Config = z.infer<typeof Env>;

let cached: Config | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return (cached ??= Env.parse(env));
}

/** Test hook — never call from production code. */
export function resetConfig(): void {
  cached = undefined;
}

// Runtime kill switch: SSM `${SSM_PREFIX}/enabled`, cached 60 s so it flips without a deploy.
const KILL_SWITCH_TTL_MS = 60_000;
let killSwitch: { value: boolean; fetchedAt: number } | undefined;

export async function isEnabled(cfg: Config, now = Date.now()): Promise<boolean> {
  if (killSwitch && now - killSwitch.fetchedAt < KILL_SWITCH_TTL_MS) return killSwitch.value;
  const { SSMClient, GetParameterCommand } = await import('@aws-sdk/client-ssm');
  const out = await new SSMClient({}).send(new GetParameterCommand({ Name: `${cfg.SSM_PREFIX}/enabled` }));
  const value = out.Parameter?.Value !== 'false';
  killSwitch = { value, fetchedAt: now };
  return value;
}
