/**
 * Course-code normalization — v2.
 *
 * The grade-book and the catalog often use slightly different
 * spellings for the same course (`MEC011`, `MEC 11`, `mec 011`,
 * `Mec-11`). Without normalization the join silently misses and
 * advising queries return empty results. This helper is the single
 * source of truth: every comparison, every lookup, every parse
 * runs course codes through here.
 *
 * Rules:
 *   - strip all whitespace (`MEC 11` → `MEC11`)
 *   - uppercase (`mec011` → `MEC011`)
 *   - collapse common separators (`MEC-11`, `MEC/11`, `MEC.11`
 *     → `MEC11`) so a `-` doesn't split the same course into
 *     a different key
 *
 * Other input formats (e.g. credit suffixes) are out of scope for
 * v1 — the grade-book uses these five shapes only.
 */
export function normalizeCourseCode(code: string): string {
  if (!code) return '';
  return code
    .replace(/[\s\-./]+/g, '')
    .toUpperCase();
}

/**
 * Same as `normalizeCourseCode` but also collapses the "leading-
 * zero" variation (`MEC011` vs `MEC11` vs `MEC 11`). Most NMU course
 * codes in the user's catalog have the form `XYZ0NN` (a department
 * prefix of 2–4 letters + a 3-digit number), so we pad short
 * digit-tails to length 3. Codes whose digit-tail is already ≥ 3
 * characters are returned unchanged.
 *
 * Examples:
 *   MEC11   → MEC011
 *   MEC 11  → MEC011
 *   MEC011  → MEC011
 *   MAT1234 → MAT1234   (already 4 digits — leave alone)
 *   PHY111  → PHY111
 *
 * Edge case: if the digit-tail has fewer than 3 chars AND more than
 * 0 chars, it gets padded. Zero-digit codes pass through unchanged.
 */
export function normalizeCourseCodeLoose(code: string): string {
  const n = normalizeCourseCode(code);
  if (!n) return n;
  // Split into letter-prefix + digit-tail. If no letters, leave it.
  const m = n.match(/^([A-Z]+)(\d*)$/);
  if (!m) return n;
  const [, prefix, digits] = m;
  if (digits.length === 0) return n;
  if (digits.length >= 3) return n;
  // Pad to length 3 — e.g. "11" -> "011", "1" -> "001".
  return prefix + digits.padStart(3, '0');
}
