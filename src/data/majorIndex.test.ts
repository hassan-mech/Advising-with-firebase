/**
 * Unit tests for `semesterForMajor` — the per-major semester lookup.
 * Two catalog shapes are supported:
 *   - "wide"  rows: `majors[]` length === catalog majors length,
 *                   `semesters[]` same length. `semesters[majorIdx]`
 *                   is the answer.
 *   - "narrow" rows: `majors[]` lists only the majors this course
 *                    belongs to (often just one), `semesters[]` same
 *                    length. Reader must find the picked major's
 *                    position *inside* the row's own `majors[]` and
 *                    use that index into `semesters[]`.
 *
 * The narrow shape is what real catalogs (e.g. MEC242 "CNC Machine"
 * with `majors: ['Mechatronics Engineering']` + `semesters: [7]`)
 * ship with — these tests pin the behaviour so the semester chip
 * never disappears for a one-major course.
 */

import { describe, it, expect } from 'vitest';
import { semesterForMajor } from './majorIndex';

const CATALOG_MAJORS = [
  'Petrol and Gas Engineering',
  'Environmental Architecture',
  'Aerospace Engineering',
  'Civil Engineering',
  'Mechatronics Engineering',
  'Biomedical Engineering',
];

describe('semesterForMajor — wide shape', () => {
  it('reads semesters[i] by catalog index when the row lists every major', () => {
    // MEC151 has all 6 majors + semesters: [3,3,3,3,3,3]
    const row = {
      majors: [...CATALOG_MAJORS],
      semesters: [3, 3, 3, 3, 3, 3],
    };
    expect(semesterForMajor(row, 4, CATALOG_MAJORS)).toBe(3); // Mechatronics
    expect(semesterForMajor(row, 0, CATALOG_MAJORS)).toBe(3); // Petrol
    expect(semesterForMajor(row, 3, CATALOG_MAJORS)).toBe(3); // Civil
  });

  it('returns 0 for a major that the row drops (not in the row\'s majors[])', () => {
    // MEC111 has 4 majors + [3,3,3,3] — Environmental Architecture
    // isn't in the row's list, so picking it should return 0 even
    // though the catalog has a 6-major list.
    const row = {
      majors: [
        'Petrol and Gas Engineering',
        'Aerospace Engineering',
        'Mechatronics Engineering',
        'Biomedical Engineering',
      ],
      semesters: [3, 3, 3, 3],
    };
    expect(semesterForMajor(row, 0, CATALOG_MAJORS)).toBe(3); // Petrol: in
    expect(semesterForMajor(row, 1, CATALOG_MAJORS)).toBe(0); // Env Arch: off-plan
    expect(semesterForMajor(row, 4, CATALOG_MAJORS)).toBe(3); // Mechatronics: in
    expect(semesterForMajor(row, 5, CATALOG_MAJORS)).toBe(3); // Biomedical: in
  });
});

describe('semesterForMajor — narrow shape (single-major rows)', () => {
  it('resolves the picked major inside the row\'s own majors[]', () => {
    // MEC242 — CNC Machine: only on Mechatronics, semester 7.
    const row = {
      majors: ['Mechatronics Engineering'],
      semesters: [7],
    };
    expect(semesterForMajor(row, 4, CATALOG_MAJORS)).toBe(7); // Mechatronics
  });

  it('resolves MEC342 — Additive Manufacturing the same way', () => {
    const row = {
      majors: ['Mechatronics Engineering'],
      semesters: [7],
    };
    expect(semesterForMajor(row, 4, CATALOG_MAJORS)).toBe(7);
  });

  it('returns 0 when the picked major is not in the row\'s majors[]', () => {
    // Same narrow row, but caller picked Civil (index 3).
    const row = {
      majors: ['Mechatronics Engineering'],
      semesters: [7],
    };
    expect(semesterForMajor(row, 3, CATALOG_MAJORS)).toBe(0);
  });

  it('handles rows that list two majors (still narrow, not wide)', () => {
    // Course shared between Mechatronics (sem 5) and Biomed (sem 6).
    const row = {
      majors: ['Mechatronics Engineering', 'Biomedical Engineering'],
      semesters: [5, 6],
    };
    expect(semesterForMajor(row, 4, CATALOG_MAJORS)).toBe(5); // Mech
    expect(semesterForMajor(row, 5, CATALOG_MAJORS)).toBe(6); // Biomed
    expect(semesterForMajor(row, 0, CATALOG_MAJORS)).toBe(0); // Petrol: off-plan
  });
});

describe('semesterForMajor — legacy / edge cases', () => {
  it('falls back to direct index when no catalogMajors is provided', () => {
    // Behaves like the v1 code: just `semesters[majorIdx]`.
    const row = { majors: undefined, semesters: [3, 3, 3, 3, 7, 3] };
    expect(semesterForMajor(row, 4)).toBe(7);
    expect(semesterForMajor(row, 0)).toBe(3);
  });

  it('returns 0 when majorIdx is -1 (no major picked)', () => {
    const row = { majors: ['Mechatronics Engineering'], semesters: [7] };
    expect(semesterForMajor(row, -1, CATALOG_MAJORS)).toBe(0);
  });

  it('returns 0 when the row has no semesters[] column', () => {
    const row = { majors: ['Mechatronics Engineering'] };
    expect(semesterForMajor(row, 4, CATALOG_MAJORS)).toBe(0);
  });

  it('returns 0 when the row has an empty semesters[] column', () => {
    const row = { majors: ['Mechatronics Engineering'], semesters: [] };
    expect(semesterForMajor(row, 4, CATALOG_MAJORS)).toBe(0);
  });

  it('ignores out-of-range semester values (0 and > MAX_SEMESTER)', () => {
    const row = {
      majors: ['Mechatronics Engineering'],
      semesters: [0], // sem 0 = off-plan
    };
    expect(semesterForMajor(row, 4, CATALOG_MAJORS)).toBe(0);
  });
});
