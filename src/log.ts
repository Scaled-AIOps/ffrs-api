/** One JSON line per event → CloudWatch. `ref` is the correlation id across capture, effects and webhooks. */
export function log(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...fields });
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
}
