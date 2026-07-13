/**
 * Unit tests for the v2 advising queries.
 *
 * Pins the contract for each of the four v1 queries. Same fixtures as
 * metrics.test.ts where possible.
 */

import { describe, it, expect } from 'vitest';
import type { CourseCatalog, GradeRow, Term } from './types';
import {
  catalogStatusForStudent,
  studentsBlockedFromNextTerm,
  studentsWhoFailedCourse,
  studentsWithPlannedConflict,
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

const rows: GradeRow[] = [
  row({ studentId: 'S1', course: 'MAT101', grade: 'A', term: 'Fall 2024' }),
  row({ studentId: 'S1', course: 'MEC011', grade: 'F', term: 'Spring 2025' }),
  row({ studentId: 'S1', course: 'MEC011', grade: 'F', term: 'Fall 2025' }),
  row({ studentId: 'S1', course: 'CHE101', grade: 'C', term: 'Fall 2025' }),
  row({ studentId: 'S2', studentName: 'Sara', course: 'MAT101', grade: 'B', term: 'Fall 2024' }),
  row({ studentId: 'S2', studentName: 'Sara', major: 'Mechatronics', course: 'MEC011', grade: 'FD', term: 'Fall 2024' }),
  row({ studentId: 'S3', studentName: 'Omar', major: 'Civil', course: 'MAT101', grade: 'A', term: 'Fall 2024' }),
];

const catalog: CourseCatalog = {
  courses: [
    { code: 'MAT101', title: 'Calculus I', credits: 3, prerequisites: [] },
    { code: 'MEC011', title: 'Intro to Mechatronics', credits: 3, prerequisites: ['MAT101'] },
    { code: 'MEC211', title: 'Robotics', credits: 3, prerequisites: ['MEC011'] },
    { code: 'CHE101', title: 'Chemistry', credits: 3, prerequisites: [] },
  ],
};

describe('catalogStatusForStudent', () => {
  it('marks MEC011 as failed-prereq for S1 (S1 previously failed it)', () => {
    const s = catalogStatusForStudent(rows, 'S1', catalog);
    const mec011 = s.find((c) => c.course.code === 'MEC011');
    expect(mec011?.status).toBe('failed-prereq');
    expect(mec011?.missingPrereqs).toEqual([]);
  });

  it('marks MEC211 as failed-prereq for S1 (its prereq MEC011 was failed)', () => {
    const s = catalogStatusForStudent(rows, 'S1', catalog);
    const mec211 = s.find((c) => c.course.code === 'MEC211');
    expect(mec211?.status).toBe('failed-prereq');
    expect(mec211?.missingPrereqs).toEqual(['MEC011']);
  });

  it('does not include MAT101 for S1 (already passed)', () => {
    const s = catalogStatusForStudent(rows, 'S1', catalog);
    expect(s.some((c) => c.course.code === 'MAT101')).toBe(false);
  });

  it('marks MEC011 as failed-prereq for S2 (Sara previously failed it) and MEC211 as blocked (its prereq MEC011 failed)', () => {
    const s = catalogStatusForStudent(rows, 'S2', catalog);
    const mec011 = s.find((c) => c.course.code === 'MEC011');
    const mec211 = s.find((c) => c.course.code === 'MEC211');
    expect(mec011?.status).toBe('failed-prereq');
    expect(mec211?.status).toBe('failed-prereq');
  });

  it('returns [] when catalog is null', () => {
    expect(catalogStatusForStudent(rows, 'S1', null)).toEqual([]);
  });
});

describe('studentsWhoFailedCourse', () => {
  it('returns every student whose failedSubjects contains the course (case-insensitive)', () => {
    const res = studentsWhoFailedCourse(rows, 'mec011');
    // Both S1 and S2 failed MEC011 in the fixture.
    expect(res).toHaveLength(2);
    expect(res.map((r) => r.studentId).sort()).toEqual(['S1', 'S2']);
    for (const r of res) expect(r.failedCodes).toContain('MEC011');
  });

  it('returns [] for a course nobody failed', () => {
    expect(studentsWhoFailedCourse(rows, 'CHE101')).toEqual([]);
  });

  it('returns [] for empty input', () => {
    expect(studentsWhoFailedCourse([], 'MEC011')).toEqual([]);
  });

  it('prefix-matches: typing "MEC" returns students who failed any MECxxx course', () => {
    const res = studentsWhoFailedCourse(rows, 'MEC');
    // Both S1 and S2 failed MEC011; prefix search surfaces them.
    expect(res.map((r) => r.studentId).sort()).toEqual(['S1', 'S2']);
  });

  it('prefix-matches case-insensitively', () => {
    expect(studentsWhoFailedCourse(rows, 'mec').map((r) => r.studentId).sort()).toEqual(
      studentsWhoFailedCourse(rows, 'MEC').map((r) => r.studentId).sort()
    );
  });

  it('exact match wins: typing "MEC011" returns only the MEC011 failures, not MEC211', () => {
    const res = studentsWhoFailedCourse(rows, 'MEC011');
    expect(res.map((r) => r.studentId).sort()).toEqual(['S1', 'S2']);
  });
});

describe('studentsBlockedFromNextTerm', () => {
  it('returns S1, S2, and S3 (all have at least one blocked/failed catalog course)', () => {
    const res = studentsBlockedFromNextTerm(rows, catalog);
    expect(res).toHaveLength(3);
    const ids = res.map((r) => r.studentId).sort();
    expect(ids).toEqual(['S1', 'S2', 'S3']);
    const s1 = res.find((r) => r.studentId === 'S1');
    expect(s1?.blocked.map((b) => b.code).sort()).toEqual(['MEC011', 'MEC211']);
    // S3 only has MEC211 as blocked (MAT101 passed, MEC011 not attempted yet).
    const s3 = res.find((r) => r.studentId === 'S3');
    expect(s3?.blocked.map((b) => b.code)).toEqual(['MEC211']);
  });

  it('returns [] when catalog is null', () => {
    expect(studentsBlockedFromNextTerm(rows, null)).toEqual([]);
  });
});

describe('suggestNextRegistration', () => {
  it('lists MEC011 and MEC211 (both failed-prereq) for S1 in code order', () => {
    const res = suggestNextRegistration(rows, catalog, 'S1');
    expect(res).toHaveLength(2);
    expect(res[0].course.code).toBe('MEC011');
    expect(res[0].status).toBe('failed-prereq');
    expect(res[1].course.code).toBe('MEC211');
    expect(res[1].status).toBe('failed-prereq');
  });

  it('lists MEC011 (failed-prereq) + MEC211 (failed-prereq) + CHE101 (open) for S2 — failed-prereq first', () => {
    const res = suggestNextRegistration(rows, catalog, 'S2');
    expect(res).toHaveLength(3);
    // New sort order: failed-prereq first (adviser-actionable), then
    // blocked, then open. Within failed-prereq, by blocking impact desc.
    expect(res[0].course.code).toBe('MEC011');
    expect(res[0].status).toBe('failed-prereq');
    expect(res[1].course.code).toBe('MEC211');
    expect(res[1].status).toBe('failed-prereq');
    expect(res[2].course.code).toBe('CHE101');
    expect(res[2].status).toBe('open');
  });
});

describe('studentsWithPlannedConflict', () => {
  it('flags every student whose plan includes a course they previously failed', () => {
    const terms: Term[] = [
      {
        id: 't1',
        name: 'Fall 2026',
        createdAt: '2026-01-01T00:00:00Z',
        entries: [
          { studentId: 'S1', courseCodes: ['MEC011', 'MEC211'] },
          { studentId: 'S2', courseCodes: ['MEC011'] },
          { studentId: 'S3', courseCodes: ['MEC011'] },
        ],
      },
    ];
    const res = studentsWithPlannedConflict(rows, terms);
    // S1 and S2 both previously failed MEC011. S3 has no failures, no conflict.
    expect(res).toHaveLength(2);
    expect(res.map((r) => r.studentId).sort()).toEqual(['S1', 'S2']);
    // The term name surfaces in each conflict row for the advising UI.
    expect(res[0].conflicts.every((c) => c.termName === 'Fall 2026')).toBe(true);
  });

  it('returns [] when no terms are imported', () => {
    expect(studentsWithPlannedConflict(rows, [])).toEqual([]);
  });

  it('surfaces conflicts from multiple terms independently', () => {
    const terms: Term[] = [
      {
        id: 'summer',
        name: 'Summer 2026',
        createdAt: '2026-06-01T00:00:00Z',
        entries: [{ studentId: 'S1', courseCodes: ['MEC011'] }],
      },
      {
        id: 'fall',
        name: 'Fall 2026',
        createdAt: '2026-09-01T00:00:00Z',
        entries: [{ studentId: 'S1', courseCodes: ['MEC011'] }],
      },
    ];
    const res = studentsWithPlannedConflict(rows, terms);
    expect(res).toHaveLength(1);
    expect(res[0].conflicts).toHaveLength(2);
    expect(res[0].conflicts.map((c) => c.termName).sort()).toEqual(['Fall 2026', 'Summer 2026']);
  });
});