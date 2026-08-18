import { sql } from 'drizzle-orm';
import { bigint, boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const feedbackKind = pgEnum('feedback_kind', ['bug', 'feature', 'contact']);
export const feedbackStatus = pgEnum('feedback_status', ['new', 'routed', 'responded', 'closed', 'spam', 'duplicate']);
export const feedbackOutcome = pgEnum('feedback_outcome', ['fixed', 'shipped', 'answered', 'declined', 'wontfix', 'duplicate']);
export const feedbackSeverity = pgEnum('feedback_severity', ['low', 'medium', 'high', 'critical']);

// FFRS stages are timestamps: capture → acknowledge → route → respond → close.
export const feedback = pgTable(
  'feedback',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    ref: text('ref').notNull(),
    idempotencyKey: text('idempotency_key'),
    kind: feedbackKind('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    pageUrl: text('page_url'),
    severity: feedbackSeverity('severity'),
    screenshotKey: text('screenshot_key'),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    email: text('email'),
    consent: boolean('consent').notNull().default(false),
    status: feedbackStatus('status').notNull().default('new'),
    outcome: feedbackOutcome('outcome'),
    githubIssueUrl: text('github_issue_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    routedAt: timestamp('routed_at', { withTimezone: true }),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('feedback_ref_idx').on(t.ref),
    uniqueIndex('feedback_idempotency_idx').on(t.idempotencyKey),
    index('feedback_kind_status_created_idx').on(t.kind, t.status, t.createdAt),
  ],
);

// Outbox: side effects are queued in the same transaction as the insert and drained by schedule.
export const sideEffects = pgTable(
  'side_effects',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    feedbackId: bigint('feedback_id', { mode: 'number' }).notNull().references(() => feedback.id),
    type: text('type').notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextTryAt: timestamp('next_try_at', { withTimezone: true }).notNull().defaultNow(),
    doneAt: timestamp('done_at', { withTimezone: true }),
    lastError: text('last_error'),
  },
  (t) => [index('side_effects_pending_idx').on(t.nextTryAt).where(sql`${t.doneAt} is null`)],
);

export type FeedbackRow = typeof feedback.$inferSelect;
export type NewFeedback = typeof feedback.$inferInsert;
export type SideEffectRow = typeof sideEffects.$inferSelect;
