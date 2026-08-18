import type { FeedbackRow } from '../db/schema.js';
import type { Mail } from './mailer.js';

export interface Branding { siteName: string; siteUrl: string }

const KIND_LABEL: Record<FeedbackRow['kind'], string> = { bug: 'bug report', feature: 'feature request', contact: 'message' };

export function statusUrl(b: Branding, ref: string): string {
  return `${b.siteUrl}/feedback/?ref=${ref}`;
}

export function ackMail(b: Branding, f: FeedbackRow): Mail {
  const url = statusUrl(b, f.ref);
  const text = [
    `Thanks — we received your ${KIND_LABEL[f.kind]}.`,
    ``,
    `Reference: ${f.ref}`,
    `Title: ${f.title}`,
    ``,
    `Track it any time: ${url}`,
    `A maintainer will reply — usually within three days. When it's resolved we'll email you the outcome.`,
    ``,
    `— ${b.siteName}`,
  ].join('\n');
  return { to: f.email!, subject: `[${f.ref}] We received your ${KIND_LABEL[f.kind]}`, text, html: toHtml(text) };
}

export function alertMail(b: Branding, f: FeedbackRow, to: string): Mail {
  const text = [
    `New ${KIND_LABEL[f.kind]} on ${b.siteName}${f.severity ? ` (severity: ${f.severity})` : ''}`,
    ``,
    `Ref: ${f.ref}`,
    `Title: ${f.title}`,
    `Page: ${f.pageUrl ?? '—'}`,
    `Issue: ${f.githubIssueUrl ?? 'not yet routed'}`,
    `Contact: ${f.email ?? 'anonymous'}`,
    ``,
    f.body,
  ].join('\n');
  return { to, subject: `[FFRS] ${f.kind}${f.severity ? `/${f.severity}` : ''}: ${f.title}`, text, html: toHtml(text) };
}

export function issueBody(b: Branding, f: FeedbackRow, screenshotUrl?: string): { title: string; body: string; labels: string[] } {
  const labels = ['ffrs', `kind:${f.kind}`, ...(f.severity ? [`severity:${f.severity}`] : [])];
  const body = [
    f.body,
    ``,
    `---`,
    `| | |`,
    `|---|---|`,
    `| Reference | \`${f.ref}\` · [status](${statusUrl(b, f.ref)}) |`,
    `| Page | ${f.pageUrl ?? '—'} |`,
    `| Submitted | ${f.createdAt.toISOString()} |`,
    `| Contact | ${f.email ? 'yes (email on file, not shown)' : 'anonymous'} |`,
    ...(f.meta && Object.keys(f.meta).length ? [`| Meta | \`${JSON.stringify(f.meta)}\` |`] : []),
    ...(screenshotUrl ? [``, `**Screenshot** (link valid 7 days)`, ``, `![screenshot](${screenshotUrl})`] : []),
    ``,
    `_Filed by FFRS. Closing this issue records the outcome and notifies the submitter._`,
  ].join('\n');
  return { title: `[${f.kind}] ${f.title}`, body, labels };
}

const escape = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
const toHtml = (text: string) =>
  `<pre style="font:14px/1.5 -apple-system,Segoe UI,sans-serif;white-space:pre-wrap">${escape(text).replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>')}</pre>`;
