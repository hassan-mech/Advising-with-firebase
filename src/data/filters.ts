/**
 * Filter helpers for the prereq-map screen.
 *
 * Pure functions only. The UI builds a `MapFilters` object from
 * input state, calls `applyMapFilters` whenever any input changes,
 * and uses the resulting StudentMetrics[] to drive the picker,
 * prev/next, and position indicator. No React, no DataContext.
 *
 * `activeTermEntryLookup` is passed in as a callback so the helper
 * stays pure (no Term shape leaks in) and the UI can supply the
 * `(id) => term.entries.find(...)` closure that depends on the
 * currently-active term.
 */

import type { StudentMetrics, TermEntry } from './types';

export type ProgressFilter = 'all' | 'has-failures' | 'all-passed';

export interface MapFilters {
  /** Free-text on student name + ID. Case-insensitive contains. */
  search: string;
  /** 'all' or an exact major string. */
  major: string;
  /** Boolean AND-joined — both must pass when both are checked. */
  status: {
    plannedConflict: boolean;
    /** Has at least one course on the active term. */
    hasPlans: boolean;
  };
  progress: ProgressFilter;
}

export const DEFAULT_FILTERS: MapFilters = {
  search: '',
  major: 'all',
  status: { plannedConflict: false, hasPlans: false },
  progress: 'all',
};

/** True when the filter object is in its default "no filter" state. */
export function isFiltersEmpty(f: MapFilters): boolean {
  return (
    f.search.trim() === '' &&
    f.major === 'all' &&
    !f.status.plannedConflict &&
    !f.status.hasPlans &&
    f.progress === 'all'
  );
}

/**
 * Distinct majors from the loaded students, sorted alphabetically.
 * Empty string + 'Undeclared' are kept if they appear.
 */
export function getAvailableMajors(students: StudentMetrics[]): string[] {
  const set = new Set<string>();
  for (const s of students) {
    set.add((s.major || 'Undeclared').trim() || 'Undeclared');
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/**
 * Filter the student list. The active student is NOT excluded here
 * — the component decides whether to pin them. The function just
 * applies the filter rules.
 */
export function applyMapFilters(
  students: StudentMetrics[],
  filters: MapFilters,
  activeTermEntryLookup: (studentId: string) => TermEntry | null
): StudentMetrics[] {
  const search = filters.search.trim().toLowerCase();
  const wantMajor = filters.major;
  const wantConflict = filters.status.plannedConflict;
  const wantHasPlans = filters.status.hasPlans;
  const progress = filters.progress;

  return students.filter((s) => {
    // 1) search
    if (search) {
      const hayName = (s.name || '').toLowerCase();
      const hayId = s.studentId.toLowerCase();
      if (!hayName.includes(search) && !hayId.includes(search)) return false;
    }
    // 2) major
    if (wantMajor !== 'all') {
      const studentMajor = (s.major || 'Undeclared').trim() || 'Undeclared';
      if (studentMajor !== wantMajor) return false;
    }
    // 3) status — both checks AND together when both are ticked
    if (wantConflict && !s.hasPlannedConflict) return false;
    if (wantHasPlans) {
      const entry = activeTermEntryLookup(s.studentId);
      if (!entry || entry.courseCodes.length === 0) return false;
    }
    // 4) progress
    if (progress === 'has-failures' && s.failedCourseCodes.length === 0) {
      return false;
    }
    if (progress === 'all-passed' && s.failedCourseCodes.length > 0) {
      return false;
    }
    return true;
  });
}