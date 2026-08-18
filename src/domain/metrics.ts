import type { IssueView, Kind, Tracker } from './ports.js';
import { deriveOutcome, kindOf } from './status.js';

/** One item as the metrics see it — everything derived from the GitHub issue, nothing personal. */
export type AgentPath = 'pr' | 'proposal' | 'executed' | 'skipped' | 'rejected' | null;
export interface Item {
  ref: string | null; kind: Kind; severity: string | null; outcome: string | null; spam: boolean;
  createdAt: Date; respondedAt: Date | null; humanRespondedAt: Date | null; closedAt: Date | null; issueUrl: string;
  agent: AgentPath; // from agent:* labels (Phase 8)
}

/** One row per (kind, ISO week); durations in seconds, null when no data. */
export interface MetricsRow {
  kind: Kind; week: string; n: number;
  ttfrP50: number | null; ttfrP90: number | null; // first response of any kind (agent included)
  tthrP50: number | null;                          // first human decision/comment
  ttcP50: number | null;
  loopClosure: number | null; signalRatio: number | null;
  agentShare: number | null;                       // closed items resolved via agent PR/execution
}

const REF = /<!--\s*ffrs:(FB-[A-Z0-9]{6})\s*-->/;

export async function collectItems(tracker: Tracker): Promise<Item[]> {
  const out: Item[] = [];
  for (const issue of await tracker.listIssues()) {
    const kind = kindOf(issue);
    if (!kind) continue;
    out.push({
      ref: REF.exec(issue.body)?.[1] ?? null, kind,
      severity: issue.labels.find((l) => l.startsWith('severity:'))?.slice(9) ?? null,
      outcome: issue.state === 'closed' ? deriveOutcome(kind, issue) : null,
      spam: issue.labels.includes('spam') || issue.labels.includes('outcome:duplicate') || issue.stateReason === 'duplicate',
      createdAt: issue.createdAt, ...(await responded(tracker, issue)),
      closedAt: issue.closedAt, issueUrl: issue.url,
      agent: (['pr', 'executed', 'proposal', 'skipped', 'rejected'] as const).find((p) => issue.labels.includes(`agent:${p}`)) ?? null,
    });
  }
  return out;
}

async function responded(tracker: Tracker, issue: IssueView): Promise<Pick<Item, 'respondedAt' | 'humanRespondedAt'>> {
  if (issue.comments === 0) return { respondedAt: null, humanRespondedAt: null };
  const f = await tracker.firstCommentsAt(issue.number);
  return { respondedAt: f.any, humanRespondedAt: f.human };
}

export function aggregate(items: Item[]): MetricsRow[] {
  const groups = new Map<string, Item[]>();
  for (const it of items) { const k = `${it.kind}|${mondayOf(it.createdAt)}`; groups.set(k, [...(groups.get(k) ?? []), it]); }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, g]) => {
    const [kind, week] = k.split('|') as [Kind, string];
    const d = (f: (i: Item) => Date | null) => g.map((i) => { const t = f(i); return t ? (t.getTime() - i.createdAt.getTime()) / 1000 : null; }).filter((x): x is number => x !== null);
    const ratio = (p: (i: Item) => boolean) => g.filter(p).length / g.length;
    return {
      kind, week, n: g.length,
      ttfrP50: pct(d((i) => i.respondedAt), 0.5), ttfrP90: pct(d((i) => i.respondedAt), 0.9), tthrP50: pct(d((i) => i.humanRespondedAt), 0.5),
      ttcP50: pct(d((i) => i.closedAt), 0.5),
      loopClosure: ratio((i) => i.closedAt !== null), signalRatio: ratio((i) => !i.spam),
      agentShare: g.some((i) => i.closedAt) ? g.filter((i) => i.closedAt && (i.agent === 'pr' || i.agent === 'executed')).length / g.filter((i) => i.closedAt).length : null,
    };
  });
}

/** Anonymised export row for the paper. */
export function toExportRow(i: Item) {
  return { ref: i.ref, kind: i.kind, severity: i.severity, outcome: i.outcome, spam: i.spam, agent: i.agent, createdAt: i.createdAt.toISOString(), respondedAt: i.respondedAt?.toISOString() ?? null, humanRespondedAt: i.humanRespondedAt?.toISOString() ?? null, closedAt: i.closedAt?.toISOString() ?? null, issueUrl: i.issueUrl };
}

/** Linear-interpolated percentile (like percentile_cont). */
export function pct(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
}

export function mondayOf(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}
