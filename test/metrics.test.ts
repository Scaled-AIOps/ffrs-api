import { describe, expect, it } from 'vitest';
import { memoryRepo } from '../src/db/memoryRepo.js';
import { toCsv } from '../src/domain/csv.js';
import { capture } from '../src/domain/feedback.js';
import { aggregate, mondayOf, pct, toExportRow } from '../src/domain/metrics.js';
import { runWeeklyReport } from '../src/reports/run.js';
import { weeklyReport } from '../src/reports/weekly.js';
import { cfg, validBug, validFeature } from './helpers.js';

const H = 3600_000;

describe('metrics', () => {
  it('pct interpolates like percentile_cont; mondayOf is ISO-week Monday (UTC)', () => {
    expect(pct([], 0.5)).toBeNull();
    expect(pct([10], 0.9)).toBe(10);
    expect(pct([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(pct([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(9.1);
    expect(mondayOf(new Date('2026-08-20T23:30:00Z'))).toBe('2026-08-17'); // Thursday → Monday
    expect(mondayOf(new Date('2026-08-23T00:00:00Z'))).toBe('2026-08-17'); // Sunday → same Monday
    expect(mondayOf(new Date('2026-08-24T00:00:00Z'))).toBe('2026-08-24');
  });

  it('aggregate groups by kind+week and computes stage durations, closure and signal', async () => {
    const repo = memoryRepo();
    const t0 = new Date('2026-08-18T10:00:00Z');
    await capture({ repo }, validBug as never, { now: t0 });
    await capture({ repo }, { ...validBug, title: 'Second bug here' } as never, { now: new Date(t0.getTime() + H) });
    await capture({ repo }, validFeature as never, { now: t0 });
    await capture({ repo }, validFeature as never, { now: new Date('2026-08-25T10:00:00Z') }); // next week
    const [b1, b2, f1] = repo.rows;
    Object.assign(b1!, { acknowledgedAt: new Date(t0.getTime() + 60_000), routedAt: new Date(t0.getTime() + 120_000), respondedAt: new Date(t0.getTime() + 10 * H), closedAt: new Date(t0.getTime() + 48 * H), status: 'closed' });
    Object.assign(b2!, { respondedAt: new Date(b2!.createdAt.getTime() + 30 * H), status: 'spam' });
    Object.assign(f1!, { status: 'duplicate' });

    const m = aggregate(repo.rows);
    expect(m.map((r) => `${r.kind}@${r.week}:${r.n}`)).toEqual(['bug@2026-08-17:2', 'feature@2026-08-17:1', 'feature@2026-08-24:1']);
    const bugs = m[0]!;
    expect(bugs.ttaP50).toBe(60);
    expect(bugs.ttrP50).toBe(120);
    expect(bugs.ttfrP50).toBe(20 * 3600); // median of 10h and 30h
    expect(bugs.ttcP50).toBe(48 * 3600);
    expect(bugs.loopClosure).toBe(0.5);
    expect(bugs.signalRatio).toBe(0.5);
    expect(m[1]).toMatchObject({ ttfrP50: null, loopClosure: 0, signalRatio: 0 });
    expect(await repo.metrics()).toEqual(m);
  });

  it('export rows are anonymised', async () => {
    const repo = memoryRepo();
    await capture({ repo, blobs: { put: async () => {}, url: async () => '' } }, { ...validBug, screenshot: 'data:image/jpeg;base64,AAAA' } as never);
    const [row] = await repo.exportAll();
    expect(row).toMatchObject({ kind: 'bug', severity: 'medium', pagePath: '/', hasEmail: true, hasScreenshot: true });
    expect(JSON.stringify(row)).not.toMatch(/example\.org|iPhone|375px/);
    const csv = toCsv([{ a: 1, b: 'x,"y"', c: null, d: new Date('2026-01-01T00:00:00Z') }]);
    expect(csv).toBe('a,b,c,d\r\n1,"x,""y""",,2026-01-01T00:00:00.000Z\r\n');
    expect(toExportRow(repo.rows[0]!).createdAt).toMatch(/Z$/);
  });

  it('weekly report renders tables and posts an issue when GitHub is configured', async () => {
    const rows = [{ kind: 'bug' as const, week: '2026-08-10', n: 3, ttaP50: 50, ttrP50: 100, ttfrP50: 20 * 3600, ttfrP90: 60 * 3600, ttcP50: 3 * 86400, loopClosure: 1, signalRatio: 0.67 }];
    const r = weeklyReport(rows, '2026-08-10', 'scaledaiops.org');
    expect(r.title).toBe('FFRS weekly report — week of 2026-08-10');
    expect(r.body).toContain('| 2026-08-10 | bug | 3 | 1 min | 2 min | 20.0 h | 2.5 d | 3.0 d | 100% | 67% |');
    expect(weeklyReport(rows, '2026-08-17', 'x').body).toContain('_No feedback captured this week._');

    const repo = memoryRepo();
    const posted: string[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => { posted.push(String(init.body)); return new Response(JSON.stringify({ html_url: 'https://github.com/o/r/issues/42' })); }) as unknown as typeof fetch;
    const out = await runWeeklyReport(repo, { ...cfg, GITHUB_REPO: 'o/r', GITHUB_TOKEN: 't' }, new Date('2026-08-24T07:00:00Z'), fetchImpl);
    expect(out).toEqual({ week: '2026-08-17', url: 'https://github.com/o/r/issues/42' });
    expect(JSON.parse(posted[0]!).labels).toEqual(['ffrs', 'ffrs-report']);
    expect(await runWeeklyReport(repo, cfg, new Date('2026-08-24T07:00:00Z'))).toEqual({ week: '2026-08-17' });
  });
});
