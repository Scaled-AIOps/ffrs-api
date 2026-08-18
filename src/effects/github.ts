import { z } from 'zod';

const IssueCreated = z.object({ html_url: z.string().url() });
export interface NewIssue { title: string; body: string; labels: string[] }

/** Minimal GitHub REST client — one call, no SDK. Non-2xx throws so callers retry via the outbox. */
export function githubClient(repo: string, token: string, fetchImpl: typeof fetch = fetch) {
  return {
    async createIssue(issue: NewIssue): Promise<string> {
      const res = await fetchImpl(`https://api.github.com/repos/${repo}/issues`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'ffrs-api' },
        body: JSON.stringify(issue),
      });
      if (!res.ok) throw new Error(`github issues HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return IssueCreated.parse(await res.json()).html_url;
    },
  };
}
