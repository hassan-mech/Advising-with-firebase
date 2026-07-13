/**
 * Advising queries — v2.
 *
 * Four pure functions answering the advising questions the v1 UI
 * exposes. Each takes the imported rows + catalog (+ optional plans)
 * and returns rows the panel can render directly.
 *
 * Major scoping: as of v2 each catalog course carries per-major
 * `semesters[]`. `catalogStatusForStudent` now skips courses that
 * are not on the student's resolved major's plan so the Blocked
 * and Suggest tabs no longer surface courses the student will
 * never register for.
 */

import type {
  CatalogCourse,
  CourseCatalog,
  GradeRow,
  RosterEntry,
  Term,
} from './types';
import {
  checkCourseState,
  didStudentPassCourse,
  failedSubjects,
  lastTermGpa,
  missingFromList,
  rowsForStudent,
  totalPassedUnits,
} from './metrics';
import { normalizeCourseCodeLoose } from './normalize';
import { catalogMajorsFor, resolveMajorIndex, semesterForMajor } from './majorIndex';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function passingCodes(rows: GradeRow[], studentId: string): Set<string> {
  const set = new Set<string>();
  for (const r of rowsForStudent(rows, studentId)) {
    if (didStudentPassCourse(rows, studentId, r.course)) {
      set.add(normalizeCourseCodeLoose(r.course));
    }
  }
  return set;
}

/**
 * Pre-compute, for every catalog code, how many OTHER catalog courses
 * list it as a prereq. Used by the panel to surface "this failure
 * locks N downstream courses" on failed-prereq rows.
 */
function buildBlockingImpact(catalog: CourseCatalog): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of catalog.courses) {
    const target = normalizeCourseCodeLoose(c.code);
    if (!target) continue;
    for (const prereq of c.prerequisites ?? []) {
      const code = normalizeCourseCodeLoose(prereq);
      if (!code) continue;
      map.set(code, (map.get(code) ?? 0) + 1);
    }
  }
  return map;
}

/**
 * For a student + catalog, every catalog course the student has not
 * yet passed AND that is on the student's major plan (per-major
 * `semesters[]`). The "to-do" list, scoped to what they will
 * realistically register for.
 */
function unpassedCatalogCodes(
  rows: GradeRow[],
  studentId: string,
  catalog: CourseCatalog | null,
  majorIdx: number,
  catalogMajors: string[] | undefined
): CatalogCourse[] {
  if (!catalog) return [];
  const passing = passingCodes(rows, studentId);
  return catalog.courses.filter((c) => {
    const code = normalizeCourseCodeLoose(c.code);
    if (passing.has(code)) return false;
    // When the catalog has per-major semesters, drop out-of-plan rows.
    if (catalogMajors && catalogMajors.length > 0) {
      return semesterForMajor(c, majorIdx, catalogMajors) >= 1;
    }
    return true;
  });
}

/**
 * Status of every unpassed catalog course for a given student. The
 * result feeds both the "blocked next term" query and the "suggest
 * next registration" query.
 */
export type CourseStatus = 'open' | 'blocked' | 'failed-prereq';

export interface CatalogCourseStatus {
  course: CatalogCourse;
  status: CourseStatus;
  /** Codes the student is still missing or has failed. */
  missingPrereqs: string[];
  /**
   * How many other catalog courses list this one as a prereq. A
   * high number means the student's failure of this course is
   * blocking many downstream registrations.
   */
  blockingImpact: number;
}

/**
 * For the v1 advising panel we categorize a course as:
 *   - 'open'           : all prereqs passed AND the course itself is
 *                        not on the failed list — safe to register.
 *   - 'blocked'        : some prereq is missing (never attempted).
 *   - 'failed-prereq'  : at least one prereq was failed, OR this
 *                        course itself was failed before. These need
 *                        adviser attention before registration.
 * Failed prereqs win over plain missing prereqs (more urgent signal).
 */
