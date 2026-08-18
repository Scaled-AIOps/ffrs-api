import type { FeedbackRow } from '../db/schema.js';

/** One row per (kind, ISO week) — mirrors the `ffrs_metrics` SQL view; durations in seconds, null when no data. */
export interface MetricsRow {
  kind: FeedbackRow['kind'];
  week: string;            // YYYY-MM-DD (Monday)
  n: number;
  ttaP50: number | null;   // acknowledge
  ttrP50: number | null;   // route
  ttfrP50: number | null;  // first human response
  ttfrP90: number | null;
  ttcP50: number | null;   // close
  loopClosure: number | null;
  signalRatio: number | null;
}

/** Anonymised per-item export for the paper: no body, email or screenshot; page path only. */
export interface ExportRow {
  ref: string; kind: string; severity: string | null; status: string; outcome: string | null;
  pagePath: string | null; hasEmail: boolean; hasScreenshot: boolean;
  createdAt: string; acknowledgedAt: string | null; routedAt: string | null; respondedAt: string | null; closedAt: string | null;
}

export function toExportRow(r: FeedbackRow): ExportRow {
  return {
    ref: r.ref, kind: r.kind, severity: r.severity, status: r.status, outcome: r.outcome,
    pagePath: r.pageUrl ? safePath(r.pageUrl) : null, hasEmail: r.email !== null, hasScreenshot: r.screenshotKey !== null,
    createdAt: r.createdAt.toISOString(), acknowledgedAt: iso(r.acknowledgedAt), routedAt: iso(r.routedAt), respondedAt: iso(r.respondedAt), closedAt: iso(r.closedAt),
  };
}

/** Pure TS aggregation with the same semantics as the SQL view — used by memoryRepo and to cross-check Neon. */
export function aggregate(rows: FeedbackRow[]): MetricsRow[] {
  const groups = new Map<string, FeedbackRow[]>();
  for (const r of rows) {
    const k = `${r.kind}|${mondayOf(r.createdAt)}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, g]) => {
    const [kind, week] = k.split('|') as [FeedbackRow['kind'], string];
    const d = (f: (r: FeedbackRow) => Date | null) => g.map((r) => { const t = f(r); return t ? (t.getTime() - r.createdAt.getTime()) / 1000 : null; }).filter((x): x is number => x !== null);
    const ratio = (pred: (r: FeedbackRow) => boolean) => g.filter(pred).length / g.length;
    return {
      kind, week, n: g.length,
      ttaP50: pct(d((r) => r.acknowledgedAt), 0.5), ttrP50: pct(d((r) => r.routedAt), 0.5),
      ttfrP50: pct(d((r) => r.respondedAt), 0.5), ttfrP90: pct(d((r) => r.respondedAt), 0.9), ttcP50: pct(d((r) => r.closedAt), 0.5),
      loopClosure: ratio((r) => r.closedAt !== null), signalRatio: ratio((r) => r.status !== 'spam' && r.status !== 'duplicate'),
    };
  });
}

/** Linear-interpolated percentile, like percentile_cont. */
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

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const safePath = (u: string) => { try { return new URL(u).pathname; } catch { return null; } };
