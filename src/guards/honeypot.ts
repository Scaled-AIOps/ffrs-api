/** Bots fill every field. A non-empty honeypot is a silent reject (202 with a fake ref) — never tell them. */
export function isHoneypotTripped(input: { website?: string | undefined }): boolean {
  return typeof input.website === 'string' && input.website.length > 0;
}
