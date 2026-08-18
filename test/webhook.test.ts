import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deriveOutcome, githubTransition, verifyGithubSignature } from '../src/domain/webhook.js';
import { drainOutbox } from '../src/outbox.js';
import { evt, testApp, validBug } from './helpers.js';

const now = new Date('2026-08-20T09:00:00Z');
type Issue = Parameters<typeof deriveOutcome>[1];
const issue = (over: Partial<Issue> = {}): Issue => ({ html_url: 'https://github.com/o/r/issues/7', state_reason: 'completed', labels: [], ...over });
const sign = (secret: string, body: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

describe('githubTransition', () => {
  it('derives outcome: label > state_reason > kind default', () => {
    expect(deriveOutcome('bug', issue())).toBe('fixed');
    expect(deriveOutcome('feature', issue())).toBe('shipped');
    expect(deriveOutcome('contact', issue())).toBe('answered');
    expect(deriveOutcome('bug', issue({ state_reason: 'not_planned' }))).toBe('declined');
    expect(deriveOutcome('bug', issue({ state_reason: 'duplicate' }))).toBe('duplicate');
    expect(deriveOutcome('bug', issue({ state_reason: 'not_planned', labels: [{ name: 'outcome:wontfix' }] }))).toBe('wontfix');
    expect(deriveOutcome('bug', issue({ labels: [{ name: 'outcome:bogus' }] }))).toBe('fixed');
  });
  it('closed → closed+outcome+timestamps and close_email only with email; reopened → back to routed', () => {
    const t = githubTransition('issues', { action: 'closed', issue: issue() }, now)!;
    const row = { kind: 'bug', closedAt: null, respondedAt: null, email: 'v@x.org' } as never;
    expect(t.patch(row)).toEqual({ status: 'closed', outcome: 'fixed', closedAt: now, respondedAt: now });
    expect(t.effects(row)).toEqual(['close_email']);
    expect(t.effects({ ...(row as object), email: null } as never)).toEqual([]);
    const r = githubTransition('issues', { action: 'reopened', issue: issue({ state_reason: 'reopened' }) }, now)!;
    expect(r.patch(row)).toEqual({ status: 'routed', outcome: null, closedAt: null });
  });
  it('human comment → responded (first-write); bots and other events ignored', () => {
    const c = githubTransition('issue_comment', { action: 'created', issue: issue(), comment: { user: { type: 'User', login: 'maint' } } }, now)!;
    expect(c.patch({ status: 'routed', respondedAt: null } as never)).toEqual({ respondedAt: now, status: 'responded' });
    const earlier = new Date('2026-08-19T00:00:00Z');
    expect(c.patch({ status: 'closed', respondedAt: earlier } as never)).toEqual({ respondedAt: earlier });
    expect(githubTransition('issue_comment', { action: 'created', issue: issue(), comment: { user: { type: 'Bot', login: 'x[bot]' } } }, now)).toBeNull();
    expect(githubTransition('issues', { action: 'labeled', issue: issue() }, now)).toBeNull();
    expect(githubTransition('ping', {}, now)).toBeNull();
  });
  it('signature verification is exact and constant-length', () => {
    expect(verifyGithubSignature('s', 'body', sign('s', 'body'))).toBe(true);
    expect(verifyGithubSignature('s', 'body', sign('t', 'body'))).toBe(false);
    expect(verifyGithubSignature('s', 'body', 'sha1=abc')).toBe(false);
    expect(verifyGithubSignature('s', 'body', undefined)).toBe(false);
  });
});

describe('POST /api/webhooks/github', () => {
  const secret = 'whsec';
  const post = (app: ReturnType<typeof testApp>['app'], event: string, payload: unknown, sig?: string) => {
    const body = JSON.stringify(payload);
    return app({ ...evt('POST', '/api/webhooks/github', undefined, { 'x-github-event': event, 'x-hub-signature-256': sig ?? sign(secret, body) }), body });
  };
  it('404 when no secret configured, 401 on bad signature', async () => {
    const off = testApp();
    expect((await post(off.app, 'issues', {})).statusCode).toBe(404);
    const on = testApp({ cfg: { ...off.deps.cfg, GITHUB_WEBHOOK_SECRET: secret } });
    expect((await post(on.app, 'issues', { action: 'closed', issue: issue() }, 'sha256=00')).statusCode).toBe(401);
  });
  it('closes the loop: issue closed → row closed, close_email queued and drained to the submitter', async () => {
    const base = testApp();
    const { app, repo } = testApp({ cfg: { ...base.deps.cfg, GITHUB_WEBHOOK_SECRET: secret } });
    await app(evt('POST', '/api/feedback', validBug));
    await repo.update(repo.rows[0]!.id, { githubIssueUrl: 'https://github.com/o/r/issues/7', status: 'routed', routedAt: now });

    const c = await post(app, 'issue_comment', { action: 'created', issue: issue(), comment: { user: { type: 'User', login: 'maint' } } });
    expect(c.statusCode).toBe(200);
    expect(repo.rows[0]!.status).toBe('responded');

    const r = await post(app, 'issues', { action: 'closed', issue: issue({ labels: [{ name: 'outcome:wontfix' }] }) });
    expect(JSON.parse(r.body!)).toMatchObject({ ref: repo.rows[0]!.ref, status: 'closed', outcome: 'wontfix' });
    expect(repo.effects.filter((e) => e.type === 'close_email')).toHaveLength(1);

    const sent: string[] = [];
    await drainOutbox(repo, { close_email: async (f) => { sent.push(`${f.email}:${f.outcome}`); } }, 25, new Date());
    expect(sent).toEqual(['v@example.org:wontfix']);

    const unknown = await post(app, 'issues', { action: 'closed', issue: issue({ html_url: 'https://github.com/o/r/issues/999' }) });
    expect(JSON.parse(unknown.body!)).toMatchObject({ ignored: true });
  });
});
