import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { memoryStore, memoryTracker } from '../src/adapters/memory.js';
import { createApp, type AppDeps, type TenantRuntime } from '../src/app.js';
import type { Config } from '../src/config.js';
import type { Mail } from '../src/effects/mailer.js';
import { RateLimiter } from '../src/guards/rateLimit.js';
import { registry, type Tenant } from '../src/tenants.js';

export const cfg: Config = { DATA_BUCKET: 'b', SSM_PREFIX: '/ffrs', DEFAULT_TENANT: 'scaledaiops', TENANT_TTL_S: 300, SERVICE_URL: 'https://ffrs.scaledaiops.org' };

export const tenant: Tenant = {
  slug: 'scaledaiops', name: 'scaledaiops.org', siteUrl: 'https://www.scaledaiops.org', feedbackPage: 'https://www.scaledaiops.org/feedback/',
  origins: ['https://www.scaledaiops.org', 'https://embedder.example'], trackerRepo: 'o/r', githubToken: 't', research: true, pseudonym: 'S1',
  alertEmail: 'team@example.org', turnstileSecret: null, webhookSecret: null, rateLimitPerMin: 5, brand: null, enabled: true,
};
export const branding = { siteName: tenant.name, siteUrl: tenant.siteUrl, feedbackPage: tenant.feedbackPage };

/** One in-memory tenant (plus any extras), each with its own tracker; `over` patches the default tenant's runtime. */
export function testApp(over: Partial<TenantRuntime> & Partial<Pick<AppDeps, 'mailer' | 'isEnabled'>> = {}, extraTenants: Tenant[] = []) {
  const tracker = memoryTracker(), store = memoryStore(), sent: Mail[] = [];
  const t: Tenant = { ...tenant, ...(over.tenant ?? {}) };
  const runtimes = new Map<string, TenantRuntime>([[t.slug, { tenant: t, tracker, rateLimiter: new RateLimiter(5), ...(over.turnstile ? { turnstile: over.turnstile } : {}), ...(over.tracker ? { tracker: over.tracker } : {}) }]]);
  for (const x of extraTenants) runtimes.set(x.slug, { tenant: x, tracker: memoryTracker(), rateLimiter: new RateLimiter(x.rateLimitPerMin) });
  const reg = registry([t, ...extraTenants], t.slug);
  const deps: AppDeps = {
    cfg, store, tenants: async () => reg, runtime: (x) => runtimes.get(x.slug)!,
    mailer: over.mailer ?? (async (m) => { sent.push(m); }), isEnabled: over.isEnabled ?? (async () => true),
  };
  return { app: createApp(deps), tracker, store, sent, deps, runtimes };
}

export function evt(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, ip = '203.0.113.7'): APIGatewayProxyEventV2 {
  return {
    version: '2.0', routeKey: '$default', rawPath: path, rawQueryString: '', headers: { 'user-agent': 'vitest', ...headers },
    requestContext: { accountId: '', apiId: '', domainName: '', domainPrefix: '', requestId: 'r', routeKey: '$default', stage: '$default', time: '', timeEpoch: 0,
      http: { method, path: path.split('?')[0]!, protocol: 'HTTP/1.1', sourceIp: ip, userAgent: 'vitest' } },
    body: body === undefined ? undefined : JSON.stringify(body), isBase64Encoded: false,
    ...(path.includes('?') ? { rawPath: path.split('?')[0], rawQueryString: path.split('?')[1] } : {}),
  } as unknown as APIGatewayProxyEventV2;
}
export const body = (r: { body?: string | undefined }) => JSON.parse(r.body ?? '{}');
export const validBug = { kind: 'bug', title: 'Nav overlaps hero on iPhone SE', body: 'On 375px the nav toggle covers the h1 when opened.', severity: 'medium', pageUrl: 'https://www.scaledaiops.org/', email: 'v@example.org', consent: true } as const;
export const validFeature = { kind: 'feature', title: 'Add RSS feed for changes', body: 'A feed of framework changes would help me follow along.' } as const;
