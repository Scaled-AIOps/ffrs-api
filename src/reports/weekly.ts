import type { MetricsRow } from '../domain/metrics.js';

/** Markdown weekly report: last complete week per kind, plus a trailing-weeks table. Written for a GitHub issue. */
const TOKEN_WARN_DAYS = 21;

/** A line for the report when the tracker token expires within three weeks (or already has). */
export function tokenWarning(expiresAt: Date | null, now: Date): string | null {
  if (!expiresAt) return null;
  const days = Math.floor((expiresAt.getTime() - now.getTime()) / 86400_000);
  if (days > TOKEN_WARN_DAYS) return null;
  const when = expiresAt.toISOString().slice(0, 10);
  return `> **Action needed:** the GitHub token FFRS uses for this tracker ${days < 0 ? `expired on ${when}` : `expires on ${when} (${days} day${days === 1 ? '' : 's'})`}. Feedback cannot be filed without it. Extend or replace the token (Issues read/write on this repo) and update it with the FFRS operator.`;
}

export function weeklyReport(rows: MetricsRow[], weekMonday: string, siteName: string, warning: string | null = null): { title: string; body: string; labels: string[] } {
  const thisWeek = rows.filter((r) => r.week === weekMonday);
  const trend = rows.filter((r) => r.week <= weekMonday).slice(-12);
  const fmt = (s: number | null) => (s === null ? '—' : s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${(s / 3600).toFixed(1)} h` : `${(s / 86400).toFixed(1)} d`);
  const pctf = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
  const table = (rs: MetricsRow[]) => [
    '| Week | Kind | n | TTFR p50 | TTFR p90 | TTHR p50 | TTC p50 | Loop closure | Agent share | Signal |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...rs.map((r) => `| ${r.week} | ${r.kind} | ${r.n} | ${fmt(r.ttfrP50)} | ${fmt(r.ttfrP90)} | ${fmt(r.tthrP50)} | ${fmt(r.ttcP50)} | ${pctf(r.loopClosure)} | ${pctf(r.agentShare)} | ${pctf(r.signalRatio)} |`),
  ].join('\n');
  const total = thisWeek.reduce((a, r) => a + r.n, 0);
  const body = [
    ...(warning ? [warning, ''] : []),
    `FFRS metrics for **${siteName}**, week starting ${weekMonday}. ${total} item${total === 1 ? '' : 's'} captured.`,
    '',
    thisWeek.length ? table(thisWeek) : '_No feedback captured this week._',
    '',
    '<details><summary>Trailing weeks</summary>',
    '',
    trend.length ? table(trend) : '_No data yet._',
    '',
    '</details>',
    '',
    'Definitions: TTFR = first response (agent or human) − created; TTHR = first human comment − created; TTC = closed − created; loop closure = share closed; agent share = closed items resolved by an agent PR/execution; signal = share not spam/duplicate. Targets: TTFR < 1 h (agent) · TTHR < 72 h · TTC (bugs) < 30 d.',
  ].join('\n');
  return { title: `FFRS weekly report — week of ${weekMonday}`, body, labels: ['ffrs', 'ffrs-report'] };
}
