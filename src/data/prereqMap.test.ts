/**
 * Unit tests for buildPrereqMap. Pins the contract the screen relies
 * on: 10-semester columns, status badges, major-mismatch fallback,
 * prereq edges, and zero-catalog safety.
 */

import { describe, it, expect } from 'vitest';
import type { CourseCatalog, GradeRow } from './types';
import { buildPrereqMap } from './prereqMap';

function row(partial: Partial<GradeRow>): GradeRow {
  return {
    studentId: 'S1',
    course: 'MAT101',
    units: 3,
    grade: 'A',
    term: 'Fall 2024',
    ...partial,
  };
}

const majors = [
  'Petrol and Gas Engineering',
  'Environmental Architecture',
  'Aerospace Engineering',
  'Civil Engineering',
  'Mechatronics Engineering',
  'Biomedical Engineering',
];

const catalog: CourseCatalog = {
  courses: [
    { code: 'MAT101', title: 'Calc I', credits: 3, prerequisites: [],
      majors, semesters: [1, 1, 1, 1, 1, 1] },
    { code: 'PHY111', title: 'Physics I', credits: 3, prerequisites: [],
      majors, semesters: [1, 1, 1, 1, 1, 1] },
    { code: 'MAT211', title: 'Calc III', credits: 3, prerequisites: ['MAT101'],
      majors, semesters: [3, 3, 3, 3, 3, 3] },
    { code: 'ARC111', title: 'Visual Perception', credits: 3, prerequisites: [],
      majors, semesters: [0, 3, 0, 0, 0, 0] },
    { code: 'CIV999', title: 'Civil-only', credits: 3, prerequisites: ['MAT211'],
      majors, semesters: [0, 0, 0, 7, 0, 0] },
  ],
};

