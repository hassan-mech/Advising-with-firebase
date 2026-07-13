/**
 * Tests for `sanitiseFilename` — the helper that turns an arbitrary
 * student name + id into something the browser's "Save as PDF"
 * dialog can use as a Windows-safe filename.
 *
 * We don't run the actual print dialog in tests — the helper is the
 * only piece with non-trivial logic, and it has to stay in lock-step
 * with `triggerPrint`'s title-swap behaviour.
 */

import { describe, it, expect } from 'vitest';
import { sanitiseFilename } from './PrintContext';

describe('sanitiseFilename', () => {
  it('strips Windows-reserved characters', () => {
    expect(sanitiseFilename('a<b>c:d"e/f\\g|h?i*j')).toBe('abcdefghij');
  });

  it('collapses runs of whitespace into a single space', () => {
    expect(sanitiseFilename('Hassan   Mohamed')).toBe('Hassan Mohamed');
    expect(sanitiseFilename('Hassan\t\nMohamed')).toBe('Hassan Mohamed');
  });

  it('trims leading and trailing whitespace', () => {
    expect(sanitiseFilename('   Hassan Mohamed   ')).toBe('Hassan Mohamed');
  });

  it('strips control characters (0x00-0x1F)', () => {
    // 0x07 (bell) + 0x1F (unit separator) embedded in the name.
    // We build the input via String.fromCharCode instead of
    // embedding literal control bytes in the source — keeps the
    // file readable and stops the test runner's source-map parser
    // from tripping on weird bytes.
    const input = `Hassan${String.fromCharCode(0x07)}${String.fromCharCode(0x1f)}Mohamed`;
    expect(sanitiseFilename(input)).toBe('Hassan Mohamed');
  });

  it('strips trailing dots (Windows refuses filenames ending in a dot)', () => {
    expect(sanitiseFilename('Hassan Mohamed.')).toBe('Hassan Mohamed');
    expect(sanitiseFilename('Hassan Mohamed...')).toBe('Hassan Mohamed');
  });

  it('returns the original string when nothing needs cleaning', () => {
    expect(sanitiseFilename('Hassan Mohamed - 20201234')).toBe(
      'Hassan Mohamed - 20201234'
    );
  });

  it('returns an empty string for nullish / empty input', () => {
    expect(sanitiseFilename('')).toBe('');
    expect(sanitiseFilename(undefined)).toBe('');
    expect(sanitiseFilename(null)).toBe('');
  });

  it('returns an empty string when every character was reserved', () => {
    expect(sanitiseFilename('<<<>>>')).toBe('');
  });

  it('produces a clean "name - id" filename from a typical student record', () => {
    // This is the exact format we pass into `title:` on the
    // per-student Print buttons. Sanitisation must be a no-op on
    // well-formed names like this.
    expect(sanitiseFilename('Hassan Mohamed - 20201234')).toBe(
      'Hassan Mohamed - 20201234'
    );
  });

  it('handles accented characters and common punctuation without damage', () => {
    // Common Arabic transliteration patterns + a comma + apostrophe
    // (comma is NOT a Windows reserved char; apostrophe isn't either).
    expect(sanitiseFilename("O'Brien, Séamus")).toBe("O'Brien, Séamus");
  });
});
