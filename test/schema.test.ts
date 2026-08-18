import { describe, expect, it } from 'vitest';
import { FeedbackInput } from '../src/domain/schema.js';
import { validBug, validFeature } from './helpers.js';

const issues = (v: unknown) => FeedbackInput.safeParse(v).error?.issues.map((i) => i.path.join('.')) ?? [];

describe('FeedbackInput', () => {
  it('accepts a bug and a feature request', () => {
    expect(FeedbackInput.parse(validBug).kind).toBe('bug');
    expect(FeedbackInput.parse(validFeature).consent).toBe(false);
  });
  it('requires severity for bugs and email when consenting', () => {
    expect(issues({ ...validBug, severity: undefined })).toContain('severity');
    expect(issues({ ...validFeature, consent: true })).toContain('email');
  });
  it('rejects unknown fields, oversize bodies and non-JPEG screenshots', () => {
    expect(issues({ ...validFeature, admin: true })).toContain('');
    expect(issues({ ...validFeature, body: 'x'.repeat(5001) })).toContain('body');
    expect(issues({ ...validFeature, screenshot: 'data:image/png;base64,AAAA' })).toContain('screenshot');
    expect(issues({ ...validFeature, screenshot: 'data:image/jpeg;base64,' + 'A'.repeat(420_000) })).toContain('screenshot');
  });
});
