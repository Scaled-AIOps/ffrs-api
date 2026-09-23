import { z } from 'zod';
import { originAllowed } from './http.js';
import { log } from './log.js';

/**
 * A tenant is one site on the service. Everything that used to be a site-specific env var lives
 * here instead, read from SSM `${prefix}/tenants/<slug>/<key>` (secrets as SecureStrings) and
 * refreshed every few minutes — onboarding a site is writing a folder, not a deploy.
 */
const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const csv = z.string().transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean));

const Raw = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,32}$/),
  name: z.string().min(1),
  site_url: z.string().url(),
  feedback_page: z.string().url().optional(), // status page + no-JS form; default <site_url>/feedback/
  origins: csv,
  tracker_repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  github_token: z.string().min(1),
  research: bool.default(false),
  pseudonym: z.string().min(1).optional(), // the only tenant identifier that reaches the paper
  alert_email: z.string().email().optional(),
  turnstile_secret: z.string().min(1).optional(),
  webhook_secret: z.string().min(1).optional(),
  agent_target_repo: z.string().optional(),
  rate_limit_per_min: z.coerce.number().int().positive().default(5),
  brand: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'a #rrggbb colour').optional(), // status-page accent
  enabled: bool.default(true),
});

export interface Tenant {
  slug: string; name: string; siteUrl: string; feedbackPage: string; origins: string[];
  trackerRepo: string; githubToken: string; research: boolean; pseudonym: string | null;
  alertEmail: string | null; turnstileSecret: string | null; webhookSecret: string | null;
  agentTargetRepo: string | null; rateLimitPerMin: number; brand: string | null; enabled: boolean;
}

/** `serviceUrl` hosts the central status page, the default for tenants without their own. */
export function parseTenant(raw: Record<string, string>, serviceUrl: string): Tenant {
  const t = Raw.parse(raw);
  return {
    slug: t.slug, name: t.name, siteUrl: t.site_url.replace(/\/$/, ''), origins: t.origins,
    feedbackPage: t.feedback_page ?? `${serviceUrl.replace(/\/$/, '')}/status/`,
    trackerRepo: t.tracker_repo, githubToken: t.github_token, research: t.research, pseudonym: t.pseudonym ?? null,
    alertEmail: t.alert_email ?? null, turnstileSecret: t.turnstile_secret ?? null, webhookSecret: t.webhook_secret ?? null,
    agentTargetRepo: t.agent_target_repo ?? null, rateLimitPerMin: t.rate_limit_per_min, brand: t.brand ?? null, enabled: t.enabled,
  };
}

export interface TenantRegistry {
  default: Tenant;
  get(slug: string): Tenant | undefined;
  /** Preflights carry no body, so the only clue to the tenant is where the page lives. */
  byOrigin(origin: string): Tenant | undefined;
  /** Webhooks identify their tenant by the repository they come from. */
  byRepo(fullName: string): Tenant | undefined;
  all(): Tenant[];
}

export function registry(tenants: Tenant[], defaultSlug: string): TenantRegistry {
  const bySlug = new Map(tenants.map((t) => [t.slug, t]));
  const def = bySlug.get(defaultSlug);
  if (!def) throw new Error(`default tenant "${defaultSlug}" is not configured`);
  return {
    default: def,
    get: (slug) => bySlug.get(slug),
    byOrigin: (origin) => tenants.find((t) => originAllowed(t.origins, origin)),
    byRepo: (name) => tenants.find((t) => t.trackerRepo.toLowerCase() === name.toLowerCase()),
    all: () => [...tenants],
  };
}

/** One recursive read of the tenants folder. A malformed tenant is skipped and logged, never fatal. */
export async function loadTenants(prefix: string, defaultSlug: string, serviceUrl: string): Promise<TenantRegistry> {
  const { SSMClient, GetParametersByPathCommand } = await import('@aws-sdk/client-ssm');
  const client = new SSMClient({});
  const path = `${prefix}/tenants/`;
  const groups = new Map<string, Record<string, string>>();
  let NextToken: string | undefined;
  do {
    const out = await client.send(new GetParametersByPathCommand({ Path: path, Recursive: true, WithDecryption: true, ...(NextToken ? { NextToken } : {}) }));
    for (const p of out.Parameters ?? []) {
      const [slug, key] = (p.Name ?? '').slice(path.length).split('/');
      if (!slug || !key || p.Value === undefined) continue;
      groups.set(slug, { ...groups.get(slug), [key]: p.Value });
    }
    NextToken = out.NextToken;
  } while (NextToken);
  const tenants: Tenant[] = [];
  for (const [slug, raw] of groups) {
    try { tenants.push(parseTenant({ slug, ...raw }, serviceUrl)); }
    catch (err) { log('error', 'tenant_invalid', { slug, err: err instanceof z.ZodError ? err.issues : String(err) }); }
  }
  log('info', 'tenants_loaded', { tenants: tenants.map((t) => t.slug) });
  return registry(tenants, defaultSlug);
}