export function catalogStatusForStudent(
  rows: GradeRow[],
  studentId: string,
  catalog: CourseCatalog | null,
  studentMajor?: string
): CatalogCourseStatus[] {
  if (!catalog) return [];
  const failedSet = new Set(failedSubjects(rows, studentId));
  const catalogMajors = catalogMajorsFor(catalog.courses[0]);
  const { index: majorIdx } = resolveMajorIndex(studentMajor, catalogMajors);
  const blocking = buildBlockingImpact(catalog);

  const statuses: CatalogCourseStatus[] = [];
  for (const c of unpassedCatalogCodes(rows, studentId, catalog, majorIdx, catalogMajors)) {
    const missing = missingFromList(rows, studentId, c.prerequisites);
    let status: CourseStatus;
    if (missing.length === 0) {
      status = 'open';
    } else {
      const failed = missing.some(
        (p) => checkCourseState(rows, studentId, p) === 'failed'
      );
      status = failed ? 'failed-prereq' : 'blocked';
    }
    // A course the student has already failed gets escalated to
    // 'failed-prereq' regardless of prereqs (it's a re-take).
    if (status === 'open' && failedSet.has(normalizeCourseCodeLoose(c.code))) {
      status = 'failed-prereq';
    }
    const code = normalizeCourseCodeLoose(c.code);
    statuses.push({
      course: c,
      status,
      missingPrereqs: missing,
      blockingImpact: blocking.get(code) ?? 0,
    });
  }
  return statuses;
}

// ---------------------------------------------------------------------------
// Public queries
// ---------------------------------------------------------------------------

export interface FailedCourseRow {
  studentId: string;
  studentName: string;
  major: string;
  courseCode: string;
  /** All failed course codes for this student (so the panel shows context). */
  failedCodes: string[];
}

export interface FailedCourseFilter {
  /**
   * Course query — matches a course code (exact + prefix), a catalog
   * title (case-insensitive substring), or both. Typing "calculus"
   * therefore surfaces students who failed any course whose catalog
   * title contains "calculus" (e.g. Calculus I).
   */
  courseCode: string;
  /** Free-text on student name (case-insensitive contains). Empty = no filter. */
  studentName?: string;
  /** Exact-major match. 'all' or empty = no filter. */
  major?: string;
}

/**
 * Back-compat overload: the original one-arg call
 * `studentsWhoFailedCourse(rows, 'MEC011')` keeps working. New
 * callers pass an object form with name + major filters.
 */
export function studentsWhoFailedCourse(
  rows: GradeRow[],
  filter: FailedCourseFilter | string,
  roster?: RosterEntry[],
  catalog?: CourseCatalog | null
): FailedCourseRow[] {
  const f: FailedCourseFilter =
    typeof filter === 'string' ? { courseCode: filter } : filter;
  return studentsWhoFailedCourseImpl(rows, f, roster, catalog);
}

function studentsWhoFailedCourseImpl(
  rows: GradeRow[],
  f: FailedCourseFilter,
  roster?: RosterEntry[],
  catalog?: CourseCatalog | null
): FailedCourseRow[] {
  const target = normalizeCourseCodeLoose(f.courseCode);
  const titleQ = (f.courseCode ?? '').trim().toLowerCase();
  if (!target && !titleQ) return [];

  // Build a lookup from course code → catalog title so we can do a
  // title-substring match alongside the code-prefix match. Without the
  // catalog we can only match by code (back-compat path).
  const titleByCode = new Map<string, string>();
  if (catalog) {
    for (const c of catalog.courses) {
      const code = normalizeCourseCodeLoose(c.code);
      if (code && c.title) titleByCode.set(code, c.title);
    }
  }

  const matchesCode = (code: string): boolean => {
    if (!target) return false;
    const norm = normalizeCourseCodeLoose(code);
    if (!norm) return false;
    return norm === target || norm.startsWith(target);
  };
  const matchesTitle = (code: string): boolean => {
    if (!titleQ) return false;
    const title = titleByCode.get(normalizeCourseCodeLoose(code));
    if (!title) return false;
    return title.toLowerCase().includes(titleQ);
  };
  // A course matches when the query hits EITHER its code or its title
  // (when a title is available). For backwards compatibility, code-only
  // searches keep working even with no catalog imported.
  const matches = (code: string): boolean =>
    matchesCode(code) || matchesTitle(code);

  // Roster wins over grade-book for name + major when present.
  const rosterById = new Map<string, RosterEntry>();
  if (roster) for (const r of roster) rosterById.set(r.studentId, r);

  const nameQ = (f.studentName ?? '').trim().toLowerCase();
  const majorQ = (f.major ?? '').trim();

  const seen = new Set<string>();
  const out: FailedCourseRow[] = [];
  for (const r of rows) {
    if (!matches(r.course)) continue;
    // Filter by the student's actual failed set, not by exact target.
    // Under prefix + title search we need to check whether ANY of the
    // student's failed courses matches the query; otherwise typing
    // "calculus" would miss students who failed a Calculus II course
    // under a code their failed-set row uses.
    const failed = failedSubjects(rows, r.studentId);
    if (!failed.some(matches)) continue;
    if (seen.has(r.studentId)) continue;

    const rosterEntry = rosterById.get(r.studentId);
    const name = rosterEntry?.studentName?.trim() || r.studentName?.trim() || `Student ${r.studentId}`;
    const major = rosterEntry?.major?.trim() || r.major?.trim() || 'Undeclared';

    if (nameQ && !name.toLowerCase().includes(nameQ)) continue;
    if (majorQ && major !== majorQ) continue;

    seen.add(r.studentId);
    out.push({
      studentId: r.studentId,
      studentName: name,
      major,
      courseCode: target || titleQ.toUpperCase(),
      failedCodes: failed,
    });
  }
  return out.sort((a, b) => a.studentId.localeCompare(b.studentId));
}

