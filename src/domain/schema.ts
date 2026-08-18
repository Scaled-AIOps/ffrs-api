import { z } from 'zod';

const MAX_SCREENSHOT_BYTES = 300 * 1024;
const DATA_URL = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+=*)$/;

/** Wire format of POST /api/feedback — validated before anything else runs. */
export const FeedbackInput = z
  .object({
    kind: z.enum(['bug', 'feature', 'contact']),
    title: z.string().trim().min(3).max(140),
    body: z.string().trim().min(10).max(5000),
    pageUrl: z.string().url().max(2000).optional(),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    email: z.string().trim().email().max(254).optional(),
    consent: z.boolean().default(false),
    screenshot: z
      .string()
      .regex(DATA_URL, 'screenshot must be a JPEG data URL')
      .refine((s) => (s.length * 3) / 4 <= MAX_SCREENSHOT_BYTES * 1.02, 'screenshot exceeds 300 KB')
      .optional(),
    meta: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    website: z.string().max(500).optional(), // honeypot — humans never fill it; guard rejects silently
    turnstileToken: z.string().min(1).max(4096).optional(),
  })
  .strict()
  .refine((v) => v.kind !== 'bug' || v.severity !== undefined, { message: 'severity is required for bugs', path: ['severity'] })
  .refine((v) => !v.consent || v.email !== undefined, { message: 'consent requires an email', path: ['email'] });
export type FeedbackInput = z.infer<typeof FeedbackInput>;

export function decodeScreenshot(dataUrl: string): Uint8Array {
  const b64 = DATA_URL.exec(dataUrl)?.[1];
  if (!b64) throw new Error('invalid screenshot data URL');
  return Buffer.from(b64, 'base64');
}
