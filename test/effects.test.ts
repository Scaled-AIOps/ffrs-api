import { describe, expect, it } from 'vitest';
import type { Sidecar } from '../src/domain/ports.js';
import { ackMail, alertMail, closeMail, issueBody } from '../src/effects/templates.js';
import { branding as b } from './helpers.js';

const s: Sidecar = { ref: 'FB-7K3M2Q', issueNumber: 7, issueUrl: 'https://github.com/o/r/issues/7', kind: 'bug', title: 'Nav overlaps hero', createdAt: '2026-08-18T10:00:00.000Z', email: 'v@example.org', consent: true, screenshotKey: null, acknowledgedAt: null, closeEmailAt: null };

describe('templates', () => {
  it('ack: ref + status link, html links clickable', () => {
    const m = ackMail(b, s);
    expect(m).toMatchObject({ to: 'v@example.org', subject: '[FB-7K3M2Q] We received your bug report' });
    expect(m.html).toContain('<a href="https://www.scaledaiops.org/feedback/?ref=FB-7K3M2Q">');
  });
  it('alert: severity, body, issue link', () => {
    const m = alertMail(b, { ...s, severity: 'high', pageUrl: 'https://www.scaledaiops.org/', body: 'On 375px…' }, 'team@example.org');
    expect(m.subject).toBe('[FFRS] bug/high: Nav overlaps hero');
    expect(m.text).toContain('https://github.com/o/r/issues/7');
  });
  it('close: outcome sentence + links', () => {
    const m = closeMail(b, s, 'fixed');
    expect(m.subject).toBe('[FB-7K3M2Q] fixed: Nav overlaps hero');
    expect(m.text).toContain('has been fixed');
  });
  it('issue: marker, labels, no email, screenshot link', () => {
    const i = issueBody(b, { ref: 'FB-7K3M2Q', kind: 'bug', title: 'T', body: 'B', severity: 'high', email: 'v@example.org', createdAt: new Date('2026-08-18T10:00:00Z') }, 'https://s3/x.jpg');
    expect(i.title).toBe('[bug] T');
    expect(i.labels).toEqual(['ffrs', 'kind:bug', 'severity:high']);
    expect(i.body.startsWith('<!-- ffrs:FB-7K3M2Q -->')).toBe(true);
    expect(i.body).toContain('![screenshot](https://s3/x.jpg)');
    expect(i.body).not.toContain('v@example.org');
  });
});