export interface BlockedStudentRow {
  studentId: string;
  studentName: string;
  major: string;
  gpa: number;
  units: number;
  /** Catalog courses the student cannot yet register for (with their missing prereqs). */
  blocked: Array<{ code: string; title: string; missing: string[] }>;
}

/**
 * Every student with at least one catalog course on their major's
 * plan that they cannot register for (status `blocked` or
 * `failed-prereq`). Sorted by GPA ascending so the most at-risk
 * students surface first.
 *
 * Course scope: only catalog rows with a non-zero `semesters[majorIdx]`
 * for the student's resolved major. Out-of-plan rows are dropped.
 */
export function studentsBlockedFromNextTerm(
  rows: GradeRow[],
  catalog: CourseCatalog | null,
  roster?: RosterEntry[]
): BlockedStudentRow[] {
  if (!catalog || catalog.courses.length === 0) return [];
  const rosterById = new Map<string, RosterEntry>();
  if (roster) for (const r of roster) rosterById.set(r.studentId, r);

  const studentIds = new Set<string>();
  for (const r of rows) studentIds.add(r.studentId);

  const out: BlockedStudentRow[] = [];
  for (const id of studentIds) {
    const rosterEntry = rosterById.get(id);
    const major =
      rosterEntry?.major?.trim() ||
      rows.find((r) => r.studentId === id)?.major?.trim() ||
      'Undeclared';
    const statuses = catalogStatusForStudent(rows, id, catalog, major).filter(
      (s) => s.status !== 'open'
    );
    if (statuses.length === 0) continue;
    const firstRow = rows.find((r) => r.studentId === id);
    out.push({
      studentId: id,
      studentName:
        rosterEntry?.studentName?.trim() ||
        firstRow?.studentName?.trim() ||
        `Student ${id}`,
      major,
      gpa: lastTermGpa(rows, id),
      units: totalPassedUnits(rows, id),
      blocked: statuses.map((s) => ({
        code: s.course.code,
        title: s.course.title,
        missing: s.missingPrereqs,
      })),
    });
  }
  return out.sort((a, b) => {
    if (a.gpa !== b.gpa) return a.gpa - b.gpa;
    return a.studentId.localeCompare(b.studentId);
  });
}

export interface NextRegistrationRow {
  course: CatalogCourse;
  status: CourseStatus;
  missing: string[];
  /** How many other catalog courses list this one as a prereq. */
  blockingImpact: number;
}

/**
 * For the chosen student, return every catalog course they could
 * register for. New sort order (adviser-actionable first):
 *   1. failed-prereq — sorted by blocking impact desc (most-locking
 *      first), then code asc.
 *   2. blocked — by code asc.
 *   3. open — by code asc.
 *
 * Course scope: only catalog rows on the student's major plan
 * (per-major `semesters[]` lookup). Caller passes `studentMajor` so
 * the resolution uses the right index.
 */
export function suggestNextRegistration(
  rows: GradeRow[],
  catalog: CourseCatalog | null,
  studentId: string,
  studentMajor?: string
): NextRegistrationRow[] {
  if (!catalog) return [];
  const statuses = catalogStatusForStudent(rows, studentId, catalog, studentMajor);
  return statuses
    .map((s) => ({
      course: s.course,
      status: s.status,
      missing: s.missingPrereqs,
      blockingImpact: s.blockingImpact,
    }))
    .sort((a, b) => {
      // Group order: failed-prereq → blocked → open.
      const group = (s: CourseStatus): number =>
        s === 'failed-prereq' ? 0 : s === 'blocked' ? 1 : 2;
      const ga = group(a.status);
      const gb = group(b.status);
      if (ga !== gb) return ga - gb;
      // Within failed-prereq, surface the most-blocking first.
      if (a.status === 'failed-prereq' && a.blockingImpact !== b.blockingImpact) {
        return b.blockingImpact - a.blockingImpact;
      }
      return a.course.code.localeCompare(b.course.code);
    });
}

