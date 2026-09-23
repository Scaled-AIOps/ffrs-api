import { describe, expect, it } from 'vitest';
import { memoryTracker } from '../src/adapters/memory.js';
import { toCsv } from '../src/domain/csv.js';
import { aggregate, collectItems, mondayOf, pct, toExportRow } from '../src/domain/metrics.js';
import { runWeeklyReports } from '../src/reports/run.js';
import { registry } from '../src/tenants.js';
import { tenant } from './helpers.js';
import { weeklyReport } from '../src/reports/weekly.js';

const H = 3600_000;

describe('metrics from GitHub', () => {
  it('pct interpolates like percentile_cont; mondayOf is ISO-week Monday (UTC)', () => {
    expect(pct([], 0.5)).toBeNull();
    expect(pct([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(pct([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(9.1);
    expect(mondayOf(new Date('2026-08-20T23:30:00Z'))).toBe('2026-08-17');
    expect(mondayOf(new Date('2026-08-23T00:00:00Z'))).toBe('2026-08-17');
    expect(mondayOf(new Date('2026-08-24T00:00:00Z'))).toBe('2026-08-24');
  });

  it('collectItems + aggregate: kind from labels, respond from first human comment, spam via label, report issues ignored', async () => {
    let clock = new Date('2026-08-18T10:00:00Z');
    const t = memoryTracker(() => clock);
    await t.createIssue({ title: '[bug] a', body: '<!-- ffrs:FB-AAAAAA -->', labels: ['ffrs', 'kind:bug', 'severity:high'] });
    clock = new Date(clock.getTime() + H);
    await t.createIssue({ title: '[bug] b', body: '<!-- ffrs:FB-BBBBBB -->', labels: ['ffrs', 'kind:bug', 'severity:low', 'spam'] });
    await t.createIssue({ title: '[feature] c', body: '<!-- ffrs:FB-CCCCCC -->', labels: ['ffrs', 'kind:feature'] });
    await t.createIssue({ title: 'FFRS weekly report', body: 'x', labels: ['ffrs', 'ffrs-report'] }); // no kind → not an item
    clock = new Date('2026-08-25T10:00:00Z');
    await t.createIssue({ title: '[feature] d', body: '', labels: ['ffrs', 'kind:feature'] });
    const t0 = new Date('2026-08-18T10:00:00Z');
    t.comment(1, new Date(t0.getTime() + 2 * H), false); // bot — ignored
    t.comment(1, new Date(t0.getTime() + 10 * H));
    t.comment(2, new Date(t0.getTime() + 31 * H));
    t.close(1, new Date(t0.getTime() + 48 * H));

    const items = await collectItems(t);
    expect(items.map((i) => `${i.kind}:${i.ref}`)).toEqual(['bug:FB-AAAAAA', 'bug:FB-BBBBBB', 'feature:FB-CCCCCC', 'feature:null']);
    expect(items[0]).toMatchObject({ severity: 'high', outcome: 'fixed', spam: false, agent: null, humanRespondedAt: new Date(t0.getTime() + 10 * H), respondedAt: new Date(t0.getTime() + 2 * H) });
    expect(items[1]).toMatchObject({ spam: true, outcome: null });

    const m = aggregate(items);
    expect(m.map((r) => `${r.kind}@${r.week}:${r.n}`)).toEqual(['bug@2026-08-17:2', 'feature@2026-08-17:1', 'feature@2026-08-24:1']);
    expect(m[0]).toMatchObject({ ttfrP50: 16 * 3600, tthrP50: 20 * 3600, ttcP50: 48 * 3600, loopClosure: 0.5, signalRatio: 0.5, agentShare: 0 });
    expect(m[1]).toMatchObject({ ttfrP50: null, loopClosure: 0, signalRatio: 1, agentShare: null });
    expect(JSON.stringify(items.map(toExportRow))).not.toMatch(/example\.org/);
    expect(toCsv([{ a: 1, b: 'x,"y"', c: null }])).toBe('a,b,c\r\n1,"x,""y""",\r\n');
  });

  it('weekly report renders and is filed as an issue', async () => {
    const rows = [{ kind: 'bug' as const, week: '2026-08-10', n: 3, ttfrP50: 20 * 3600, ttfrP90: 60 * 3600, tthrP50: 24 * 3600, ttcP50: 3 * 86400, loopClosure: 1, signalRatio: 0.67, agentShare: 0.5 }];
    const r = weeklyReport(rows, '2026-08-10', 'scaledaiops.org');
    expect(r.body).toContain('| 2026-08-10 | bug | 3 | 20.0 h | 2.5 d | 1.0 d | 3.0 d | 100% | 50% | 67% |');
    expect(weeklyReport(rows, '2026-08-17', 'x').body).toContain('_No feedback captured this week._');
    const t = memoryTracker(), t2 = memoryTracker(), blobs = new Map<string, string>();
    await t2.createIssue({ title: '[bug] x', body: '<!-- ffrs:FB-XXXXXX -->', labels: ['ffrs', 'kind:bug'] });
    const optedOut = { ...tenant, slug: 'quiet', trackerRepo: 'o/q', research: false };
    const deps = {
      tenants: async () => registry([tenant, optedOut], tenant.slug),
      runtime: (x: typeof tenant) => ({ tracker: x.slug === 'quiet' ? t2 : t }),
      store: { putBlob: async (k: string, b: Uint8Array) => { blobs.set(k, Buffer.from(b).toString()); } },
    };
    const out = await runWeeklyReports(deps, new Date('2026-08-24T07:00:00Z'));
    expect(out).toEqual({ week: '2026-08-17', reports: [{ tenant: 'scaledaiops', url: 'https://github.com/o/r/issues/1' }, { tenant: 'quiet', url: 'https://github.com/o/r/issues/2' }], researchRows: 0 });
    expect(t.issues[0]!.labels).toEqual(['ffrs', 'ffrs-report']);
    expect(blobs.size).toBe(0); // nothing captured on the opted-in tenant, and the other opted out
    await t.createIssue({ title: '[feature] y', body: '<!-- ffrs:FB-YYYYYY -->', labels: ['ffrs', 'kind:feature'] });
    const again = await runWeeklyReports(deps, new Date('2026-08-24T07:00:00Z'));
    expect(again.researchRows).toBe(1);
    const csv = blobs.get('research/2026-08-17.csv')!;
    expect(csv.split('\r\n')[0]).toBe('site,ref,kind,severity,outcome,spam,agent,createdAt,respondedAt,humanRespondedAt,closedAt');
    expect(csv).toContain('S1,FB-YYYYYY,feature');
    expect(csv).not.toContain('github.com');
  });
});
