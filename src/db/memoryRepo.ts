import type { EffectType, FeedbackRepo } from '../domain/repo.js';
import type { FeedbackRow, SideEffectRow } from './schema.js';

/** In-memory FeedbackRepo for tests and local runs. Same contract as neonRepo, no I/O. */
export function memoryRepo(): FeedbackRepo & { rows: FeedbackRow[]; effects: SideEffectRow[] } {
  const rows: FeedbackRow[] = [];
  const effects: SideEffectRow[] = [];
  let seq = 0;

  return {
    rows,
    effects,
    async create(input, types: EffectType[]) {
      if (input.idempotencyKey) {
        const existing = rows.find((r) => r.idempotencyKey === input.idempotencyKey);
        if (existing) return { row: existing, created: false };
      }
      const row: FeedbackRow = {
        id: ++seq,
        ref: input.ref,
        idempotencyKey: input.idempotencyKey ?? null,
        kind: input.kind,
        title: input.title,
        body: input.body,
        pageUrl: input.pageUrl ?? null,
        severity: input.severity ?? null,
        screenshotKey: input.screenshotKey ?? null,
        meta: input.meta ?? null,
        email: input.email ?? null,
        consent: input.consent ?? false,
        status: 'new',
        outcome: null,
        githubIssueUrl: null,
        createdAt: input.createdAt ?? new Date(),
        acknowledgedAt: null,
        routedAt: null,
        respondedAt: null,
        closedAt: null,
      };
      rows.push(row);
      for (const type of types) effects.push({ id: effects.length + 1, feedbackId: row.id, type, attempts: 0, nextTryAt: row.createdAt, doneAt: null, lastError: null });
      return { row, created: true };
    },
    async findByRef(ref) {
      return rows.find((r) => r.ref === ref);
    },
    async claimDueEffects(limit, now) {
      const due = effects.filter((e) => !e.doneAt && e.nextTryAt <= now).slice(0, limit);
      for (const e of due) { e.attempts++; e.nextTryAt = new Date(now.getTime() + 120_000); }
      return due.map((e) => ({ ...e, feedback: rows.find((r) => r.id === e.feedbackId)! }));
    },
    async completeEffect(id, now, patch = {}) {
      const e = effects.find((x) => x.id === id)!;
      e.doneAt = now; e.lastError = null;
      const row = rows.find((r) => r.id === e.feedbackId)!;
      if (patch.acknowledgedAt && !row.acknowledgedAt) row.acknowledgedAt = patch.acknowledgedAt;
      if (patch.routedAt && !row.routedAt) row.routedAt = patch.routedAt;
      if (patch.githubIssueUrl) row.githubIssueUrl = patch.githubIssueUrl;
      if (patch.status) row.status = patch.status;
    },
    async failEffect(id, error, nextTryAt) {
      const e = effects.find((x) => x.id === id)!;
      e.lastError = error; e.nextTryAt = nextTryAt;
    },
  };
}
