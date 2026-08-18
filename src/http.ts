import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

export type Res = Exclude<APIGatewayProxyResultV2, string>;

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Res {
  return { statusCode: status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }, body: JSON.stringify(body) };
}

export function error(status: number, code: string, message: string, details?: unknown): Res {
  return json(status, { error: { code, message, ...(details === undefined ? {} : { details }) } });
}

export function header(evt: APIGatewayProxyEventV2, name: string): string | undefined {
  return evt.headers[name] ?? evt.headers[name.toLowerCase()];
}

export function clientIp(evt: APIGatewayProxyEventV2): string {
  return header(evt, 'x-forwarded-for')?.split(',')[0]?.trim() || evt.requestContext.http.sourceIp;
}

/** CORS only for explicitly allowed third-party embedders; same-origin needs nothing. */
export function corsHeaders(evt: APIGatewayProxyEventV2, allowed: string[]): Record<string, string> {
  const origin = header(evt, 'origin');
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, GET, OPTIONS',
    'access-control-allow-headers': 'content-type, idempotency-key',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

export function parseJsonBody(evt: APIGatewayProxyEventV2): unknown {
  if (!evt.body) return undefined;
  const raw = evt.isBase64Encoded ? Buffer.from(evt.body, 'base64').toString('utf8') : evt.body;
  return JSON.parse(raw) as unknown; // throws SyntaxError → 400 in handler
}
