import type { FeedbackRow } from '../db/schema.js';
import type { EffectType, FeedbackPatch } from '../domain/repo.js';

/** A side effect is a plug-in: (feedback) => void. Projects swap implementations without touching the core. */
export type Effect = (feedback: FeedbackRow) => Promise<FeedbackPatch | void>;
export type EffectRegistry = Partial<Record<EffectType, Effect>>;
