import { createHash } from 'node:crypto';
import type { Mailer } from '../effects/mailer.js';
import { ackMail, alertMail, issueBody, type Branding } from '../effects/templates.js';
import { log } from '../log.js';
import type { Sidecar, Store, Tracker } from './ports.js';
import { newRef } from './ref.js';
import { decodeScreenshot, type FeedbackInput } from './schema.js';

const SCREENSHOT_LINK_TTL_S = 7 * 24 * 3600;
export const REF_MARKER = /<!--\s*ffrs:(FB-[A-Z0-9]{6})\s*-->/;

export interface CaptureDeps {
  tracker: Tracker;
  store: Store;
  branding: Branding;
  mailer?: Mailer;
  alertTo?: string;
}
export interface CaptureContext { idempotencyKey?: string; userAgent?: string; now?: Date }
export interface CaptureResult { ref: string; created: boolean; issueUrl: string }

/**
 * FFRS stages 1–3 in one call: Capture (sidecar), Route (GitHub issue), Acknowledge (email, if consented).
 * The issue is the durable record; if GitHub is down the caller gets an error and the widget retries with the same key.
 */
export async function capture(deps: CaptureDeps, input: FeedbackInput, ctx: CaptureContext = {}): Promise<CaptureResult> {
  const now = ctx.now ?? new Date();
  if (ctx.idempotencyKey) {
    const ref = await deps.store.getIdem(ctx.idempotencyKey);
    const s = ref ? await deps.store.getSidecar(ref) : undefined;
    if (s) return { ref: s.ref, created: false, issueUrl: s.issueUrl };
  }

  const ref = newRef();
  let screenshotKey: string | null = null;
  let screenshotUrl: string | undefined;
  if (input.screenshot) {
    screenshotKey = `screenshots/${now.toISOString().slice(0, 10)}/${ref}.jpg`;
    await deps.store.putBlob(screenshotKey, decodeScreenshot(input.screenshot), 'image/jpeg');
    screenshotUrl = await deps.store.blobUrl(screenshotKey, SCREENSHOT_LINK_TTL_S);
  }

  const meta = { ...input.meta, ...(ctx.userAgent ? { uaHash: sha256(ctx.userAgent).slice(0, 16) } : {}) };
  const issue = await deps.tracker.createIssue(issueBody(deps.branding, { ref, ...input, meta, createdAt: now }, screenshotUrl));

  const sidecar: Sidecar = {
    ref, issueNumber: issue.number, issueUrl: issue.url, kind: input.kind, title: input.title, createdAt: now.toISOString(),
    email: input.consent ? (input.email ?? null) : null, consent: input.consent, screenshotKey, acknowledgedAt: null, closeEmailAt: null,
  };

  // Ack + alert are best-effort: a mail outage must not lose the (already filed) feedback. Failures are logged, not swallowed.
  if (deps.mailer && sidecar.email) {
    try { await deps.mailer(ackMail(deps.branding, sidecar)); sidecar.acknowledgedAt = new Date().toISOString(); }
    catch (err) { log('warn', 'ack_email_failed', { ref, err: String(err) }); }
  }
  if (deps.mailer && deps.alertTo) {
    try { await deps.mailer(alertMail(deps.branding, { ...sidecar, severity: input.severity ?? null, pageUrl: input.pageUrl ?? null, body: input.body }, deps.alertTo)); }
    catch (err) { log('warn', 'alert_email_failed', { ref, err: String(err) }); }
  }

  await deps.store.putSidecar(sidecar);
  if (ctx.idempotencyKey) await deps.store.putIdem(ctx.idempotencyKey, ref);
  return { ref, created: true, issueUrl: issue.url };
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
