import { createHash } from 'node:crypto';
import type { BlobStore, EffectType, FeedbackRepo } from './repo.js';
import { newRef } from './ref.js';
import { decodeScreenshot, type FeedbackInput } from './schema.js';

export interface CaptureContext {
  idempotencyKey?: string;
  userAgent?: string;
  now?: Date;
}

export interface CaptureResult {
  ref: string;
  created: boolean;
}

/**
 * FFRS stage 1 — Capture. Durable write first; every side effect is queued, never awaited.
 * Effects: ack email only when the visitor consented; route + alert always.
 */
export async function capture(
  deps: { repo: FeedbackRepo; blobs?: BlobStore },
  input: FeedbackInput,
  ctx: CaptureContext = {},
): Promise<CaptureResult> {
  const now = ctx.now ?? new Date();
  const ref = newRef();

  let screenshotKey: string | undefined;
  if (input.screenshot) {
    if (!deps.blobs) throw new CaptureError('screenshots_disabled', 'screenshots are not enabled on this deployment');
    screenshotKey = `${now.toISOString().slice(0, 10)}/${ref}.jpg`;
    await deps.blobs.put(screenshotKey, decodeScreenshot(input.screenshot), 'image/jpeg');
  }

  const effects: EffectType[] = ['github_issue', 'alert_email'];
  if (input.consent && input.email) effects.unshift('ack_email');

  const { row, created } = await deps.repo.create(
    {
      ref,
      idempotencyKey: ctx.idempotencyKey ?? null,
      kind: input.kind,
      title: input.title,
      body: input.body,
      pageUrl: input.pageUrl ?? null,
      severity: input.severity ?? null,
      screenshotKey: screenshotKey ?? null,
      meta: { ...input.meta, uaHash: ctx.userAgent ? sha256(ctx.userAgent).slice(0, 16) : undefined },
      email: input.consent ? (input.email ?? null) : null, // no consent → we don't keep the address
      consent: input.consent,
      createdAt: now,
    },
    effects,
  );
  return { ref: row.ref, created };
}

export class CaptureError extends Error {
  constructor(
    readonly code: 'screenshots_disabled',
    message: string,
  ) {
    super(message);
  }
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
