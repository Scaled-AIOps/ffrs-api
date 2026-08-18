import { describe, expect, it } from 'vitest';
import { isHoneypotTripped } from '../src/guards/honeypot.js';
import { RateLimiter } from '../src/guards/rateLimit.js';
import { turnstileVerifier } from '../src/guards/turnstile.js';

describe('guards', () => {
  it('honeypot trips only on non-empty value', () => {
    expect(isHoneypotTripped({})).toBe(false);
    expect(isHoneypotTripped({ website: '' })).toBe(false);
    expect(isHoneypotTripped({ website: 'http://spam' })).toBe(true);
  });
  it('rate limiter allows N per minute per ip and refills over time', () => {
    const rl = new RateLimiter(2);
    expect(rl.allow('a', 0)).toBe(true);
    expect(rl.allow('a', 0)).toBe(true);
    expect(rl.allow('a', 0)).toBe(false);
    expect(rl.allow('b', 0)).toBe(true);
    expect(rl.allow('a', 30_000)).toBe(true); // half a minute → one token back
  });
  it('turnstile verifier posts token and returns success flag; HTTP errors throw', async () => {
    const calls: string[] = [];
    const ok = turnstileVerifier('sec', (async (_u: unknown, init: RequestInit) => { calls.push(String(init.body)); return new Response(JSON.stringify({ success: true })); }) as unknown as typeof fetch);
    expect(await ok('tok', '1.2.3.4')).toBe(true);
    expect(calls[0]).toContain('secret=sec');
    expect(calls[0]).toContain('remoteip=1.2.3.4');
    const down = turnstileVerifier('sec', (async () => new Response('', { status: 502 })) as unknown as typeof fetch);
    await expect(down('tok')).rejects.toThrow(/502/);
  });
});
