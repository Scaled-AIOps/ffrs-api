import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { FeedbackRow } from '../db/schema.js';
import type { EffectType, FeedbackPatch } from './repo.js';

/** GitHub → FFRS stage transitions (Respond, Close, and re-open). Pure: no I/O. */

const Issue = z.object({
  html_url: z.string().url(),
  state_reason: z.enum(['completed', 'not_planned', 'duplicate', 'reopened']).nullable().optional(),
  labels: z.array(z.object({ name: z.string() })).default([]),
});
export const IssuesEvent = z.object({ action: z.string(), issue: Issue });
export const IssueCommentEvent = z.object({
  action: z.string(),
  issue: Issue,
  comment: z.object({ user: z.object({ type: z.string(), login: z.string() }) }),
});

export type Outcome = NonNullable<FeedbackRow['outcome']>;
const OUTCOMES: Outcome[] = ['fixed', 'shipped', 'answered', 'declined', 'wontfix', 'duplicate'];
const DEFAULT_COMPLETED: Record<FeedbackRow['kind'], Outcome> = { bug: 'fixed', feature: 'shipped', contact: 'answered' };

/** `outcome:<x>` label wins; otherwise infer from GitHub's state_reason and the feedback kind. */
export function deriveOutcome(kind: FeedbackRow['kind'], issue: z.infer<typeof Issue>): Outcome {
  for (const l of issue.labels) {
    const m = /^outcome:(\w+)$/.exec(l.name);
    if (m && (OUTCOMES as string[]).includes(m[1]!)) return m[1] as Outcome;
  }
  if (issue.state_reason === 'not_planned') return 'declined';
  if (issue.state_reason === 'duplicate') return 'duplicate';
  return DEFAULT_COMPLETED[kind];
}

export interface Transition { issueUrl: string; patch: (row: FeedbackRow) => FeedbackPatch; effects: (row: FeedbackRow) => EffectType[] }

/** Map a verified event to a transition, or null if the event is irrelevant. */
export function githubTransition(event: string, payload: unknown, now: Date): Transition | null {
  if (event === 'issues') {
    const e = IssuesEvent.parse(payload);
    if (e.action === 'closed') {
      return {
        issueUrl: e.issue.html_url,
        patch: (row) => ({ status: 'closed', outcome: deriveOutcome(row.kind, e.issue), closedAt: row.closedAt ?? now, respondedAt: row.respondedAt ?? now }),
        effects: (row) => (row.email ? ['close_email'] : []),
      };
    }
    if (e.action === 'reopened') {
      return { issueUrl: e.issue.html_url, patch: () => ({ status: 'routed', outcome: null, closedAt: null }), effects: () => [] };
    }
    return null;
  }
  if (event === 'issue_comment') {
    const e = IssueCommentEvent.parse(payload);
    if (e.action !== 'created' || e.comment.user.type !== 'User') return null; // bots don't count as a response
    return {
      issueUrl: e.issue.html_url,
      patch: (row) => ({ respondedAt: row.respondedAt ?? now, ...(row.status === 'routed' || row.status === 'new' ? { status: 'responded' as const } : {}) }),
      effects: () => [],
    };
  }
  return null;
}

export function verifyGithubSignature(secret: string, rawBody: string, signatureHeader: string | undefined): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`);
  const given = Buffer.from(signatureHeader);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
