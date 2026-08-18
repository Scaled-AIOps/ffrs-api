import { randomInt } from 'node:crypto';

// Crockford-style alphabet without vowels/ambiguous glyphs: no accidental words, easy to read aloud.
const ALPHABET = '23456789CDFGHJKMNPQRTVWXYZ';
export const REF_PATTERN = /^FB-[23456789CDFGHJKMNPQRTVWXYZ]{6}$/;

export function newRef(rand: (max: number) => number = (max) => randomInt(max)): string {
  let out = '';
  for (let i = 0; i < 6; i++) out += ALPHABET[rand(ALPHABET.length)];
  return `FB-${out}`;
}
