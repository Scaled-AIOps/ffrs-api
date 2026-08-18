/** Ports of the dependency-minimal FFRS: GitHub Issues is the system of record, S3 keeps a private sidecar. */

export type Kind = 'bug' | 'feature' | 'contact';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type Outcome = 'fixed' | 'shipped' | 'answered' | 'declined' | 'wontfix' | 'duplicate';

/** Everything public lives in the issue: title, body, labels, timestamps. */
export interface NewIssue { title: string; body: string; labels: string[] }
export interface IssueRef { url: string; number: number; createdAt: Date }
export interface IssueView extends IssueRef {
  state: 'open' | 'closed';
  stateReason: 'completed' | 'not_planned' | 'duplicate' | 'reopened' | null;
  closedAt: Date | null;
  labels: string[];
  comments: number;
  body: string;
}

export interface Tracker {
  createIssue(issue: NewIssue): Promise<IssueRef>;
  getIssue(number: number): Promise<IssueView | undefined>;
  /** First comment by a human (type User) — the FFRS "Respond" timestamp. */
  firstHumanCommentAt(number: number): Promise<Date | null>;
  /** All FFRS-filed issues (label `ffrs`), oldest first. */
  listIssues(): Promise<IssueView[]>;
}

/** Private per-item sidecar: the only place an email address ever lives. */
export interface Sidecar {
  ref: string;
  issueNumber: number;
  issueUrl: string;
  kind: Kind;
  title: string;
  createdAt: string;           // ISO
  email: string | null;        // only with consent
  consent: boolean;
  screenshotKey: string | null;
  acknowledgedAt: string | null;
  closeEmailAt: string | null;
}

export interface Store {
  getSidecar(ref: string): Promise<Sidecar | undefined>;
  putSidecar(s: Sidecar): Promise<void>;
  /** Idempotency map: request key → ref. */
  getIdem(key: string): Promise<string | undefined>;
  putIdem(key: string, ref: string): Promise<void>;
  putBlob(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  blobUrl(key: string, ttlSeconds: number): Promise<string>;
}
