import { describe, expect, it } from 'vitest';
import { newRef, REF_PATTERN } from '../src/domain/ref.js';

describe('ref', () => {
  it('matches the public pattern and never contains vowels', () => {
    for (let i = 0; i < 500; i++) expect(newRef()).toMatch(REF_PATTERN);
    expect(newRef(() => 0)).toBe('FB-222222');
  });
});
