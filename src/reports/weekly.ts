import type { MetricsRow } from '../domain/metrics.js';

/** Markdown weekly report: last complete week per kind, plus a trailing-weeks table. Written for a GitHub issue. */
export function weeklyReport(rows: MetricsRow[], weekMonday: string, siteName: string): { title: string; body: string; labels: string[] } {
  const thisWeek = rows.filter((r) => r.week === weekMonday);
  const trend = rows.filter((r) => r.week <= weekMonday).slice(-12);
  const fmt = (s: number | null) => (s === null ? '—' : s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${(s / 3600).toFixed(1)} h` : `${(s / 86400).toFixed(1)} d`);
  const pctf = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
  const table = (rs: MetricsRow[]) => [
    '| Week | Kind | n | TTFR p50 | TTFR p90 | TTC p50 | Loop closure | Signal |',
    '|---|---|---:|---:|---:|---:|---:|---:|',
    ...rs.map((r) => `| ${r.week} | ${r.kind} | ${r.n} | ${fmt(r.ttfrP50)} | ${fmt(r.ttfrP90)} | ${fmt(r.ttcP50)} | ${pctf(r.loopClosure)} | ${pctf(r.signalRatio)} |`),
  ].join('\n');
  const total = thisWeek.reduce((a, r) => a + r.n, 0);
  const body = [
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
    'Definitions: TTFR = first human comment − issue created; TTC = closed − created; loop closure = share closed; signal = share not spam/duplicate. Targets: TTFR < 72 h · TTC (bugs) < 30 d.',
  ].join('\n');
  return { title: `FFRS weekly report — week of ${weekMonday}`, body, labels: ['ffrs', 'ffrs-report'] };
}
