/**
 * Unit tests for failureStats — the leaderboard + per-student +
 * distribution aggregator.
 */

import { describe, it, expect } from 'vitest';
import type { CourseCatalog, GradeRow, RosterEntry } from './types';
import { failureStats } from './advising';

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

// Sara  — failed MEC011 + MEC211
// Omar  — failed MEC011
// Lina  — failed CIV230
// Yara  — failed MEC011 + MEC211 + CIV230
// Noor  — clean record
const rows: GradeRow[] = [
  row({ studentId: 'Sara', course: 'MEC011', grade: 'F', term: 'Fall 2024' }),
  row({ studentId: 'Sara', course: 'MEC211', grade: 'FD', term: 'Spring 2025' }),
  row({ studentId: 'Sara', course: 'MAT101', grade: 'A', term: 'Fall 2024' }),
  row({ studentId: 'Omar', course: 'MEC011', grade: 'F', term: 'Fall 2024' }),
  row({ studentId: 'Omar', course: 'MAT101', grade: 'A', term: 'Fall 2024' }),
  row({ studentId: 'Lina', course: 'CIV230', grade: 'F', term: 'Fall 2024' }),
  row({ studentId: 'Yara', course: 'MEC011', grade: 'F', term: 'Fall 2024' }),
  row({ studentId: 'Yara', course: 'MEC211', grade: 'FD', term: 'Spring 2025' }),
  row({ studentId: 'Yara', course: 'CIV230', grade: 'F', term: 'Fall 2024' }),
  row({ studentId: 'Noor', course: 'MAT101', grade: 'A', term: 'Fall 2024' }),
];

const catalog: CourseCatalog = {
  courses: [
    { code: 'MEC011', title: 'Intro to Mechatronics', credits: 3, prerequisites: [] },
    { code: 'MEC211', title: 'Robotics', credits: 3, prerequisites: [] },
    { code: 'CIV230', title: 'Soil Mechanics', credits: 3, prerequisites: [] },
  ],
};

const roster: RosterEntry[] = [
  { studentId: 'Sara', studentName: 'Sara Khan' },
  { studentId: 'Omar', studentName: 'Omar Yousif' },
  { studentId: 'Lina', studentName: 'Lina Adel' },
  { studentId: 'Yara', studentName: 'Yara Saleh' },
  { studentId: 'Noor', studentName: 'Noor Ali' },
];

describe('failureStats — leaderboard', () => {
  it('counts distinct students per course', () => {
    const stats = failureStats(rows);
    const byCourse = Object.fromEntries(
      stats.leaderboard.map((l) => [l.courseCode, l.count])
    );
    expect(byCourse).toEqual({
      MEC011: 3, // Sara, Omar, Yara
      MEC211: 2, // Sara, Yara
      CIV230: 2, // Lina, Yara
    });
  });

  it('sorts by count desc, code asc as tie-break', () => {
    const stats = failureStats(rows);
    expect(stats.leaderboard.map((l) => l.courseCode)).toEqual([
      'MEC011',
      'CIV230',
      'MEC211', // ties at 2 → alphabetical
    ]);
  });

  it('resolves catalog titles when a catalog is provided', () => {
    const stats = failureStats(rows, catalog);
    const mec = stats.leaderboard.find((l) => l.courseCode === 'MEC011');
    expect(mec?.courseTitle).toBe('Intro to Mechatronics');
  });

  it('returns empty title when no catalog is provided', () => {
    const stats = failureStats(rows);
    expect(stats.leaderboard[0].courseTitle).toBe('');
  });

  it('returns [] when no failures exist', () => {
    const clean = [row({ studentId: 'X', course: 'MAT101', grade: 'A' })];
    const stats = failureStats(clean);
    expect(stats.leaderboard).toEqual([]);
  });

  it('returns the full sorted studentIds list (no preview cap)', () => {
    // Build a fixture with 12 students all failing MEC011.
    const many: GradeRow[] = Array.from({ length: 12 }, (_, i) =>
      row({ studentId: `S${i}`, course: 'MEC011', grade: 'F' })
    );
    const stats = failureStats(many);
    expect(stats.leaderboard[0].count).toBe(12);
    expect(stats.leaderboard[0].studentIds).toHaveLength(12);
    expect(stats.leaderboard[0].studentIds).toEqual(
      // Lexicographic sort — "S10" comes between "S1" and "S2".
      Array.from({ length: 12 }, (_, i) => `S${i}`).sort()
    );
  });
});

describe('failureStats — students by failure count', () => {
  it('lists every student who failed at least one course with their count', () => {
    const stats = failureStats(rows, undefined, roster);
    const ids = stats.studentsByFailureCount.map((s) => s.studentId);
    expect(ids).toEqual(['Yara', 'Sara', 'Lina', 'Omar']);
    // Noor is excluded (zero failures).
    expect(ids).not.toContain('Noor');
  });

  it('sorts by count desc, studentId asc as tie-break', () => {
    const stats = failureStats(rows, undefined, roster);
    // Yara (3), Sara (2), then Omar + Lina tied at 1 → alphabetical.
    expect(stats.studentsByFailureCount.map((s) => `${s.studentId}:${s.count}`)).toEqual([
      'Yara:3',
      'Sara:2',
      'Lina:1',
      'Omar:1',
    ]);
  });

  it('uses roster names when present', () => {
    const stats = failureStats(rows, undefined, roster);
    expect(stats.studentsByFailureCount[0].studentName).toBe('Yara Saleh');
  });
});

describe('failureStats — distribution + totals', () => {
  it('buckets students into 1 / 2 / 3+ failure groups', () => {
    const stats = failureStats(rows);
    const byLabel = Object.fromEntries(
      stats.distribution.map((d) => [d.label, d.count])
    );
    // Yara: 3+ (1), Sara: 2 (1), Omar + Lina: 1 each (2)
    expect(byLabel).toEqual({
      '1 failure': 2,
      '2 failures': 1,
      '3+ failures': 1,
    });
  });

  it('reports total students with at least one failure', () => {
    const stats = failureStats(rows);
    expect(stats.totalStudentsWithFailure).toBe(4);
  });

  it('reports total unique students in the dataset', () => {
    const stats = failureStats(rows);
    // Sara, Omar, Lina, Yara, Noor — 5 distinct.
    expect(stats.totalStudents).toBe(5);
  });

  it('handles an empty grade-book', () => {
    const stats = failureStats([]);
    expect(stats.leaderboard).toEqual([]);
    expect(stats.studentsByFailureCount).toEqual([]);
    expect(stats.totalStudents).toBe(0);
    expect(stats.totalStudentsWithFailure).toBe(0);
  });
});