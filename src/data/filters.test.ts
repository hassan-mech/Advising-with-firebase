/**
 * Unit tests for the prereq-map filter helpers.
 *
 * Every helper here is pure — the fixture covers all four filter
 * axes (search, major, status, progress) plus combinations and the
 * "empty defaults" contract.
 */

import { describe, it, expect } from 'vitest';
import type { StudentMetrics, TermEntry } from './types';
import {
  applyMapFilters,
  DEFAULT_FILTERS,
  getAvailableMajors,
  isFiltersEmpty,
  type MapFilters,
} from './filters';

function m(partial: Partial<StudentMetrics>): StudentMetrics {
  return {
    studentId: 'S1',
    name: 'Default Name',
    major: 'Civil Engineering',
    gpa: 0,
    totalUnits: 0,
    totalFailedUnits: 0,
    failedCourseCodes: [],
    missingPrereqsForNextTerm: [],
    hasPlannedConflict: false,
    currentSemester: 1,
    level: 'Level 0',
    ...partial,
  };
}

const students: StudentMetrics[] = [
  m({ studentId: 'S1', name: 'Hassan Ali', major: 'Mechatronics Engineering', failedCourseCodes: ['MAT101'], hasPlannedConflict: true }),
  m({ studentId: 'S2', name: 'Sara Khan', major: 'Civil Engineering' }),
  m({ studentId: 'S3', name: 'Omar Yousif', major: 'Civil Engineering', failedCourseCodes: ['PHY111'] }),
  m({ studentId: 'S4', name: 'Lina Adel', major: 'Aerospace Engineering' }),
  m({ studentId: 'S5', name: '', major: '', failedCourseCodes: [] }), // undeclared, no name
];

/** No active-term entries for any student — empty lookup. */
const noPlans = (_id: string): TermEntry | null => null;
/** Build a lookup from a fixture. */
function plansOf(map: Record<string, string[]>): (id: string) => TermEntry | null {
  return (id) => {
    const codes = map[id];
    return codes ? { studentId: id, courseCodes: codes } : null;
  };
}

describe('isFiltersEmpty', () => {
  it('returns true for DEFAULT_FILTERS', () => {
    expect(isFiltersEmpty(DEFAULT_FILTERS)).toBe(true);
  });

  it('returns false the moment any axis is set', () => {
    expect(isFiltersEmpty({ ...DEFAULT_FILTERS, search: 'h' })).toBe(false);
    expect(isFiltersEmpty({ ...DEFAULT_FILTERS, major: 'Civil Engineering' })).toBe(false);
    expect(
      isFiltersEmpty({ ...DEFAULT_FILTERS, status: { plannedConflict: true, hasPlans: false } })
    ).toBe(false);
    expect(isFiltersEmpty({ ...DEFAULT_FILTERS, progress: 'has-failures' })).toBe(false);
  });
});

describe('getAvailableMajors', () => {
  it('returns sorted distinct majors with a fallback for blank ones', () => {
    expect(getAvailableMajors(students)).toEqual([
      'Aerospace Engineering',
      'Civil Engineering',
      'Mechatronics Engineering',
      'Undeclared',
    ]);
  });

  it('returns [] when given no students', () => {
    expect(getAvailableMajors([])).toEqual([]);
  });
});

describe('applyMapFilters — search axis', () => {
  it('matches by partial name (case-insensitive)', () => {
    const out = applyMapFilters(students, { ...DEFAULT_FILTERS, search: 'has' }, noPlans);
    expect(out.map((s) => s.studentId)).toEqual(['S1']);
  });

  it('matches by student id substring', () => {
    const out = applyMapFilters(students, { ...DEFAULT_FILTERS, search: 's3' }, noPlans);
    expect(out.map((s) => s.studentId)).toEqual(['S3']);
  });

  it('returns [] when nothing matches', () => {
    expect(
      applyMapFilters(students, { ...DEFAULT_FILTERS, search: 'zzz' }, noPlans)
    ).toEqual([]);
  });

  it('treats whitespace-only search as no filter', () => {
    expect(
      applyMapFilters(students, { ...DEFAULT_FILTERS, search: '   ' }, noPlans)
    ).toHaveLength(students.length);
  });
});

describe('applyMapFilters — major axis', () => {
  it('matches exactly one major', () => {
    const out = applyMapFilters(
      students,
      { ...DEFAULT_FILTERS, major: 'Civil Engineering' },
      noPlans
    );
    expect(out.map((s) => s.studentId).sort()).toEqual(['S2', 'S3']);
  });

  it('falls back to "Undeclared" for blank majors', () => {
    const out = applyMapFilters(
      students,
      { ...DEFAULT_FILTERS, major: 'Undeclared' },
      noPlans
    );
    expect(out.map((s) => s.studentId)).toEqual(['S5']);
  });
});

describe('applyMapFilters — status axis', () => {
  it('plannedConflict keeps only flagged students', () => {
    const out = applyMapFilters(
      students,
      { ...DEFAULT_FILTERS, status: { plannedConflict: true, hasPlans: false } },
      noPlans
    );
    expect(out.map((s) => s.studentId)).toEqual(['S1']);
  });

  it('hasPlans keeps only students with at least one course on the active term', () => {
    const lookup = plansOf({ S2: ['CIV101'], S4: ['AER101', 'AER102'] });
    const out = applyMapFilters(
      students,
      { ...DEFAULT_FILTERS, status: { plannedConflict: false, hasPlans: true } },
      lookup
    );
    expect(out.map((s) => s.studentId).sort()).toEqual(['S2', 'S4']);
  });

  it('AND-joins both status flags when both are ticked', () => {
    const lookup = plansOf({ S1: ['MEC011'] }); // S1 also has a planned conflict
    const out = applyMapFilters(
      students,
      { ...DEFAULT_FILTERS, status: { plannedConflict: true, hasPlans: true } },
      lookup
    );
    expect(out.map((s) => s.studentId)).toEqual(['S1']);
  });
});

describe('applyMapFilters — progress axis', () => {
  it('has-failures keeps only students with at least one failure', () => {
    const out = applyMapFilters(
      students,
      { ...DEFAULT_FILTERS, progress: 'has-failures' },
      noPlans
    );
    expect(out.map((s) => s.studentId).sort()).toEqual(['S1', 'S3']);
  });

  it('all-passed keeps only students with zero failures', () => {
    const out = applyMapFilters(
      students,
      { ...DEFAULT_FILTERS, progress: 'all-passed' },
      noPlans
    );
    expect(out.map((s) => s.studentId).sort()).toEqual(['S2', 'S4', 'S5']);
  });
});

describe('applyMapFilters — combinations', () => {
  it('search + major + status + progress all combine with AND', () => {
    const lookup = plansOf({ S1: ['MEC011'], S3: [] });
    const f: MapFilters = {
      search: 'o',       // matches Hassan (S1) and Omar (S3)
      major: 'Civil Engineering', // drops S1
      status: { plannedConflict: true, hasPlans: true }, // S3 has no plans
      progress: 'has-failures', // S3 has failures but no plans
    };
    // After all four: only a student matching EVERY axis passes.
    // None in the fixture match, so expect [].
    expect(applyMapFilters(students, f, lookup)).toEqual([]);
  });

  it('returns the full list when all defaults are set', () => {
    expect(applyMapFilters(students, DEFAULT_FILTERS, noPlans)).toHaveLength(students.length);
  });
});