describe('buildPrereqMap', () => {
  it('returns 10 empty semesters when no catalog is loaded', () => {
    const m = buildPrereqMap(null, [], 'S1', 'Civil Engineering');
    expect(m.semesters).toHaveLength(10);
    expect(m.semesters.every((c) => c.courses.length === 0)).toBe(true);
    expect(m.edges).toEqual([]);
  });

  it('places common sem-1 courses into the right major column', () => {
    const m = buildPrereqMap(catalog, [], 'S1', 'Civil Engineering');
    const sem1 = m.semesters[0].courses.map((c) => c.code);
    // MAT101 + PHY111 are in sem 1 for Civil (MAT211 is sem 3).
    expect(sem1).toContain('MAT101');
    expect(sem1).toContain('PHY111');
    expect(m.resolvedMajor).toBe('Civil Engineering');
    expect(m.majorMismatch).toBe(false);
  });

  it('drops courses whose semester is 0 for the active major', () => {
    const m = buildPrereqMap(catalog, [], 'S1', 'Petrol and Gas Engineering');
    const codes = m.semesters.flatMap((c) => c.courses.map((x) => x.code));
    // ARC111 is architecture-only — should NOT appear for Petrol.
    expect(codes).not.toContain('ARC111');
  });

  it('marks courses never attempted but with prereqs as blocked', () => {
    const m = buildPrereqMap(catalog, [], 'S1', 'Civil Engineering');
    const mat211 = m.semesters[2].courses.find((c) => c.code === 'MAT211');
    expect(mat211?.status).toBe('blocked');
    expect(mat211?.missingPrereqs).toContain('MAT101');
  });

  it('marks passed courses as passed', () => {
    const rows = [
      row({ studentId: 'S1', course: 'MAT101', grade: 'A' }),
      row({ studentId: 'S1', course: 'MAT211', grade: 'B' }),
    ];
    const m = buildPrereqMap(catalog, rows, 'S1', 'Civil Engineering');
    const mat101 = m.semesters[0].courses.find((c) => c.code === 'MAT101');
    const mat211 = m.semesters[2].courses.find((c) => c.code === 'MAT211');
    expect(mat101?.status).toBe('passed');
    expect(mat211?.status).toBe('passed');
  });

  it('marks failed courses as failed', () => {
    const rows = [
      row({ studentId: 'S1', course: 'MAT101', grade: 'F' }),
      row({ studentId: 'S1', course: 'MAT101', grade: 'FD' }),
    ];
    const m = buildPrereqMap(catalog, rows, 'S1', 'Civil Engineering');
    const mat101 = m.semesters[0].courses.find((c) => c.code === 'MAT101');
    expect(mat101?.status).toBe('failed');
    expect(mat101?.failed).toBe(true);
  });

  it('reports prereq edges for the SVG arrows', () => {
    const m = buildPrereqMap(catalog, [], 'S1', 'Civil Engineering');
    // MAT101 -> MAT211 and MAT211 -> CIV999 are both in the catalog.
    expect(m.edges).toContainEqual({ from: 'MAT101', to: 'MAT211' });
    expect(m.edges).toContainEqual({ from: 'MAT211', to: 'CIV999' });
  });

  it('populates `blocks` with downstream courses each card unlocks', () => {
    const m = buildPrereqMap(catalog, [], 'S1', 'Civil Engineering');
    const mat101 = m.semesters[0].courses.find((c) => c.code === 'MAT101');
    // MAT101 is a prereq for MAT211 → MAT101's `blocks` includes MAT211.
    expect(mat101?.blocks).toContain('MAT211');
    const mat211 = m.semesters[2].courses.find((c) => c.code === 'MAT211');
    // MAT211 is a prereq for CIV999 → MAT211's `blocks` includes CIV999.
    expect(mat211?.blocks).toContain('CIV999');
    // PHY111 has no dependents — `blocks` is an empty array.
    const phy111 = m.semesters[0].courses.find((c) => c.code === 'PHY111');
    expect(phy111?.blocks).toEqual([]);
  });

  it('falls back gracefully on a major that does not match', () => {
    const m = buildPrereqMap(catalog, [], 'S1', 'Astrophysics');
    // We don't error; we just render the first major's plan and flag
    // the mismatch in the metadata.
    expect(m.majorMismatch).toBe(true);
    expect(m.resolvedMajor).not.toBeNull();
    expect(m.semesters[0].courses.length).toBeGreaterThan(0);
  });

  it('uses alias matching for common short major names', () => {
    const m = buildPrereqMap(catalog, [], 'S1', 'aero');
    expect(m.resolvedMajor).toBe('Aerospace Engineering');
  });

  it('marks "failed-prereq" distinct from "blocked" when the prereq was failed', () => {
    const rows = [
      row({ studentId: 'S1', course: 'MAT101', grade: 'F' }),
      row({ studentId: 'S1', course: 'MAT101', grade: 'FD' }),
    ];
    const m = buildPrereqMap(catalog, rows, 'S1', 'Civil Engineering');
    const mat211 = m.semesters[2].courses.find((c) => c.code === 'MAT211');
    // MAT211 was never attempted, but MAT101 was failed. The status
    // is 'failed-prereq' (rose) — distinct from 'blocked' (amber).
    expect(mat211?.status).toBe('failed-prereq');
    expect(mat211?.missingPrereqs).toContain('MAT101');
  });

  it('keeps "blocked" (amber) when prereqs are merely missing, never attempted', () => {
    const rows: GradeRow[] = []; // S1 has zero grade-book rows
    const m = buildPrereqMap(catalog, rows, 'S1', 'Civil Engineering');
    const mat211 = m.semesters[2].courses.find((c) => c.code === 'MAT211');
    expect(mat211?.status).toBe('blocked');
  });

  it('marks "planned" for courses the student has put on the plan', () => {
    const m = buildPrereqMap(
      catalog,
      [],
      'S1',
      'Civil Engineering',
      { courseCodes: ['MAT211'] }
    );
    const mat211 = m.semesters[2].courses.find((c) => c.code === 'MAT211');
    expect(mat211?.status).toBe('planned');
  });

  it('classifies a planned course as "new" when never attempted', () => {
    const m = buildPrereqMap(
      catalog,
      [],
      'S1',
      'Civil Engineering',
      { courseCodes: ['MAT211'] }
    );
    const mat211 = m.semesters[2].courses.find((c) => c.code === 'MAT211');
    expect(mat211?.planClassification).toBe('new');
  });

  it('classifies a planned course as "enhancing" when previously passed', () => {
    const rows = [row({ course: 'MAT101', grade: 'A' })];
    const m = buildPrereqMap(
      catalog,
      rows,
      'S1',
      'Civil Engineering',
      { courseCodes: ['MAT101'] }
    );
    const mat101 = m.semesters[0].courses.find((c) => c.code === 'MAT101');
    expect(mat101?.planClassification).toBe('enhancing');
  });

  it('classifies a planned course as "repeated" when previously failed', () => {
    const rows = [row({ course: 'MAT101', grade: 'F' })];
    const m = buildPrereqMap(
      catalog,
      rows,
      'S1',
      'Civil Engineering',
      { courseCodes: ['MAT101'] }
    );
    const mat101 = m.semesters[0].courses.find((c) => c.code === 'MAT101');
    expect(mat101?.planClassification).toBe('repeated');
  });

  it('does NOT classify non-planned courses (passed/failed/open/blocked)', () => {
    // Passed course: planClassification must be undefined.
    const passedRows = [row({ course: 'MAT101', grade: 'A' })];
    const m1 = buildPrereqMap(catalog, passedRows, 'S1', 'Civil Engineering');
    const passed = m1.semesters[0].courses.find((c) => c.code === 'MAT101');
    expect(passed?.status).toBe('passed');
    expect(passed?.planClassification).toBeUndefined();

    // Failed course: planClassification must be undefined (the failed
    // badge is the source of truth for "repeated" status).
    const failedRows = [row({ course: 'MAT101', grade: 'F' })];
    const m2 = buildPrereqMap(catalog, failedRows, 'S1', 'Civil Engineering');
    const failed = m2.semesters[0].courses.find((c) => c.code === 'MAT101');
    expect(failed?.status).toBe('failed');
    expect(failed?.planClassification).toBeUndefined();

    // Open course: planClassification must be undefined.
    const m3 = buildPrereqMap(catalog, [], 'S1', 'Civil Engineering');
    const open = m3.semesters[0].courses.find((c) => c.code === 'MAT101');
    expect(open?.status).toBe('open');
    expect(open?.planClassification).toBeUndefined();
  });

  it('records the latest grade for every course, including never-attempted', () => {
    const rows = [
      row({ course: 'MAT101', grade: 'F', term: 'Fall 2024' }),
      row({ course: 'MAT101', grade: 'C+', term: 'Spring 2025' }), // latest
    ];
    const m = buildPrereqMap(catalog, rows, 'S1', 'Civil Engineering');
    const mat101 = m.semesters[0].courses.find((c) => c.code === 'MAT101');
    expect(mat101?.latestGrade).toBe('C+');

    // Never-attempted course: empty string (NOT undefined).
    const mat211 = m.semesters[2].courses.find((c) => c.code === 'MAT211');
    expect(mat211?.latestGrade).toBe('');
  });

  it('returns the latest PASSING grade even if a later attempt was a fail', () => {
    // The student passed MAT101 once, then failed it again on a
    // retry. The card must show the passing letter grade, not "F"
    // — the student has the credit; the failed retry is historical.
    const rows = [
      row({ course: 'MAT101', grade: 'B+', term: 'Fall 2024' }),  // pass
      row({ course: 'MAT101', grade: 'F',  term: 'Spring 2025' }), // fail retry
    ];
    const m = buildPrereqMap(catalog, rows, 'S1', 'Civil Engineering');
    const mat101 = m.semesters[0].courses.find((c) => c.code === 'MAT101');
    expect(mat101?.status).toBe('passed'); // ANY pass → 'passed'
    expect(mat101?.latestGrade).toBe('B+');
  });

  it('picks the latest PASSING grade among multiple passes', () => {
    // Multiple passing attempts: surface the most recent one in
    // row order, not the earliest. This matters when the student
    // upgraded (e.g. retook to improve the letter grade).
    const rows = [
      row({ course: 'MAT101', grade: 'C+', term: 'Fall 2024' }),
      row({ course: 'MAT101', grade: 'A',  term: 'Spring 2025' }),
      row({ course: 'MAT101', grade: 'B',  term: 'Fall 2025' }), // latest passing
    ];
    const m = buildPrereqMap(catalog, rows, 'S1', 'Civil Engineering');
    const mat101 = m.semesters[0].courses.find((c) => c.code === 'MAT101');
    expect(mat101?.status).toBe('passed');
    expect(mat101?.latestGrade).toBe('B');
  });

  it('scopes `blocks` to the active major — drops dependents from other majors', () => {
    // Setup: MAT101 is a prereq for TWO downstream courses:
    //   - MAT211: every major's plan (sem 3 across the board)
    //   - ARC211: ARCHITECTURE ONLY (sem 5 on Arch, sem 0 elsewhere)
    // For a Civil student, ARC211 is OFF-PLAN for their major, so
    // MAT101's `blocks` only lists MAT211.
    // For an Arch student, BOTH MAT211 and ARC211 are on-plan, so
    // MAT101's `blocks` lists both.
    const multiCatalog: CourseCatalog = {
      courses: [
        { code: 'MAT101', title: 'Calc I', credits: 3, prerequisites: [],
          majors, semesters: [1, 1, 1, 1, 1, 1] },
        { code: 'MAT211', title: 'Calc III', credits: 3,
          prerequisites: ['MAT101'],
          majors, semesters: [3, 3, 3, 3, 3, 3] },
        { code: 'ARC211', title: 'Structures', credits: 3,
          prerequisites: ['MAT101'],
          majors, semesters: [0, 5, 0, 0, 0, 0] }, // arch-only
      ],
    };

    const civil = buildPrereqMap(multiCatalog, [], 'S1', 'Civil Engineering');
    const mat101Civil = civil.semesters[0].courses.find((c) => c.code === 'MAT101');
    // ARC211 is not on the Civil plan → filtered out.
    expect(mat101Civil?.blocks).toEqual(['MAT211']);

    const arch = buildPrereqMap(multiCatalog, [], 'S1', 'Environmental Architecture');
    const mat101Arch = arch.semesters[0].courses.find((c) => c.code === 'MAT101');
    // Both MAT211 and ARC211 are on the Arch plan → both surface.
    expect(mat101Arch?.blocks?.sort()).toEqual(['ARC211', 'MAT211']);

    // Petrol has no downstream dependents for MAT101 in this catalog
    // (MAT211 is in sem 3 for Petrol too — so it WOULD appear). Drop
    // MAT211 too by replacing the catalog with an arch-only chain.
    const archOnlyCatalog: CourseCatalog = {
      courses: [
        { code: 'MAT101', title: 'Calc I', credits: 3, prerequisites: [],
          majors, semesters: [1, 1, 1, 1, 1, 1] },
        { code: 'ARC211', title: 'Structures', credits: 3,
          prerequisites: ['MAT101'],
          majors, semesters: [0, 5, 0, 0, 0, 0] }, // arch-only
      ],
    };
    const petrol = buildPrereqMap(archOnlyCatalog, [], 'S1', 'Petrol and Gas Engineering');
    const mat101Petrol = petrol.semesters[0].courses.find((c) => c.code === 'MAT101');
    expect(mat101Petrol?.blocks).toEqual([]);
  });

  it('falls back to the latest attempt when the student has never passed', () => {
    // All attempts failed → the latest attempt's grade wins. The
    // helper does NOT pretend the student passed; it surfaces the
    // failing letter so the failed-course export reads correctly.
    const rows = [
      row({ course: 'MAT101', grade: 'F',  term: 'Fall 2024' }),
      row({ course: 'MAT101', grade: 'FD', term: 'Spring 2025' }), // latest
    ];
    const m = buildPrereqMap(catalog, rows, 'S1', 'Civil Engineering');
    const mat101 = m.semesters[0].courses.find((c) => c.code === 'MAT101');
    expect(mat101?.status).toBe('failed');
    expect(mat101?.latestGrade).toBe('FD');
  });
});