// ---------------------------------------------------------------------------
// Downstream lookup — used by the Failure Stats leaderboard to render
// "this failed course blocks these downstream courses" under each row.
// ---------------------------------------------------------------------------

export interface DownstreamCourse {
  /** Normalized course code. */
  courseCode: string;
  /** Catalog title for the downstream course. */
  courseTitle: string;
  /**
   * Semester number on the chosen major's plan, or 0 when not on the
   * plan. Caller passes the major index it already resolved so we don't
   * need to take a major string here.
   */
  semester: number;
  /** Credits, pulled from the catalog row. */
  credits: number;
}

/**
 * Returns every catalog course whose `prerequisites[]` contains the
 * given (normalized) code, sorted by code ascending. The semester is
 * resolved for the caller's chosen major so the UI can render "sem N"
 * chips next to each downstream course.
 *
 * `catalogMajors` is the catalog's `majors[]` column (identical on
 * every wide row). It is forwarded into `semesterForMajor` so courses
 * whose own `majors[]`/`semesters[]` are shorter (single-major rows
 * like "MEC242 — CNC Machine") still resolve to the right semester.
 *
 * Returns [] when no catalog is loaded or no row depends on the code.
 */
export function downstreamCoursesFor(
  catalog: CourseCatalog | null,
  courseCode: string,
  majorIdx: number,
  catalogMajors?: string[]
): DownstreamCourse[] {
  if (!catalog) return [];
  const target = normalizeCourseCodeLoose(courseCode);
  if (!target) return [];
  const out: DownstreamCourse[] = [];
  for (const c of catalog.courses) {
    const code = normalizeCourseCodeLoose(c.code);
    if (!code || code === target) continue;
    const prereqs = (c.prerequisites ?? []).map((p) => normalizeCourseCodeLoose(p));
    if (!prereqs.includes(target)) continue;
    out.push({
      courseCode: code,
      courseTitle: c.title || '',
      semester:
        majorIdx >= 0
          ? semesterForMajor(c, majorIdx, catalogMajors)
          : 0,
      credits: typeof c.credits === 'number' ? c.credits : 0,
    });
  }
  return out.sort((a, b) => a.courseCode.localeCompare(b.courseCode));
}

export interface PlannedConflictRow {
  studentId: string;
  studentName: string;
  major: string;
  /** Conflicts: each is a planned course that the student has previously failed. */
  conflicts: Array<{ termName: string; courseCode: string }>;
}

/**
 * Every student with at least one term entry that includes a course
 * they have previously failed. Terms are optional; passing an empty
 * array yields zero results, and the UI renders a "no plans yet"
 * hint for that case. The same student may show the same courseCode
 * once per term where the conflict appears (we keep all of them in
 * the conflict list so the adviser sees the full picture).
 */
export function studentsWithPlannedConflict(
  rows: GradeRow[],
  terms: Term[]
): PlannedConflictRow[] {
  if (terms.length === 0) return [];

  const byStudent = new Map<string, PlannedConflictRow>();
  for (const term of terms) {
    for (const plan of term.entries) {
      const failed = failedSubjects(rows, plan.studentId);
      if (failed.length === 0) continue;
      const failedSet = new Set(failed.map((c) => normalizeCourseCodeLoose(c)));
      for (const code of plan.courseCodes) {
        if (!failedSet.has(normalizeCourseCodeLoose(code))) continue;
        let entry = byStudent.get(plan.studentId);
        if (!entry) {
          const firstRow = rows.find((r) => r.studentId === plan.studentId);
          entry = {
            studentId: plan.studentId,
            studentName: firstRow?.studentName?.trim() || `Student ${plan.studentId}`,
            major: firstRow?.major?.trim() || 'Undeclared',
            conflicts: [],
          };
          byStudent.set(plan.studentId, entry);
        }
        entry.conflicts.push({ termName: term.name, courseCode: code });
      }
    }
  }

  return Array.from(byStudent.values()).sort((a, b) =>
    a.studentId.localeCompare(b.studentId)
  );
}

// ---------------------------------------------------------------------------
// Failure Stats — leaderboard + distribution
// ---------------------------------------------------------------------------

export interface CourseFailureRow {
  /** Normalized course code (e.g. "MEC011"). */
  courseCode: string;
  /** Catalog title when present, else ''. */
  courseTitle: string;
  /** Distinct student count whose failed-set contains this course. */
  count: number;
  /** Distinct student IDs, sorted alphabetically. The UI renders the
   * full list vertically so the adviser can read every name. */
  studentIds: string[];
}

