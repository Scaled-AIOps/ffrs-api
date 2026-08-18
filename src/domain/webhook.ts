import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Mailer } from '../effects/mailer.js';
import { closeMail, type Branding } from '../effects/templates.js';
import { log } from '../log.js';
import type { Store } from './ports.js';
import { deriveOutcome } from './status.js';

/**
 * Loop closure. GitHub already records comments and close time; the webhook's only job is the closing email
 * (the one thing GitHub can't do because the address lives in the private sidecar).
 */
export const IssuesEvent = z.object({
  action: z.string(),
  issue: z.object({
    number: z.number(), html_url: z.string().url(), body: z.string().nullable().default(''),
    state_reason: z.enum(['completed', 'not_planned', 'duplicate', 'reopened']).nullable().optional(),
    labels: z.array(z.object({ name: z.string() })).default([]),
  }),
});
const REF = /<!--\s*ffrs:(FB-[A-Z0-9]{6})\s*-->/;

export async function handleGithubEvent(
  deps: { store: Store; branding: Branding; mailer?: Mailer },
  event: string, payload: unknown, now = new Date(),
): Promise<{ ref?: string; action: string; emailed: boolean }> {
  if (event !== 'issues') return { action: 'ignored', emailed: false };
  const e = IssuesEvent.parse(payload);
  const ref = REF.exec(e.issue.body ?? '')?.[1];
  if (!ref) return { action: 'ignored', emailed: false }; // not an FFRS issue
  const s = await deps.store.getSidecar(ref);
  if (!s) return { ref, action: 'ignored', emailed: false };
  if (e.action === 'closed' && s.email && deps.mailer && !s.closeEmailAt) {
    const outcome = deriveOutcome(s.kind, { labels: e.issue.labels.map((l) => l.name), stateReason: e.issue.state_reason ?? null });
    await deps.mailer(closeMail(deps.branding, s, outcome));
    await deps.store.putSidecar({ ...s, closeEmailAt: now.toISOString() });
    log('info', 'close_email_sent', { ref, outcome });
    return { ref, action: 'closed', emailed: true };
  }
  if (e.action === 'reopened' && s.closeEmailAt) {
    await deps.store.putSidecar({ ...s, closeEmailAt: null }); // allow a fresh closing email later
    return { ref, action: 'reopened', emailed: false };
  }
  return { ref, action: e.action, emailed: false };
}

export function verifyGithubSignature(secret: string, rawBody: string, signatureHeader: string | undefined): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`);
  const given = Buffer.from(signatureHeader);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
