import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deriveOutcome } from '../src/domain/status.js';
import { verifyGithubSignature } from '../src/domain/webhook.js';
import { body, evt, testApp, validBug } from './helpers.js';

const sign = (secret: string, b: string) => `sha256=${createHmac('sha256', secret).update(b).digest('hex')}`;

describe('outcome + signature', () => {
  it('label > state_reason > kind default', () => {
    expect(deriveOutcome('bug', { labels: [], stateReason: 'completed' })).toBe('fixed');
    expect(deriveOutcome('feature', { labels: [], stateReason: null })).toBe('shipped');
    expect(deriveOutcome('contact', { labels: [], stateReason: 'completed' })).toBe('answered');
    expect(deriveOutcome('bug', { labels: [], stateReason: 'not_planned' })).toBe('declined');
    expect(deriveOutcome('bug', { labels: [], stateReason: 'duplicate' })).toBe('duplicate');
    expect(deriveOutcome('bug', { labels: ['outcome:wontfix'], stateReason: 'not_planned' })).toBe('wontfix');
    expect(deriveOutcome('bug', { labels: ['outcome:bogus'], stateReason: 'completed' })).toBe('fixed');
  });
  it('signature is exact', () => {
    expect(verifyGithubSignature('s', 'b', sign('s', 'b'))).toBe(true);
    expect(verifyGithubSignature('s', 'b', sign('t', 'b'))).toBe(false);
    expect(verifyGithubSignature('s', 'b', undefined)).toBe(false);
  });
});

describe('POST /api/webhooks/github', () => {
  const secret = 'whsec';
  const post = (app: ReturnType<typeof testApp>['app'], event: string, payload: unknown, sig?: string) => {
    const b = JSON.stringify(payload);
    return app({ ...evt('POST', '/api/webhooks/github', undefined, { 'x-github-event': event, 'x-hub-signature-256': sig ?? sign(secret, b) }), body: b });
  };
  it('404 without secret; 401 bad signature', async () => {
    const off = testApp();
    expect((await post(off.app, 'issues', {})).statusCode).toBe(404);
    const on = testApp({ cfg: { ...off.deps.cfg, GITHUB_WEBHOOK_SECRET: secret } });
    expect((await post(on.app, 'issues', { action: 'closed', issue: { number: 1, html_url: 'u', body: '' } }, 'sha256=00')).statusCode).toBe(401);
  });
  it('issue closed → closing email once; reopened re-arms; unknown issues ignored', async () => {
    const base = testApp();
    const { app, tracker, store, sent } = testApp({ cfg: { ...base.deps.cfg, GITHUB_WEBHOOK_SECRET: secret } });
    const { ref } = body(await app(evt('POST', '/api/feedback', validBug)));
    sent.length = 0;
    const issue = { number: 1, html_url: tracker.issues[0]!.url, body: tracker.issues[0]!.body, state_reason: 'completed', labels: [{ name: 'outcome:wontfix' }] };
    const r = await post(app, 'issues', { action: 'closed', issue });
    expect(body(r)).toEqual({ ref, action: 'closed', emailed: true });
    expect(sent[0]).toMatchObject({ to: 'v@example.org', subject: `[${ref}] wontfix: Nav overlaps hero on iPhone SE` });
    expect(store.sidecars.get(ref)!.closeEmailAt).not.toBeNull();
    expect(body(await post(app, 'issues', { action: 'closed', issue }))).toMatchObject({ emailed: false }); // no double email
    expect(body(await post(app, 'issues', { action: 'reopened', issue }))).toMatchObject({ action: 'reopened' });
    expect(store.sidecars.get(ref)!.closeEmailAt).toBeNull();
    expect(body(await post(app, 'issues', { action: 'closed', issue: { ...issue, body: 'no marker' } }))).toEqual({ action: 'ignored', emailed: false });
    expect(body(await post(app, 'issue_comment', { action: 'created' }))).toEqual({ action: 'ignored', emailed: false });
  });
});
