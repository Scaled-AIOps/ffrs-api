import type { Kind, Outcome, Sidecar } from '../domain/ports.js';
import type { Mail } from './mailer.js';

export interface Branding { siteName: string; siteUrl: string }
const KIND_LABEL: Record<Kind, string> = { bug: 'bug report', feature: 'feature request', contact: 'message' };
export const statusUrl = (b: Branding, ref: string) => `${b.siteUrl}/feedback/?ref=${ref}`;

export function ackMail(b: Branding, s: Sidecar): Mail {
  const text = [
    `Thanks — we received your ${KIND_LABEL[s.kind]}.`, ``,
    `Reference: ${s.ref}`, `Title: ${s.title}`, ``,
    `Track it any time: ${statusUrl(b, s.ref)}`,
    `A maintainer will reply — usually within three days. When it's resolved we'll email you the outcome.`, ``,
    `— ${b.siteName}`,
  ].join('\n');
  return { to: s.email!, subject: `[${s.ref}] We received your ${KIND_LABEL[s.kind]}`, text, html: toHtml(text) };
}

export function alertMail(b: Branding, f: Sidecar & { severity: string | null; pageUrl: string | null; body: string }, to: string): Mail {
  const text = [
    `New ${KIND_LABEL[f.kind]} on ${b.siteName}${f.severity ? ` (severity: ${f.severity})` : ''}`, ``,
    `Ref: ${f.ref}`, `Title: ${f.title}`, `Page: ${f.pageUrl ?? '—'}`, `Issue: ${f.issueUrl}`, `Contact: ${f.email ?? 'anonymous'}`, ``,
    f.body,
  ].join('\n');
  return { to, subject: `[FFRS] ${f.kind}${f.severity ? `/${f.severity}` : ''}: ${f.title}`, text, html: toHtml(text) };
}

const OUTCOME_LINE: Record<Outcome, string> = {
  fixed: 'The bug you reported has been fixed.', shipped: 'The feature you requested has shipped.', answered: 'Your message has been answered.',
  declined: 'After review, this was declined.', wontfix: 'After review, this will not be changed.', duplicate: 'This was already tracked elsewhere and has been merged into the existing item.',
};

export function closeMail(b: Branding, s: Sidecar, outcome: Outcome): Mail {
  const text = [
    `Update on your ${KIND_LABEL[s.kind]} ${s.ref}: ${OUTCOME_LINE[outcome]}`, ``,
    `Title: ${s.title}`, `Discussion: ${s.issueUrl}`, `Status: ${statusUrl(b, s.ref)}`, ``,
    `Thank you for helping improve ${b.siteName}.`,
  ].join('\n');
  return { to: s.email!, subject: `[${s.ref}] ${outcome}: ${s.title}`, text, html: toHtml(text) };
}

export interface IssueInput { ref: string; kind: Kind; title: string; body: string; pageUrl?: string | undefined; severity?: string | undefined; email?: string | undefined; meta?: Record<string, unknown> | undefined; createdAt: Date }

export function issueBody(b: Branding, f: IssueInput, screenshotUrl?: string): { title: string; body: string; labels: string[] } {
  const labels = ['ffrs', `kind:${f.kind}`, ...(f.severity ? [`severity:${f.severity}`] : [])];
  const body = [
    `<!-- ffrs:${f.ref} -->`, f.body, ``, `---`,
    `| | |`, `|---|---|`,
    `| Reference | \`${f.ref}\` · [status](${statusUrl(b, f.ref)}) |`,
    `| Page | ${f.pageUrl ?? '—'} |`,
    `| Submitted | ${f.createdAt.toISOString()} |`,
    `| Contact | ${f.email ? 'yes (email on file, not shown)' : 'anonymous'} |`,
    ...(f.meta && Object.keys(f.meta).length ? [`| Meta | \`${JSON.stringify(f.meta)}\` |`] : []),
    ...(screenshotUrl ? [``, `**Screenshot** (link valid 7 days)`, ``, `![screenshot](${screenshotUrl})`] : []),
    ``, `_Filed by FFRS. Comment to respond; close to record the outcome and notify the submitter. Labels \`outcome:*\` override the inferred outcome._`,
  ].join('\n');
  return { title: `[${f.kind}] ${f.title}`, body, labels };
}

const escape = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
const toHtml = (text: string) => `<pre style="font:14px/1.5 -apple-system,Segoe UI,sans-serif;white-space:pre-wrap">${escape(text).replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>')}</pre>`;
