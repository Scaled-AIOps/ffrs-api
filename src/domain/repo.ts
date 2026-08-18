import type { FeedbackRow, NewFeedback, SideEffectRow } from '../db/schema.js';

export type EffectType = 'ack_email' | 'github_issue' | 'alert_email' | 'close_email';
export type FeedbackPatch = Partial<Pick<FeedbackRow, 'acknowledgedAt' | 'routedAt' | 'githubIssueUrl' | 'status'>>;

/** Persistence boundary. Neon in production, in-memory in tests — the domain never sees a driver. */
export interface FeedbackRepo {
  /** Insert feedback and its outbox rows atomically. Returns the existing row when idempotencyKey matches. */
  create(input: NewFeedback, effects: EffectType[]): Promise<{ row: FeedbackRow; created: boolean }>;
  findByRef(ref: string): Promise<FeedbackRow | undefined>;
  /** Claim up to `limit` due effects (sets attempts+1) so concurrent drains don't double-send. */
  claimDueEffects(limit: number, now: Date): Promise<Array<SideEffectRow & { feedback: FeedbackRow }>>;
  /** Mark done and apply the effect's outcome to the feedback row (timestamps only set if still null). */
  completeEffect(id: number, now: Date, patch?: FeedbackPatch): Promise<void>;
  failEffect(id: number, error: string, nextTryAt: Date): Promise<void>;
}

/** Binary storage for screenshots. S3 in production, in-memory in tests. */
export interface BlobStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Time-limited read URL (for embedding in the GitHub issue). */
  url(key: string, ttlSeconds: number): Promise<string>;
}
