import { createHash } from 'node:crypto';

/**
 * Token bucket per hashed client IP, in-memory per Lambda instance.
 * Known limit (documented in the plan): counts reset on cold start and aren't shared across instances —
 * acceptable at this volume; swap `RateLimiter` for a Neon-backed one if it ever matters.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>();

  constructor(
    private readonly perMinute: number,
    private readonly maxKeys = 10_000,
  ) {}

  allow(ip: string, now = Date.now()): boolean {
    const key = createHash('sha256').update(ip).digest('hex').slice(0, 16);
    const b = this.buckets.get(key) ?? { tokens: this.perMinute, updatedAt: now };
    b.tokens = Math.min(this.perMinute, b.tokens + ((now - b.updatedAt) / 60_000) * this.perMinute);
    b.updatedAt = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    if (this.buckets.size >= this.maxKeys) this.buckets.clear(); // crude but bounded
    this.buckets.set(key, b);
    return true;
  }
}
