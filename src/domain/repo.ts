import type { FeedbackRow, NewFeedback, SideEffectRow } from '../db/schema.js';

export type EffectType = 'ack_email' | 'github_issue' | 'alert_email' | 'close_email';

/** Persistence boundary. Neon in production, in-memory in tests — the domain never sees a driver. */
export interface FeedbackRepo {
  /** Insert feedback and its outbox rows atomically. Returns the existing row when idempotencyKey matches. */
  create(input: NewFeedback, effects: EffectType[]): Promise<{ row: FeedbackRow; created: boolean }>;
  findByRef(ref: string): Promise<FeedbackRow | undefined>;
  /** Claim up to `limit` due effects (sets attempts+1) so concurrent drains don't double-send. */
  claimDueEffects(limit: number, now: Date): Promise<Array<SideEffectRow & { feedback: FeedbackRow }>>;
  completeEffect(id: number, now: Date, stamp?: keyof Pick<FeedbackRow, 'acknowledgedAt' | 'routedAt'>): Promise<void>;
  failEffect(id: number, error: string, nextTryAt: Date): Promise<void>;
}

/** Binary storage for screenshots. S3 in production, in-memory in tests. */
export interface BlobStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
}
