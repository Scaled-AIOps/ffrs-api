import type { IssueRef, IssueView, NewIssue, Sidecar, Store, Tracker } from '../domain/ports.js';

/** In-memory Tracker + Store for tests and local runs. Same contracts, no I/O. */
export function memoryTracker(now: () => Date = () => new Date()) {
  const issues: IssueView[] = [];
  const comments = new Map<number, Array<{ at: Date; human: boolean }>>();
  const t: Tracker & { issues: IssueView[]; comment(n: number, at: Date, human?: boolean): void; close(n: number, at: Date, reason?: IssueView['stateReason'], labels?: string[]): void } = {
    issues,
    async createIssue(i: NewIssue): Promise<IssueRef> {
      const number = issues.length + 1;
      const v: IssueView = { number, url: `https://github.com/o/r/issues/${number}`, createdAt: now(), closedAt: null, state: 'open', stateReason: null, labels: i.labels, comments: 0, body: i.body };
      issues.push(v);
      return { url: v.url, number, createdAt: v.createdAt };
    },
    async getIssue(n) { return issues.find((i) => i.number === n); },
    async firstCommentsAt(n) { const cs = comments.get(n) ?? []; return { any: cs[0]?.at ?? null, human: cs.find((c) => c.human)?.at ?? null }; },
    async listIssues() { return issues.filter((i) => i.labels.includes('ffrs')); },
    comment(n, at, human = true) { comments.set(n, [...(comments.get(n) ?? []), { at, human }]); issues.find((i) => i.number === n)!.comments++; },
    close(n, at, reason = 'completed', labels = []) { Object.assign(issues.find((i) => i.number === n)!, { state: 'closed', closedAt: at, stateReason: reason, labels: [...issues.find((i) => i.number === n)!.labels, ...labels] }); },
  };
  return t;
}

export function memoryStore() {
  const sidecars = new Map<string, Sidecar>(), idem = new Map<string, string>(), blobs = new Map<string, Uint8Array>();
  const s: Store & { sidecars: Map<string, Sidecar>; blobs: Map<string, Uint8Array> } = {
    sidecars, blobs,
    async getSidecar(ref) { return sidecars.get(ref); },
    async putSidecar(sc) { sidecars.set(sc.ref, { ...sc }); },
    async getIdem(k) { return idem.get(k); },
    async putIdem(k, ref) { idem.set(k, ref); },
    async putBlob(k, b) { blobs.set(k, b); },
    async blobUrl(k, ttl) { return `https://s3.example/${k}?ttl=${ttl}`; },
  };
  return s;
}
