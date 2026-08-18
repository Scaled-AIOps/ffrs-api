import { z } from 'zod';
import type { IssueRef, IssueView, NewIssue, Tracker } from '../domain/ports.js';

const Issue = z.object({
  number: z.number(), html_url: z.string().url(), created_at: z.string(), closed_at: z.string().nullable(),
  state: z.enum(['open', 'closed']), state_reason: z.enum(['completed', 'not_planned', 'duplicate', 'reopened']).nullable().optional(),
  labels: z.array(z.object({ name: z.string() })), comments: z.number(), body: z.string().nullable(),
  pull_request: z.unknown().optional(),
});
const Comment = z.object({ created_at: z.string(), user: z.object({ type: z.string() }) });

const view = (i: z.infer<typeof Issue>): IssueView => ({
  number: i.number, url: i.html_url, createdAt: new Date(i.created_at), closedAt: i.closed_at ? new Date(i.closed_at) : null,
  state: i.state, stateReason: i.state_reason ?? null, labels: i.labels.map((l) => l.name), comments: i.comments, body: i.body ?? '',
});

/** GitHub Issues REST — the system of record. Non-2xx throws. */
export function githubTracker(repo: string, token: string, fetchImpl: typeof fetch = fetch): Tracker {
  const api = async (path: string, init: RequestInit = {}): Promise<unknown> => {
    const res = await fetchImpl(`https://api.github.com${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'ffrs-api', ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
    });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`github ${init.method ?? 'GET'} ${path} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  };
  return {
    async createIssue(issue: NewIssue): Promise<IssueRef> {
      const i = Issue.parse(await api(`/repos/${repo}/issues`, { method: 'POST', body: JSON.stringify(issue) }));
      return { url: i.html_url, number: i.number, createdAt: new Date(i.created_at) };
    },
    async getIssue(number) {
      const raw = await api(`/repos/${repo}/issues/${number}`);
      return raw === undefined ? undefined : view(Issue.parse(raw));
    },
    async firstHumanCommentAt(number) {
      const comments = z.array(Comment).parse(await api(`/repos/${repo}/issues/${number}/comments?per_page=100`));
      const first = comments.find((c) => c.user.type === 'User');
      return first ? new Date(first.created_at) : null;
    },
    async listIssues() {
      const out: IssueView[] = [];
      for (let page = 1; page < 50; page++) {
        const batch = z.array(Issue).parse(await api(`/repos/${repo}/issues?labels=ffrs&state=all&sort=created&direction=asc&per_page=100&page=${page}`));
        out.push(...batch.filter((i) => !i.pull_request).map(view));
        if (batch.length < 100) break;
      }
      return out;
    },
  };
}
