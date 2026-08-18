import type { Kind, Outcome, IssueView, Sidecar, Tracker } from './ports.js';

/** Public timeline for GET /api/feedback/:ref — timestamps only, nothing personal. */
export interface StatusView {
  ref: string; kind: Kind; status: 'routed' | 'responded' | 'closed'; outcome: Outcome | null; githubIssueUrl: string;
  createdAt: string; acknowledgedAt: string | null; routedAt: string; respondedAt: string | null; closedAt: string | null;
}

const OUTCOMES: Outcome[] = ['fixed', 'shipped', 'answered', 'declined', 'wontfix', 'duplicate'];
const DEFAULT_COMPLETED: Record<Kind, Outcome> = { bug: 'fixed', feature: 'shipped', contact: 'answered' };

/** `outcome:<x>` label › GitHub state_reason › kind default. */
export function deriveOutcome(kind: Kind, issue: Pick<IssueView, 'labels' | 'stateReason'>): Outcome {
  for (const l of issue.labels) {
    const m = /^outcome:(\w+)$/.exec(l);
    if (m && (OUTCOMES as string[]).includes(m[1]!)) return m[1] as Outcome;
  }
  if (issue.stateReason === 'not_planned') return 'declined';
  if (issue.stateReason === 'duplicate') return 'duplicate';
  return DEFAULT_COMPLETED[kind];
}

export function kindOf(issue: Pick<IssueView, 'labels'>): Kind | null {
  const k = issue.labels.find((l) => l.startsWith('kind:'))?.slice(5);
  return k === 'bug' || k === 'feature' || k === 'contact' ? k : null;
}

export async function statusOf(tracker: Tracker, s: Sidecar): Promise<StatusView | undefined> {
  const issue = await tracker.getIssue(s.issueNumber);
  if (!issue) return undefined;
  const respondedAt = issue.comments > 0 ? await tracker.firstHumanCommentAt(issue.number) : null;
  const closed = issue.state === 'closed';
  return {
    ref: s.ref, kind: s.kind, status: closed ? 'closed' : respondedAt ? 'responded' : 'routed',
    outcome: closed ? deriveOutcome(s.kind, issue) : null, githubIssueUrl: s.issueUrl,
    createdAt: s.createdAt, acknowledgedAt: s.acknowledgedAt, routedAt: issue.createdAt.toISOString(),
    respondedAt: respondedAt?.toISOString() ?? null, closedAt: issue.closedAt?.toISOString() ?? null,
  };
}
