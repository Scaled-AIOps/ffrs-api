import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { createApp, type AppDeps } from '../src/app.js';
import type { Config } from '../src/config.js';
import { memoryRepo } from '../src/db/memoryRepo.js';
import { RateLimiter } from '../src/guards/rateLimit.js';

export const cfg: Config = {
  DATABASE_URL: 'postgres://x', SITE_NAME: 'test', ALLOWED_ORIGINS: 'https://embedder.example', allowedOrigins: ['https://embedder.example'],
  FFRS_ENABLED: 'true', RATE_LIMIT_PER_MIN: 5, SITE_URL: 'https://www.scaledaiops.org',
};

export function testApp(over: Partial<AppDeps> = {}) {
  const repo = memoryRepo();
  const deps: AppDeps = { cfg, repo, rateLimiter: new RateLimiter(5), isEnabled: async () => true, ...over };
  return { app: createApp(deps), repo, deps };
}

export function evt(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, ip = '203.0.113.7'): APIGatewayProxyEventV2 {
  return {
    version: '2.0', routeKey: '$default', rawPath: path, rawQueryString: '', headers: { 'user-agent': 'vitest', ...headers },
    requestContext: { accountId: '', apiId: '', domainName: '', domainPrefix: '', requestId: 'r', routeKey: '$default', stage: '$default', time: '', timeEpoch: 0,
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: ip, userAgent: 'vitest' } },
    body: body === undefined ? undefined : JSON.stringify(body), isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

export const validBug = { kind: 'bug', title: 'Nav overlaps hero on iPhone SE', body: 'On 375px the nav toggle covers the h1 when opened.', severity: 'medium', pageUrl: 'https://www.scaledaiops.org/', email: 'v@example.org', consent: true } as const;
export const validFeature = { kind: 'feature', title: 'Add RSS feed for changes', body: 'A feed of framework changes would help me follow along.' } as const;
