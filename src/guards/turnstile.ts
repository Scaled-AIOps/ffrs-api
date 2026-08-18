import { z } from 'zod';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const Verdict = z.object({ success: z.boolean(), 'error-codes': z.array(z.string()).optional() });

export type TurnstileVerify = (token: string, remoteIp?: string) => Promise<boolean>;

/** Server-side Turnstile check. Network errors propagate — a broken verifier must not silently pass. */
export function turnstileVerifier(secret: string, fetchImpl: typeof fetch = fetch): TurnstileVerify {
  return async (token, remoteIp) => {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);
    const res = await fetchImpl(VERIFY_URL, { method: 'POST', body });
    if (!res.ok) throw new Error(`turnstile verify HTTP ${res.status}`);
    return Verdict.parse(await res.json()).success;
  };
}
