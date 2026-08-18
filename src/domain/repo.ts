import type { FeedbackRow, NewFeedback, SideEffectRow } from '../db/schema.js';
import type { ExportRow, MetricsRow } from './metrics.js';

export type EffectType = 'ack_email' | 'github_issue' | 'alert_email' | 'close_email';
export type FeedbackPatch = Partial<Pick<FeedbackRow, 'acknowledgedAt' | 'routedAt' | 'respondedAt' | 'closedAt' | 'githubIssueUrl' | 'status' | 'outcome'>>;

/** Persistence boundary. Neon in production, in-memory in tests — the domain never sees a driver. */
export interface FeedbackRepo {
  /** Insert feedback and its outbox rows atomically. Returns the existing row when idempotencyKey matches. */
  create(input: NewFeedback, effects: EffectType[]): Promise<{ row: FeedbackRow; created: boolean }>;
  findByRef(ref: string): Promise<FeedbackRow | undefined>;
  findByIssueUrl(url: string): Promise<FeedbackRow | undefined>;
  /** Apply a state transition exactly as given (webhooks) and queue follow-up effects. */
  update(id: number, patch: FeedbackPatch, effects?: EffectType[]): Promise<void>;
  /** Claim up to `limit` due effects (sets attempts+1) so concurrent drains don't double-send. */
  claimDueEffects(limit: number, now: Date): Promise<Array<SideEffectRow & { feedback: FeedbackRow }>>;
  /** Mark done and apply the effect's outcome to the feedback row (timestamps only set if still null). */
  completeEffect(id: number, now: Date, patch?: FeedbackPatch): Promise<void>;
  failEffect(id: number, error: string, nextTryAt: Date): Promise<void>;
  /** Weekly FFRS metrics (the `ffrs_metrics` view), oldest first. */
  metrics(): Promise<MetricsRow[]>;
  /** Anonymised per-item rows for analysis/export. */
  exportAll(): Promise<ExportRow[]>;
}

/** Binary storage for screenshots. S3 in production, in-memory in tests. */
export interface BlobStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Time-limited read URL (for embedding in the GitHub issue). */
  url(key: string, ttlSeconds: number): Promise<string>;
}
