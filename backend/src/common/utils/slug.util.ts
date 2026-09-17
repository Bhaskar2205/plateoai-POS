/**
 * Converts a restaurant name into a URL-safe slug.
 *
 * Diacritics are folded, everything that is not `[a-z0-9]` collapses to a single
 * hyphen, and the result is trimmed to 180 chars to leave room for the numeric
 * suffix that `uniqueSlug` may append.
 */
export function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180)
    .replace(/-+$/g, '');

  // Names written entirely in a non-Latin script would otherwise slug to ''.
  return base || 'restaurant';
}

/**
 * Returns the first slug not present in `taken`, appending `-2`, `-3`, ... as
 * needed. Callers must still handle the unique-index violation, because another
 * transaction can claim the same slug between the check and the insert.
 */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const existing = new Set(taken);

  if (!existing.has(base)) {
    return base;
  }

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }

  return `${base}-${Date.now()}`;
}
