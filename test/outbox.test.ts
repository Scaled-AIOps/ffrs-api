import { describe, expect, it } from 'vitest';
import { memoryRepo } from '../src/db/memoryRepo.js';
import { capture } from '../src/domain/feedback.js';
import { drainOutbox } from '../src/outbox.js';
import { validBug } from './helpers.js';

describe('outbox', () => {
  it('queues ack only with consent, stamps FFRS timestamps on success, backs off on failure', async () => {
    const repo = memoryRepo();
    const t0 = new Date('2026-08-18T10:00:00Z');
    await capture({ repo }, { ...validBug, consent: false, email: undefined } as never, { now: t0 });
    expect(repo.effects.map((e) => e.type)).toEqual(['github_issue', 'alert_email']);

    await capture({ repo }, validBug as never, { now: t0 });
    expect(repo.effects.filter((e) => e.feedbackId === 2).map((e) => e.type)).toEqual(['ack_email', 'github_issue', 'alert_email']);

    let calls = 0;
    const r = await drainOutbox(repo, {
      ack_email: async () => { calls++; },
      github_issue: async () => { throw new Error('gh down'); },
    }, 25, t0);
    expect(r).toEqual({ done: 1, failed: 4 }); // 1 ack ok; 2 github failed; 2 alert unregistered → parked
    expect(calls).toBe(1);
    expect(repo.rows[1]!.acknowledgedAt).toEqual(t0);
    const gh = repo.effects.find((e) => e.type === 'github_issue')!;
    expect(gh.attempts).toBe(1);
    expect(gh.nextTryAt.getTime()).toBe(t0.getTime() + 60_000);
    expect(gh.lastError).toMatch(/gh down/);
    expect(repo.effects.find((e) => e.type === 'alert_email')!.nextTryAt.getFullYear()).toBeGreaterThan(9000);
  });
});
