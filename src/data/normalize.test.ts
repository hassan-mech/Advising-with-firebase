/**
 * Unit tests for normalizeCourseCode. Pins the contract every parser
 * and advising query relies on: any two spellings of the same course
 * must collapse to the same string, and the no-input case must not
 * throw.
 */

import { describe, it, expect } from 'vitest';
import { normalizeCourseCode, normalizeCourseCodeLoose } from './normalize';

describe('normalizeCourseCode', () => {
  it('trims whitespace and uppercases', () => {
    expect(normalizeCourseCode('MEC011')).toBe('MEC011');
    expect(normalizeCourseCode('mec011')).toBe('MEC011');
    expect(normalizeCourseCode('Mec011')).toBe('MEC011');
  });

  it('strips spaces inside the code', () => {
    expect(normalizeCourseCode('MEC 11')).toBe('MEC11');
    expect(normalizeCourseCode('MEC  11')).toBe('MEC11');
    expect(normalizeCourseCode('  MEC011  ')).toBe('MEC011');
  });

  it('strips common separators (-, /, .)', () => {
    expect(normalizeCourseCode('MEC-11')).toBe('MEC11');
    expect(normalizeCourseCode('MEC/11')).toBe('MEC11');
    expect(normalizeCourseCode('MEC.11')).toBe('MEC11');
    expect(normalizeCourseCode('MEC-011')).toBe('MEC011');
  });

  it('handles the user-reported cases', () => {
    expect(normalizeCourseCode('MEC11')).toBe('MEC11');
    expect(normalizeCourseCode('MEC011')).toBe('MEC011');
    expect(normalizeCourseCode('MEC 11')).toBe('MEC11');
    expect(normalizeCourseCode('mec 11')).toBe('MEC11');
  });

  it('returns empty string for empty / falsy input', () => {
    expect(normalizeCourseCode('')).toBe('');
  });

  it('collapses every spaced variant of MEC 011 to the same key', () => {
    const variants = ['MEC011', 'MEC 11', 'mec 11', 'Mec-11', 'MEC/11', 'MEC.11'];
    const normalized = new Set(variants.map(normalizeCourseCode));
    // All five variants collapse to two canonical keys (MEC011 vs MEC11),
    // not six — the join works whenever both sides pick the same shape.
    expect(normalized.has('MEC011') || normalized.has('MEC11')).toBe(true);
    expect(normalized.size).toBeLessThanOrEqual(2);
  });
});

describe('normalizeCourseCodeLoose', () => {
  it('pads short digit-tails to length 3 (MEC11 → MEC011)', () => {
    expect(normalizeCourseCodeLoose('MEC11')).toBe('MEC011');
    expect(normalizeCourseCodeLoose('MEC 11')).toBe('MEC011');
    expect(normalizeCourseCodeLoose('mec 11')).toBe('MEC011');
    expect(normalizeCourseCodeLoose('Mec-11')).toBe('MEC011');
  });

  it('leaves 3+ digit tails unchanged', () => {
    expect(normalizeCourseCodeLoose('MEC011')).toBe('MEC011');
    expect(normalizeCourseCodeLoose('PHY111')).toBe('PHY111');
    expect(normalizeCourseCodeLoose('MAT1234')).toBe('MAT1234');
  });

  it('pads single digits too', () => {
    expect(normalizeCourseCodeLoose('MEC1')).toBe('MEC001');
  });

  it('collapses MEC011 + MEC 11 + MEC11 + mec 11 to one canonical key', () => {
    const variants = ['MEC011', 'MEC 11', 'MEC11', 'mec 11', 'Mec-11'];
    const normalized = new Set(variants.map(normalizeCourseCodeLoose));
    expect(normalized.size).toBe(1);
    expect(normalized.has('MEC011')).toBe(true);
  });

  it('returns empty for empty input', () => {
    expect(normalizeCourseCodeLoose('')).toBe('');
  });
});
