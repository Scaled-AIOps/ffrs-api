import type { EffectRegistry } from './effects/types.js';
import type { FeedbackRepo } from './domain/repo.js';
import { log } from './log.js';

const BACKOFF_MS = [60_000, 300_000, 900_000, 3_600_000, 21_600_000]; // 1m 5m 15m 1h 6h, then give up
const STAMP: Record<string, 'acknowledgedAt' | 'routedAt' | undefined> = { ack_email: 'acknowledgedAt', github_issue: 'routedAt' };

/** Drain due outbox rows once. Idempotent per row: claim → run → complete/fail with backoff. */
export async function drainOutbox(repo: FeedbackRepo, effects: EffectRegistry, limit = 25, now = new Date()): Promise<{ done: number; failed: number }> {
  const due = await repo.claimDueEffects(limit, now);
  let done = 0, failed = 0;
  for (const row of due) {
    const run = effects[row.type as keyof EffectRegistry];
    if (!run) {
      await repo.failEffect(row.id, `no effect registered for ${row.type}`, new Date(8.64e15)); // park forever
      failed++;
      continue;
    }
    try {
      await run(row.feedback);
      await repo.completeEffect(row.id, now, STAMP[row.type]);
      done++;
    } catch (err) {
      const attempt = row.attempts; // already incremented by claim
      const delay = BACKOFF_MS[attempt - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!;
      const parked = attempt > BACKOFF_MS.length;
      await repo.failEffect(row.id, String(err), parked ? new Date(8.64e15) : new Date(now.getTime() + delay));
      log('warn', 'effect_failed', { id: row.id, type: row.type, ref: row.feedback.ref, attempt, parked, err: String(err) });
      failed++;
    }
  }
  return { done, failed };
}
