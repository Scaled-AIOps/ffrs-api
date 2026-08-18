import { describe, expect, it } from 'vitest';
import type { FeedbackRow } from '../src/db/schema.js';
import { ackEmail, alertEmail, buildEffects, githubIssue } from '../src/effects/index.js';
import type { Mail } from '../src/effects/mailer.js';
import { cfg } from './helpers.js';

const b = { siteName: 'scaledaiops.org', siteUrl: 'https://www.scaledaiops.org' };
const row: FeedbackRow = {
  id: 1, ref: 'FB-7K3M2Q', idempotencyKey: null, kind: 'bug', title: 'Nav overlaps hero', body: 'On 375px the toggle covers the h1.',
  pageUrl: 'https://www.scaledaiops.org/', severity: 'high', screenshotKey: '2026-08-18/FB-7K3M2Q.jpg', meta: { vw: 375 },
  email: 'v@example.org', consent: true, status: 'new', outcome: null, githubIssueUrl: null,
  createdAt: new Date('2026-08-18T10:00:00Z'), acknowledgedAt: null, routedAt: null, respondedAt: null, closedAt: null,
};

describe('effects', () => {
  it('ack email: to submitter with ref + status link; skipped when no email', async () => {
    const sent: Mail[] = [];
    await ackEmail(b, async (m) => { sent.push(m); })(row);
    expect(sent[0]).toMatchObject({ to: 'v@example.org', subject: '[FB-7K3M2Q] We received your bug report' });
    expect(sent[0]!.text).toContain('https://www.scaledaiops.org/feedback/?ref=FB-7K3M2Q');
    expect(sent[0]!.html).toContain('<a href="https://www.scaledaiops.org/feedback/?ref=FB-7K3M2Q">');
    await ackEmail(b, async (m) => { sent.push(m); })({ ...row, email: null });
    expect(sent).toHaveLength(1);
  });

  it('alert email: to maintainers with severity, body and issue link', async () => {
    const sent: Mail[] = [];
    await alertEmail(b, async (m) => { sent.push(m); }, 'team@example.org')({ ...row, githubIssueUrl: 'https://github.com/o/r/issues/9' });
    expect(sent[0]!.subject).toBe('[FFRS] bug/high: Nav overlaps hero');
    expect(sent[0]!.text).toContain('https://github.com/o/r/issues/9');
    expect(sent[0]!.text).toContain('On 375px');
  });

  it('github issue: posts labelled issue with presigned screenshot, returns url; HTTP error throws', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const okFetch = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ html_url: 'https://github.com/o/r/issues/1' })); }) as unknown as typeof fetch;
    const blobs = { put: async () => {}, url: async (k: string, ttl: number) => `https://s3/${k}?ttl=${ttl}` };
    const patch = await githubIssue(b, 'o/r', 'tok', blobs, okFetch)(row);
    expect(patch).toEqual({ githubIssueUrl: 'https://github.com/o/r/issues/1' });
    expect(calls[0]!.url).toBe('https://api.github.com/repos/o/r/issues');
    expect((calls[0]!.init.headers as Record<string, string>)['authorization']).toBe('Bearer tok');
    const sent = JSON.parse(String(calls[0]!.init.body));
    expect(sent.title).toBe('[bug] Nav overlaps hero');
    expect(sent.labels).toEqual(['ffrs', 'kind:bug', 'severity:high']);
    expect(sent.body).toContain('![screenshot](https://s3/2026-08-18/FB-7K3M2Q.jpg?ttl=604800)');
    expect(sent.body).not.toContain('v@example.org'); // email never leaks into the public issue
    const badFetch = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
    await expect(githubIssue(b, 'o/r', 'tok', undefined, badFetch)(row)).rejects.toThrow(/401/);
  });

  it('buildEffects registers only what config supports', () => {
    const none = buildEffects(cfg);
    expect(Object.keys(none)).toEqual([]);
    const all = buildEffects({ ...cfg, FROM_EMAIL: 'f@x.org', ALERT_EMAIL: 'a@x.org', GITHUB_REPO: 'o/r', GITHUB_TOKEN: 't' }, { mailer: async () => {} });
    expect(Object.keys(all).sort()).toEqual(['ack_email', 'alert_email', 'close_email', 'github_issue']);
  });
});

describe('close email', () => {
  it('states the outcome, links the issue and status page', async () => {
    const { closeEmail } = await import('../src/effects/index.js');
    const sent: Mail[] = [];
    await closeEmail(b, async (m) => { sent.push(m); })({ ...row, outcome: 'fixed', githubIssueUrl: 'https://github.com/o/r/issues/7', status: 'closed' });
    expect(sent[0]!.subject).toBe('[FB-7K3M2Q] fixed: Nav overlaps hero');
    expect(sent[0]!.text).toContain('has been fixed');
    expect(sent[0]!.text).toContain('https://github.com/o/r/issues/7');
    expect(sent[0]!.text).toContain('/feedback/?ref=FB-7K3M2Q');
  });
});
