/**
 * Unit tests for the v2 advising changes:
 *   - Per-major scope (Petrol vs Mechatronics vs Civil)
 *   - Blocking impact on CatalogCourseStatus + NextRegistrationRow
 *   - New suggest sort order: failed-prereq → blocked → open,
 *     failed-prereq sorted by blocking impact desc
 *   - studentsWhoFailedCourse new filter overload (studentName + major)
 *
 * All fixtures share the same multi-major catalog so we can prove
 * the major scope actually narrows the result.
 */

import { describe, it, expect } from 'vitest';
import type { CatalogCourse, CourseCatalog, GradeRow, RosterEntry } from './types';
import {
  catalogStatusForStudent,
  studentsBlockedFromNextTerm,
  studentsWhoFailedCourse,
  suggestNextRegistration,
} from './advising';

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

// Same multi-major catalog used by every test:
//   majors[]  = ['Petrol', 'Mechatronics', 'Civil']
//   semesters[] per major (1..10; 0 = not on plan)
const catalog: CourseCatalog = {
  courses: [
    // On every major's plan (sem 1 for all).
    {
      code: 'MAT101',
      title: 'Calculus I',
      credits: 3,
      prerequisites: [],
      majors: ['Petrol', 'Mechatronics', 'Civil'],
      semesters: [1, 1, 1],
    },
    // Petrol-only course (sem 2 for Petrol, 0 for the others).
    {
      code: 'PET210',
      title: 'Petroleum Geology',
      credits: 3,
      prerequisites: ['MAT101'],
      majors: ['Petrol', 'Mechatronics', 'Civil'],
      semesters: [2, 0, 0],
    },
    // Mechatronics-only course (sem 2 for Mechatronics, 0 for the others).
    {
      code: 'MEC211',
      title: 'Robotics',
      credits: 3,
      prerequisites: ['MEC011'],
      majors: ['Petrol', 'Mechatronics', 'Civil'],
      semesters: [0, 2, 0],
    },
    // Civil-only course (sem 2 for Civil, 0 for the others).
    {
      code: 'CIV230',
      title: 'Soil Mechanics',
      credits: 3,
      prerequisites: ['MAT101'],
      majors: ['Petrol', 'Mechatronics', 'Civil'],
      semesters: [0, 0, 2],
    },
    // On Mechatronics plan only, depends on MEC011 (failed-prereq
    // magnet for the suggest tests).
    {
      code: 'MEC011',
      title: 'Intro to Mechatronics',
      credits: 3,
      prerequisites: ['MAT101'],
      majors: ['Petrol', 'Mechatronics', 'Civil'],
      semesters: [0, 1, 0],
    },
  ] as CatalogCourse[],
};

const rows: GradeRow[] = [
  // Sara — Mechatronics, passed MAT101, failed MEC011.
  row({ studentId: 'Sara', studentName: 'Sara Khan', major: 'Mechatronics', course: 'MAT101', grade: 'A', term: 'Fall 2024' }),
  row({ studentId: 'Sara', studentName: 'Sara Khan', major: 'Mechatronics', course: 'MEC011', grade: 'F', term: 'Spring 2025' }),
  row({ studentId: 'Sara', studentName: 'Sara Khan', major: 'Mechatronics', course: 'MEC011', grade: 'F', term: 'Fall 2025' }),
  // Omar — Civil, passed MAT101.
  row({ studentId: 'Omar', studentName: 'Omar Yousif', major: 'Civil', course: 'MAT101', grade: 'A', term: 'Fall 2024' }),
  // Layla — Petrol, passed MAT101.
  row({ studentId: 'Layla', studentName: 'Layla Hassan', major: 'Petrol', course: 'MAT101', grade: 'A', term: 'Fall 2024' }),
];

const roster: RosterEntry[] = [
  { studentId: 'Sara', studentName: 'Sara Khan', major: 'Mechatronics Engineering' },
  { studentId: 'Omar', studentName: 'Omar Yousif', major: 'Civil Engineering' },
  { studentId: 'Layla', studentName: 'Layla Hassan', major: 'Petrol and Gas Engineering' },
];

// ---------------------------------------------------------------------------
// Major scope
// ---------------------------------------------------------------------------

