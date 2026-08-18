import { neon } from '@neondatabase/serverless';
import { eq, isNull, lte, sql } from 'drizzle-orm';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import type { EffectType, FeedbackRepo } from '../domain/repo.js';
import { feedback, sideEffects, type FeedbackRow, type NewFeedback } from './schema.js';

export function neonRepo(databaseUrl: string): FeedbackRepo {
  const db: NeonHttpDatabase = drizzle(neon(databaseUrl));

  return {
    async create(input: NewFeedback, effects: EffectType[]) {
      // Idempotent insert: a repeated Idempotency-Key returns the original row and queues nothing new.
      const inserted = await db.insert(feedback).values(input).onConflictDoNothing({ target: feedback.idempotencyKey }).returning();
      const row = inserted[0];
      if (!row) {
        const [existing] = await db.select().from(feedback).where(eq(feedback.idempotencyKey, input.idempotencyKey!)).limit(1);
        if (!existing) throw new Error('idempotency conflict but no existing row');
        return { row: existing, created: false };
      }
      if (effects.length) await db.insert(sideEffects).values(effects.map((type) => ({ feedbackId: row.id, type })));
      return { row, created: true };
    },

    async findByRef(ref) {
      const [row] = await db.select().from(feedback).where(eq(feedback.ref, ref)).limit(1);
      return row;
    },

    async findByIssueUrl(url) {
      const [row] = await db.select().from(feedback).where(eq(feedback.githubIssueUrl, url)).limit(1);
      return row;
    },

    async update(id, patch, types = []) {
      await db.update(feedback).set(patch).where(eq(feedback.id, id));
      if (types.length) await db.insert(sideEffects).values(types.map((type) => ({ feedbackId: id, type })));
    },

    async claimDueEffects(limit, now) {
      // Neon HTTP driver has no interactive transactions; claim atomically with UPDATE … RETURNING.
      const claimed = await db
        .update(sideEffects)
        .set({ attempts: sql`${sideEffects.attempts} + 1`, nextTryAt: new Date(now.getTime() + 120_000) }) // 2 min lease
        .where(
          sql`${sideEffects.id} in (select id from ${sideEffects} where ${isNull(sideEffects.doneAt)} and ${lte(sideEffects.nextTryAt, now)} order by ${sideEffects.nextTryAt} limit ${limit})`,
        )
        .returning();
      if (!claimed.length) return [];
      const ids = [...new Set(claimed.map((c) => c.feedbackId))];
      const rows = await db.select().from(feedback).where(sql`${feedback.id} in ${ids}`);
      const byId = new Map<number, FeedbackRow>(rows.map((r) => [r.id, r]));
      return claimed.map((c) => ({ ...c, feedback: byId.get(c.feedbackId)! }));
    },

    async completeEffect(id, now, patch = {}) {
      const [row] = await db.update(sideEffects).set({ doneAt: now, lastError: null }).where(eq(sideEffects.id, id)).returning({ feedbackId: sideEffects.feedbackId });
      if (!row || !Object.keys(patch).length) return;
      await db
        .update(feedback)
        .set({
          ...(patch.acknowledgedAt ? { acknowledgedAt: sql`coalesce(${feedback.acknowledgedAt}, ${patch.acknowledgedAt})` } : {}),
          ...(patch.routedAt ? { routedAt: sql`coalesce(${feedback.routedAt}, ${patch.routedAt})` } : {}),
          ...(patch.githubIssueUrl ? { githubIssueUrl: patch.githubIssueUrl } : {}),
          ...(patch.status ? { status: patch.status } : {}),
        })
        .where(eq(feedback.id, row.feedbackId));
    },

    async failEffect(id, error, nextTryAt) {
      await db.update(sideEffects).set({ lastError: error.slice(0, 2000), nextTryAt }).where(eq(sideEffects.id, id));
    },
  };
}