export interface FailureStudentBucket {
  /** "1 failure", "2 failures", "3+ failures" — UI-ready label. */
  label: string;
  /** Integer count of students that fall into this bucket. */
  count: number;
}

export interface FailureStats {
  /** Every distinct failed course, sorted by count desc then code asc. */
  leaderboard: CourseFailureRow[];
  /** Every student who failed at least one course, with their failure count. */
  studentsByFailureCount: Array<{ studentId: string; studentName: string; count: number }>;
  /** Distribution buckets (1 / 2 / 3+) for quick summary. */
  distribution: FailureStudentBucket[];
  /** Total unique students with at least one failure. */
  totalStudentsWithFailure: number;
  /** Total distinct students in the dataset. */
  totalStudents: number;
}

/**
 * Aggregate failure stats across the whole grade-book.
 *
 * - `leaderboard`: every course code whose `failedSubjects` set has
 *   at least one student — sorted by count desc (most-failed first),
 *   code asc as tie-break. Catalog titles are resolved when the
 *   caller passes a catalog so the UI can show `MEC011 — Intro to
 *   Mechatronics` without re-looking it up.
 * - `studentsByFailureCount`: every student who failed at least one
 *   course, paired with their failure count, sorted by count desc.
 * - `distribution`: bucketed into 1 / 2 / 3+ for a quick summary.
 *
 * Pure — given the same inputs returns the same output.
 */
export function failureStats(
  rows: GradeRow[],
  catalog?: CourseCatalog | null,
  roster?: RosterEntry[]
): FailureStats {
  // Build name + major maps so the UI can show "Sara Khan" instead
  // of just "S1" without re-iterating the roster.
  const rosterById = new Map<string, RosterEntry>();
  if (roster) for (const r of roster) rosterById.set(r.studentId, r);

  const titleByCode = new Map<string, string>();
  if (catalog) {
    for (const c of catalog.courses) {
      const code = normalizeCourseCodeLoose(c.code);
      if (code && c.title) titleByCode.set(code, c.title);
    }
  }

  // Per-student failure sets — collected once so we don't re-iterate
  // rows three times.
  const failedByStudent = new Map<string, string[]>();
  const seenStudents = new Set<string>();
  for (const r of rows) {
    seenStudents.add(r.studentId);
    let list = failedByStudent.get(r.studentId);
    if (!list) {
      list = failedSubjects(rows, r.studentId);
      failedByStudent.set(r.studentId, list);
    }
  }

  // Leaderboard: bucket failures by course code, count distinct students.
  const countsByCourse = new Map<string, Set<string>>();
  for (const [studentId, failed] of failedByStudent) {
    for (const code of failed) {
      let set = countsByCourse.get(code);
      if (!set) {
        set = new Set();
        countsByCourse.set(code, set);
      }
      set.add(studentId);
    }
  }
  const leaderboard: CourseFailureRow[] = Array.from(countsByCourse.entries())
    .map(([courseCode, students]) => ({
      courseCode,
      courseTitle: titleByCode.get(courseCode) || '',
      count: students.size,
      studentIds: Array.from(students).sort(),
    }))
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return a.courseCode.localeCompare(b.courseCode);
    });

  // Per-student totals.
  const studentsByFailureCount = Array.from(failedByStudent.entries())
    .map(([studentId, failed]) => ({
      studentId,
      studentName:
        rosterById.get(studentId)?.studentName?.trim() ||
        rows.find((r) => r.studentId === studentId)?.studentName?.trim() ||
        `Student ${studentId}`,
      count: failed.length,
    }))
    .filter((s) => s.count > 0)
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return a.studentId.localeCompare(b.studentId);
    });

  // Distribution buckets — 1, 2, 3+.
  let c1 = 0;
  let c2 = 0;
  let c3plus = 0;
  for (const s of studentsByFailureCount) {
    if (s.count === 1) c1++;
    else if (s.count === 2) c2++;
    else c3plus++;
  }
  const distribution: FailureStudentBucket[] = [
    { label: '1 failure', count: c1 },
    { label: '2 failures', count: c2 },
    { label: '3+ failures', count: c3plus },
  ];

  const totalStudentsWithFailure = studentsByFailureCount.length;

  return {
    leaderboard,
    studentsByFailureCount,
    distribution,
    totalStudentsWithFailure,
    totalStudents: seenStudents.size,
  };
}

// ---------------------------------------------------------------------------
// Re-exports used by the UI
// ---------------------------------------------------------------------------

export { checkCourseState, passingCodes };