describe('catalogStatusForStudent — per-major scope', () => {
  it("drops catalog courses that aren't on the student's major plan", () => {
    const sara = catalogStatusForStudent(rows, 'Sara', catalog, 'Mechatronics Engineering');
    const codes = sara.map((s) => s.course.code).sort();
    // MEC011 + MEC211 are the only Mechatronics rows. CIV230, PET210
    // are on other majors' plans and must be absent.
    expect(codes).toEqual(['MEC011', 'MEC211']);
  });

  it('includes every on-plan course for a Civil student', () => {
    const omar = catalogStatusForStudent(rows, 'Omar', catalog, 'Civil Engineering');
    const codes = omar.map((s) => s.course.code).sort();
    expect(codes).toEqual(['CIV230']);
  });

  it('includes every on-plan course for a Petrol student', () => {
    const layla = catalogStatusForStudent(rows, 'Layla', catalog, 'Petrol and Gas Engineering');
    const codes = layla.map((s) => s.course.code).sort();
    expect(codes).toEqual(['PET210']);
  });

  it('falls back to the first major when no major is given', () => {
    // No studentMajor passed → index 0 → Petrol plan.
    const layla = catalogStatusForStudent(rows, 'Layla', catalog);
    const codes = layla.map((s) => s.course.code).sort();
    expect(codes).toEqual(['PET210']);
  });

  it('returns all courses when the catalog has no per-major semesters[]', () => {
    const flat: CourseCatalog = {
      courses: [
        { code: 'MAT101', title: 'Calculus I', credits: 3, prerequisites: [] },
        { code: 'PHY101', title: 'Physics', credits: 3, prerequisites: ['MAT101'] },
      ],
    };
    const flatRows: GradeRow[] = [row({ studentId: 'X', course: 'MAT101', grade: 'A' })];
    const res = catalogStatusForStudent(flatRows, 'X', flat, 'Whatever');
    // PHY101 has no per-major data — must still surface.
    expect(res.map((r) => r.course.code).sort()).toEqual(['PHY101']);
  });
});

// ---------------------------------------------------------------------------
// Blocking impact
// ---------------------------------------------------------------------------

describe('CatalogCourseStatus.blockingImpact', () => {
  it('counts how many other catalog courses list this one as a prereq', () => {
    const sara = catalogStatusForStudent(rows, 'Sara', catalog, 'Mechatronics Engineering');
    const mec011 = sara.find((s) => s.course.code === 'MEC011');
    const mec211 = sara.find((s) => s.course.code === 'MEC211');
    // MEC211 lists MEC011 as prereq → MEC011 has impact 1.
    expect(mec011?.blockingImpact).toBe(1);
    // MEC211 has no dependents → 0.
    expect(mec211?.blockingImpact).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// New sort order
// ---------------------------------------------------------------------------

describe('suggestNextRegistration — failed-prereq first', () => {
  it('orders failed-prereq > blocked > open (most-blocking first inside failed-prereq)', () => {
    // Sara: MEC011 (failed-prereq, blocks 1), MEC211 (failed-prereq, blocks 0).
    const res = suggestNextRegistration(rows, catalog, 'Sara', 'Mechatronics Engineering');
    expect(res.map((r) => r.course.code)).toEqual(['MEC011', 'MEC211']);
    expect(res.every((r) => r.status === 'failed-prereq')).toBe(true);
  });

  it('attaches blockingImpact to every row', () => {
    const res = suggestNextRegistration(rows, catalog, 'Sara', 'Mechatronics Engineering');
    expect(res[0].blockingImpact).toBe(1);
    expect(res[1].blockingImpact).toBe(0);
  });

  it('produces an open + blocked mix for a student with no failures', () => {
    // Omar: MAT101 passed, CIV230 is open (its prereq MAT101 is passed).
    const res = suggestNextRegistration(rows, catalog, 'Omar', 'Civil Engineering');
    expect(res).toHaveLength(1);
    expect(res[0].course.code).toBe('CIV230');
    expect(res[0].status).toBe('open');
    expect(res[0].blockingImpact).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// studentsWhoFailedCourse — name + major filters
// ---------------------------------------------------------------------------

describe('studentsWhoFailedCourse — name + major filter overload', () => {
  it('still accepts the one-arg form (back-compat)', () => {
    const res = studentsWhoFailedCourse(rows, 'MEC011');
    expect(res.map((r) => r.studentId)).toEqual(['Sara']);
  });

  it('matches by catalog title (case-insensitive substring)', () => {
    // Sara failed MEC011, whose catalog title is "Intro to Mechatronics".
    const res = studentsWhoFailedCourse(
      rows,
      { courseCode: 'mechatronics' },
      roster,
      catalog
    );
    expect(res.map((r) => r.studentId)).toEqual(['Sara']);
  });

  it('title search is case-insensitive and matches partial words', () => {
    const res = studentsWhoFailedCourse(
      rows,
      { courseCode: 'INTRO' },
      roster,
      catalog
    );
    expect(res.map((r) => r.studentId)).toEqual(['Sara']);
  });

  it('returns [] when neither code nor title match anything', () => {
    const res = studentsWhoFailedCourse(
      rows,
      { courseCode: 'quantum entanglement' },
      roster,
      catalog
    );
    expect(res).toEqual([]);
  });

  it('falls back to code-only matching when no catalog is provided', () => {
    // No catalog passed — typing "mechatronics" returns nothing,
    // typing "MEC011" still works.
    const noTitle = studentsWhoFailedCourse(
      rows,
      { courseCode: 'mechatronics' },
      roster
    );
    expect(noTitle).toEqual([]);
    const codeOnly = studentsWhoFailedCourse(
      rows,
      { courseCode: 'MEC011' },
      roster
    );
    expect(codeOnly.map((r) => r.studentId)).toEqual(['Sara']);
  });

  it('filters by student name (case-insensitive contains)', () => {
    const res = studentsWhoFailedCourse(
      rows,
      { courseCode: 'MEC011', studentName: 'sara' },
      roster
    );
    expect(res.map((r) => r.studentId)).toEqual(['Sara']);
  });

  it('returns [] when the name filter matches no student with the failed course', () => {
    const res = studentsWhoFailedCourse(
      rows,
      { courseCode: 'MEC011', studentName: 'omar' },
      roster
    );
    expect(res).toEqual([]);
  });

  it('filters by exact major', () => {
    const res = studentsWhoFailedCourse(
      rows,
      { courseCode: 'MEC011', major: 'Mechatronics Engineering' },
      roster
    );
    expect(res.map((r) => r.studentId)).toEqual(['Sara']);
  });

  it('combines name + major with AND', () => {
    // Sara matches name AND major — result kept.
    const ok = studentsWhoFailedCourse(
      rows,
      { courseCode: 'MEC011', studentName: 'sara', major: 'Mechatronics Engineering' },
      roster
    );
    expect(ok).toHaveLength(1);

    // Name matches, major doesn't — result dropped.
    const wrongMajor = studentsWhoFailedCourse(
      rows,
      { courseCode: 'MEC011', studentName: 'sara', major: 'Civil Engineering' },
      roster
    );
    expect(wrongMajor).toEqual([]);
  });

  it('uses the roster name + major when present (over the grade-book row)', () => {
    const res = studentsWhoFailedCourse(
      rows,
      { courseCode: 'MEC011' },
      roster
    );
    expect(res[0].studentName).toBe('Sara Khan');
    expect(res[0].major).toBe('Mechatronics Engineering');
  });
});

// ---------------------------------------------------------------------------
// studentsBlockedFromNextTerm — uses the new major-scoped core
// ---------------------------------------------------------------------------

describe('studentsBlockedFromNextTerm — now respects major scope', () => {
  it('only surfaces each student against their OWN major plan', () => {
    const res = studentsBlockedFromNextTerm(rows, catalog, roster);
    // Sara (Mechatronics) is blocked on MEC211 because MEC011 was failed.
    const sara = res.find((r) => r.studentId === 'Sara');
    expect(sara?.blocked.map((b) => b.code).sort()).toEqual(['MEC011', 'MEC211']);
    // Omar (Civil) — CIV230 is open (MAT101 passed), so no blocked rows.
    expect(res.some((r) => r.studentId === 'Omar')).toBe(false);
    // Layla (Petrol) — PET210 open, no blocked rows.
    expect(res.some((r) => r.studentId === 'Layla')).toBe(false);
  });
});