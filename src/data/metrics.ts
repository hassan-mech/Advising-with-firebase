/**
 * Python-equivalent metrics for the v2 advising app.
 *
 * Every function is pure: given the row list and a student id it
 * returns the same thing on every call. Names mirror the Python
 * pipeline so the user's mental model maps 1:1:
 *
 *   rowsForStudent       -> get_student_info
 *   lastTermGpa          -> get_cumaltive_gpa
 *   totalPassedUnits     -> get_total_units
 *   failedSubjects       -> get_failed_subject
 *   checkCourseState     -> check_course_state
 *   checkCoursesState    -> check_courses_state
 *   missingFromList      -> get_course_failed_from_list
 *
 * Pass/fail rule (matches the Python pipeline):
 *   - A course is PASSED iff at least one attempt's grade does NOT
 *     start with one of the failing prefixes.
 *   - A course is FAILED iff it has attempts and ALL of them start
 *     with one of those prefixes.
 *   - `U` counts as failing.
 *   - Credits earned sum only PASSED-course credits (matches the
 *     credit-hours fix from the v1 codebase).
 */

import type { GradeRow, RosterEntry } from './types';
import { normalizeCourseCodeLoose } from './normalize';

const FAILING_PREFIXES = ['F', 'FL', 'FD', 'FA'] as const;

/** True when the grade letter starts with one of the failing prefixes. */
export function isFailingGrade(grade: string): boolean {
  if (!grade) return false;
  const normalized = grade.trim().toUpperCase();
  return FAILING_PREFIXES.some((p) => normalized.startsWith(p));
}

/**
 * Letter grade → 4.0 scale grade-point value.
 *
 * Standard scale (matches the demo fixtures and the Python
 * pipeline's convention):
 *
 *     A   → 4.0     A-  → 3.7
 *     B+  → 3.3     B   → 3.0    B-  → 2.7
 *     C+  → 2.3     C   → 2.0    C-  → 1.7
 *     D+  → 1.3     D   → 1.0
 *     F   → 0.0
 *
 * Returns `null` for anything we can't recognise — non-letter
 * grades (`U`, `FL`, `FD`, `FA`, `P`, `W`, etc.) and empty input.
 * Callers must check the null case and decide what to render (we
 * don't want a stray `0.0` masquerading as a real grade-point for
 * an unknown letter).
 *
 * Letter grades are normalised before lookup: trim + uppercase, so
 * `b+` and ` B+ ` both resolve to 3.3.
 */
export function letterToPoints(grade: string): number | null {
  if (!grade) return null;
  const g = grade.trim().toUpperCase();
  switch (g) {
    case 'A':  return 4.0;
    case 'A-': return 3.7;
    case 'B+': return 3.3;
    case 'B':  return 3.0;
    case 'B-': return 2.7;
    case 'C+': return 2.3;
    case 'C':  return 2.0;
    case 'C-': return 1.7;
    case 'D+': return 1.3;
    case 'D':  return 1.0;
    case 'F':  return 0.0;
    default:   return null;
  }
}

// ---------------------------------------------------------------------------
// Per-rows lookup index — perf-critical.
//
// Every helper below used to do `rows.filter(...)` PER CALL — an
// O(rows) scan. buildPrereqMap calls these for every catalog course
// (often more than once per course), and metricsByStudent calls them
// for every student in the roster. With large datasets this made a
// single course-card click cost O(catalogCourses × rows) or worse.
//
// The key insight: clicking a card only changes `state.terms`, never
// `state.rows` — so the same `rows` array reference is reused across
// clicks. We cache the index in a WeakMap keyed on that reference, so
// it's built once per actual grade-book import/edit and reused for
// every click in between. Each lookup becomes an O(1) Map access.
// ---------------------------------------------------------------------------

interface RowsIndex {
  /** Every row for a student, in original source order. */
  byStudent: Map<string, GradeRow[]>;
  /** Every row for a (student, normalized course code) pair. */
  byStudentCourse: Map<string, Map<string, GradeRow[]>>;
}

const EMPTY_ROWS: GradeRow[] = [];
const rowsIndexCache = new WeakMap<GradeRow[], RowsIndex>();

function getRowsIndex(rows: GradeRow[]): RowsIndex {
  const cached = rowsIndexCache.get(rows);
  if (cached) return cached;

  const byStudent = new Map<string, GradeRow[]>();
  const byStudentCourse = new Map<string, Map<string, GradeRow[]>>();

  for (const r of rows) {
    let studentRows = byStudent.get(r.studentId);
    if (!studentRows) {
      studentRows = [];
      byStudent.set(r.studentId, studentRows);
    }
    studentRows.push(r);

    let courseMap = byStudentCourse.get(r.studentId);
    if (!courseMap) {
      courseMap = new Map();
      byStudentCourse.set(r.studentId, courseMap);
    }
    const code = normalizeCourseCodeLoose(r.course);
    let attempts = courseMap.get(code);
    if (!attempts) {
      attempts = [];
      courseMap.set(code, attempts);
    }
    attempts.push(r);
  }

  const index: RowsIndex = { byStudent, byStudentCourse };
  rowsIndexCache.set(rows, index);
  return index;
}

/**
 * Every attempt a student made at a course, in source order. O(1)
 * after the first call for a given `rows` reference — replaces what
 * used to be a fresh `rows.filter(...)` scan on every call. Exported
 * so `prereqMap.ts`'s `gradeFor` can use the same index instead of
 * doing its own raw filter.
 */
export function attemptsForCourse(
  rows: GradeRow[],
  studentId: string,
  courseCode: string
): GradeRow[] {
  const code = normalizeCourseCodeLoose(courseCode);
  if (!code) return EMPTY_ROWS;
  return getRowsIndex(rows).byStudentCourse.get(studentId)?.get(code) ?? EMPTY_ROWS;
}

/** True when any attempt of this course by this student passed. */
/** True when any attempt of this course by this student passed. */
export function didStudentPassCourse(rows: GradeRow[], studentId: string, courseCode: string): boolean {
  const attempts = attemptsForCourse(rows, studentId, courseCode);
  if (attempts.length === 0) return false;
  return attempts.some((r) => !isFailingGrade(r.grade));
}

/** True when the student has at least one attempt of the course AND all attempts failed. */
export function didStudentFailCourse(rows: GradeRow[], studentId: string, courseCode: string): boolean {
  const attempts = attemptsForCourse(rows, studentId, courseCode);
  if (attempts.length === 0) return false;
  return attempts.every((r) => isFailingGrade(r.grade));
}

// ---------------------------------------------------------------------------
// Python mirror
// ---------------------------------------------------------------------------

/** Equivalent to Python's `get_student_info(id)`. */
export function rowsForStudent(rows: GradeRow[], studentId: string): GradeRow[] {
  return getRowsIndex(rows).byStudent.get(studentId) ?? EMPTY_ROWS;
}

/**
 * Equivalent to Python's `get_cumaltive_gpa(id)`. Returns the
 * cumulative_gpa reported on the LATEST TERM this student has rows
 * in — and only that term. We never fall back to an earlier term;
 * if the latest term's rows have no numeric cumulativeGpa cell
 * (e.g. the term is still in progress) we return 0.
 *
 * Why "strictly the latest term":
 * The Excel grade-book typically fills the cumulativeGpa column only
 * on the LAST row of each completed term. In-progress terms (or
 * terms that haven't been computed yet) leave the column blank.
 * Using the "latest term with a value" rule meant an in-progress
 * term would silently inherit the previous term's GPA — which is
 * misleading (the student's GPA could have changed mid-term). The
 * strict rule forces 0 in that case so the displayed GPA matches
 * exactly what the spreadsheet says for the most recent term.
 *
 * Within the latest term, when multiple rows each carry a numeric
 * cumulativeGpa we pick the LAST one we encounter (mirrors the
 * Excel convention where the cumulative figure sits on the bottom
 * row of the term — i.e. after the last attempt of that term).
 *
 * "Last term" is computed by parsing the term string into
 * `(academicYear, position)` and sorting chronologically. Fall of
 * year Y starts academic year Y; Spring/Summer of year Y belong to
 * academic year Y-1. Within an AY the position is Fall=0, Spring=1,
 * Summer=2 (Fall is the earliest term of the AY). This matches the
 * user's grade-book, where the AY-2025-2026 column block is the
 * most recent set of rows.
 */
export function lastTermGpa(rows: GradeRow[], studentId: string): number {
  const own = rowsForStudent(rows, studentId);
  if (own.length === 0) return 0;

  const termSet = new Set<string>();
  for (const r of own) {
    if (r.term) termSet.add(r.term);
  }
  if (termSet.size === 0) return 0;

  const terms = Array.from(termSet).sort(compareTerms);
  const latestTerm = terms[terms.length - 1];

  // Within the latest term, walk rows in source order and pick the
  // LAST numeric cumulativeGpa we encounter. Mirrors the Excel
  // convention where the cumulative figure sits on the bottom row
  // of the term block.
  let result = 0;
  for (const r of own) {
    if (r.term !== latestTerm) continue;
    if (typeof r.cumulativeGpa === 'number' && Number.isFinite(r.cumulativeGpa)) {
      result = r.cumulativeGpa;
    }
  }
  return result;
}

export function compareTerms(a: string, b: string): number {
  const aParts = parseTerm(a);
  const bParts = parseTerm(b);
  if (aParts && bParts) {
    if (aParts.academicYear !== bParts.academicYear) {
      return aParts.academicYear - bParts.academicYear; // ascending AY
    }
    return aParts.position - bParts.position;           // ascending within AY
  }
  if (aParts && !bParts) return 1;
  if (!aParts && bParts) return -1;
  return a.localeCompare(b);
}

/**
 * Season order *within a single academic year* (ascending = oldest first).
 *
 * AY grouping rule: Fall of year Y starts a new academic year Y.
 * Spring and Summer of year Y belong to the *prior* AY (Y-1). So
 * chronologically:
 *
 *     Fall 2024  →  Spring 2025  →  Summer 2025  →  Fall 2025
 *     -- AY 2024-2025 ----------  ----  ----    -- AY 2025-2026 --
 *
 * Within an AY, Fall is the earliest position (it's the term the
 * student starts in Sep/Oct). This matches how the user's grade-book
 * fills the cumulative-GPA column.
 */
const AY_POSITION: Record<string, number> = {
  fall: 0,
  autumn: 0,
  spring: 1,
  summer: 2,
};
/**
 * Parse a term string into (academicYear, position). Accepts both
 * single-year ("Fall 2024", "Spring 2025") and academic-year ("Spring
 * 2025-2026") formats — the second form spans two calendar years (the
 * user's grade-book uses this for the current term, e.g. "Spring
 * 2025-2026" for the term running Jan–Jun 2026).
 *
 * Anchoring rule for the academic-year form: the term sits in the
 * START year of the range, so we anchor on `startYear`. That way
 * "Spring 2025-2026" parses as (academicYear=2025, position=SPRING=1)
 * — so it sorts AFTER "Fall 2025" (academicYear=2025, position=FALL=0)
 * AND AFTER "Spring 2025" (academicYear=2024, position=SPRING=1) —
 * matching the real-world chronology (Spring 2026 follows Fall 2025).
 *
 * Guard: we only accept a true academic year, i.e. `endYear ===
 * startYear + 1`. A range like "Fall 2024-2027" is malformed and
 * falls through to the single-year parse (which then rejects it).
 *
 * The matching is anchored at the start, so leading/trailing spaces
 * are tolerated and any text after the year (e.g. parentheses or a
 * label) is ignored.
 */
function parseTerm(term: string): { academicYear: number; position: number } | null {
  const normalized = String(term ?? '').trim().toLowerCase();

  // Allow optional words between season and year, e.g. "Spring Term 2025-2026"
  const range = normalized.match(/^(spring|summer|fall|autumn)\D+(\d{4})\s*-\s*(\d{4})/);
  if (range) {
    const position = AY_POSITION[range[1]];
    const startYear = parseInt(range[2], 10);
    const endYear = parseInt(range[3], 10);
    if (
      position !== undefined &&
      Number.isFinite(startYear) &&
      Number.isFinite(endYear) &&
      endYear === startYear + 1
    ) {
      return { academicYear: startYear, position };
    }
  }

  const single = normalized.match(/^(spring|summer|fall|autumn)\D+(\d{4})/);
  if (!single) return null;
  const position = AY_POSITION[single[1]];
  const year = parseInt(single[2], 10);
  if (position === undefined || !Number.isFinite(year)) return null;
  // Fall of year Y is the FIRST term of AY Y. Spring/Summer of year
  // Y sit in the PRIOR AY (Y-1).
  const academicYear = position === 0 ? year : year - 1;
  return { academicYear, position };
}

/**
 * Equivalent to Python's `get_total_units(id)`. Sum of units across
 * UNIQUE passed course codes (failed courses contribute 0).
 */
export function totalPassedUnits(rows: GradeRow[], studentId: string): number {
  const own = rowsForStudent(rows, studentId);
  const passedByCode = new Map<string, number>();
  for (const r of own) {
    const code = normalizeCourseCodeLoose(r.course);
    if (!didStudentPassCourse(rows, studentId, code)) continue;
    // First-seen attempt's units wins (credits do not change across retakes).
    if (!passedByCode.has(code)) passedByCode.set(code, r.units);
  }
  let total = 0;
  for (const units of passedByCode.values()) total += units;
  return total;
}

/**
 * Sum of credits across every unique FAILED course code. Mirrors
 * `totalPassedUnits` in shape (first-seen units wins, retakes don't
 * add up). The companion of `totalUnits` — both go on
 * `StudentMetrics` so the UI and the export can surface passed vs
 * failed credits side by side.
 */
export function totalFailedUnits(rows: GradeRow[], studentId: string): number {
  const own = rowsForStudent(rows, studentId);
  const failedByCode = new Map<string, number>();
  for (const r of own) {
    const code = normalizeCourseCodeLoose(r.course);
    if (!didStudentFailCourse(rows, studentId, code)) continue;
    if (!failedByCode.has(code)) failedByCode.set(code, r.units);
  }
  let total = 0;
  for (const units of failedByCode.values()) total += units;
  return total;
}

/**
 * Level derived from `totalPassedUnits` and the student's last-term
 * GPA, mirroring the user's Excel formula:
 *
 *   IF(K<33,"Level 0",
 *    IF(K<66,"Level 1",
 *     IF(K<99,"Level 2",
 *      IF(K<132,"Level 3",
 *       IF(K<165,"Level 4",
 *        IF(K=165, IF(GPA>=2,"Graduated","ERROR"),
 *         "ERROR"))))))
 *
 * - `K`  = total passed units.
 * - `GPA` = cumulative GPA on the student's latest term.
 *
 * `ERROR` is returned for two cases: total passed units > 165 (the
 * plan has more credits than the degree allows) AND total passed
 * units === 165 but GPA < 2 (the credits are there but the student
 * is on academic warning).
 */
export function studentLevel(
  rows: GradeRow[],
  studentId: string
): import('./types').StudentLevel {
  const passed = totalPassedUnits(rows, studentId);
  const gpa = lastTermGpa(rows, studentId);
  if (passed < 33) return 'Level 0';
  if (passed < 66) return 'Level 1';
  if (passed < 99) return 'Level 2';
  if (passed < 132) return 'Level 3';
  if (passed < 165) return 'Level 4';
  if (passed === 165) return gpa >= 2 ? 'Graduated' : 'ERROR';
  return 'ERROR';
}

/**
 * Expected GPA after a planned term lands.
 *
 * Inputs:
 *   - `currentGpa`           — the student's current cumulative GPA
 *                              (the `student.gpa` field).
 *   - `totalPassedUnits`     — passed credits that contributed to the
 *                              current GPA (failed courses do NOT earn
 *                              credit, so they're not in this number).
 *   - `totalFailedUnits`     — credits across every unique FAILED
 *                              course code. Used to grow the
 *                              denominator so a retake (repeated) and
 *                              a re-take-to-improve (enhancing) both
 *                              keep the credit-load the student has
 *                              already attempted in the denominator —
 *                              matches the user's Excel formula
 *                              `gpa × totalHours + contributions`.
 *   - `plan`                 — the courses the student has put on
 *                              the active term, with credit hours and
 *                              a classification (new / enhancing /
 *                              repeated). We use the classification to
 *                              pick the right contribution rule.
 *
 * Rules (matches the user's specification):
 *
 *   The denominator is `totalPassedUnits + totalFailedUnits` — the
 *   total credit load the student has attempted so far. The
 *   numerator starts at `currentGpa × that total`.
 *
 *   - NEW course (never attempted):
 *       credits are ADDED to the denominator (new attempt hours).
 *       numerator gets +4.0 × credits (max possible).
 *
 *   - ENHANCING course (previously passed, retake to upgrade):
 *       hours are NOT added — they're already in the denominator.
 *       The previous passing attempt contributed
 *       `currentPoints × credits` to the running total. The new
 *       attempt could contribute up to 4.0 × credits. Delta =
 *       (4.0 − currentPoints) × credits.
 *
 *   - REPEATED course (previously failed, retake):
 *       hours are NOT added — the failed attempts already sit in
 *       the denominator via `totalFailedUnits`.
 *       New attempt is capped at 3.3 × credits (a retake maxes at
 *       B+, not A — the user explicitly asked for this ceiling).
 *
 * Returns the projected GPA rounded to **3 decimal places**, or
 * `null` when the denominator is 0 (no hours at all AND no new
 * courses planned) so the UI can render "—" instead of NaN.
 *
 * Why round to 3 decimals: the display contract is "always show
 * 3 decimals", and rounding the final result to the same precision
 * keeps the math consistent with the on-screen value across every
 * component (PlanStats, PlanStatsGrid, the page header summary).
 * Intermediate arithmetic uses exact double-precision floats — we
 * only round at the boundary so repeated calls with the same
 * inputs return the same number.
 */
export interface PlannedCourseInput {
  credits: number;
  classification: 'new' | 'enhancing' | 'repeated';
  /**
   * For "enhancing" courses only — the point value of the
   * existing passing attempt, used to compute the delta. Ignored
   * for new and repeated courses.
   */
  currentPoints?: number | null;
}

export function computeExpectedGpa(
  currentGpa: number,
  totalPassedUnits: number,
  totalFailedUnits: number,
  plan: PlannedCourseInput[]
): number | null {
  // Initial denominator = passed hours + failed hours (the total
  // credit load the student has attempted). Matches the user's
  // formula: `gpa × totalHours + Σ contributions / totalHours`.
  let points = currentGpa * (totalPassedUnits + totalFailedUnits);
  let hours = totalPassedUnits + totalFailedUnits;

  for (const c of plan) {
    const credits = c.credits || 0;
    if (credits <= 0) continue;
    if (c.classification === 'new') {
      points += 4.0 * credits;
      hours += credits;
    } else if (c.classification === 'enhancing') {
      // Cap the delta at 0 if the previous points were somehow
      // higher than 4.0 (defensive only — letterToPoints caps at 4).
      const prev = c.currentPoints ?? 0;
      const delta = Math.max(0, 4.0 - prev);
      points += delta * credits;
      // hours unchanged — already counted in the denominator.
    } else if (c.classification === 'repeated') {
      // The failed attempt's hours are already in the denominator
      // (via totalFailedUnits), so we keep hours untouched. The
      // failed attempt contributed 0 points; the retry is capped
      // at B+ (3.3) per spec.
      points += 3.3 * credits;
      // hours unchanged.
    }
  }

  if (hours <= 0) return null;
  // Round to 3 decimals so the result matches the on-screen /
  // printed display (toFixed(3)) byte-for-byte. Using a tiny
  // epsilon (1e-9) avoids the classic "5.005 rounds to 5.004"
  // floating-point surprise.
  return Math.round((points / hours) * 1000 + 1e-9) / 1000;
}

/**
 * Equivalent to Python's `get_failed_subject(id)`. Course codes the
 * student has attempted and failed (every attempt starts with one of
 * the failing prefixes).
 */
export function failedSubjects(rows: GradeRow[], studentId: string): string[] {
  const own = rowsForStudent(rows, studentId);
  const codes = new Set<string>();
  for (const r of own) {
    const code = normalizeCourseCodeLoose(r.course);
    if (!code) continue;
    codes.add(code);
  }
  const failed: string[] = [];
  for (const code of codes) {
    if (didStudentFailCourse(rows, studentId, code)) failed.push(code);
  }
  return failed.sort();
}

/**
 * Equivalent to Python's `check_course_state(id, course)`.
 * Returns 'passed' | 'failed' | 'missing'.
 */
export type CourseState = 'passed' | 'failed' | 'missing';
export function checkCourseState(rows: GradeRow[], studentId: string, courseCode: string): CourseState {
  if (didStudentPassCourse(rows, studentId, courseCode)) return 'passed';
  if (didStudentFailCourse(rows, studentId, courseCode)) return 'failed';
  return 'missing';
}

/**
 * Equivalent to Python's `check_courses_state(id, courses)`.
 * `AND` across the list: returns 'passed' only if every course is
 * passed. Otherwise returns 'failed' if any course in the list was
 * failed, or 'missing' if none failed but at least one is missing.
 */
export function checkCoursesState(
  rows: GradeRow[],
  studentId: string,
  courses: string[]
): CourseState {
  let anyFailed = false;
  let anyMissing = false;
  for (const c of courses) {
    const state = checkCourseState(rows, studentId, c);
    if (state === 'failed') anyFailed = true;
    if (state === 'missing') anyMissing = true;
  }
  if (anyFailed) return 'failed';
  if (anyMissing) return 'missing';
  return 'passed';
}

/**
 * Equivalent to Python's `get_course_failed_from_list(id, courses)`.
 * Returns the subset of `courses` that are still missing (or failed)
 * for the student — i.e. they cannot be taken yet.
 */
export function missingFromList(rows: GradeRow[], studentId: string, courses: string[]): string[] {
  return courses.filter((c) => checkCourseState(rows, studentId, c) !== 'passed');
}

/**
 * "Current semester" derived from the grade-book: the number of
 * distinct terms this student appears in + 1. A fresh student with
 * no rows is semester 1. A student who completed two terms is in
 * semester 3 (their *next* term). Terms are sorted via `compareTerms`
 * so "Fall 2024 < Spring 2025" comes out in academic order.
 */
export function currentSemesterForStudent(rows: GradeRow[], studentId: string): number {
  const own = rowsForStudent(rows, studentId);
  if (own.length === 0) return 1;
  const distinct = new Set<string>();
  for (const r of own) distinct.add(r.term);
  if (distinct.size === 0) return 1;
  const ordered = Array.from(distinct).sort(compareTerms);
  // ordered[N-1] is the latest term; semester = N + 1.
  return ordered.length + 1;
}

// ---------------------------------------------------------------------------
// Aggregates used by StudentMetrics
// ---------------------------------------------------------------------------

export interface StudentMeta {
  studentId: string;
  name: string;
  major: string;
  /** Optional roster passthrough for downstream consumers. */
  email?: string;
  /** Optional roster passthrough for downstream consumers. */
  nationalId?: string;
}

/**
 * Build the per-student roster. Resolution rules, in order:
 *   1. The imported `roster` (Excel one-row-per-student) is
 *      authoritative — its `studentName` and `major` win when present.
 *   2. Fall back to the most-recent grade-book row that has them.
 *   3. Otherwise: `name = "Student <id>"`, `major = "Undeclared"`.
 *
 * `email` + `nationalId` come from the roster only — the grade-book
 * does not carry them. A student with no roster entry gets empty
 * strings for those fields.
 *
 * Grade-book rows for ids NOT in the roster are still kept — the
 * roster only enriches identity, it does not filter the population.
 */
export function studentRoster(rows: GradeRow[], roster?: RosterEntry[]): StudentMeta[] {
  const rosterById = new Map<string, RosterEntry>();
  if (roster) for (const r of roster) rosterById.set(r.studentId, r);

  const byId = new Map<string, StudentMeta & { _order: number }>();
  let order = 0;

  // Seed with roster first so roster-only students (no grade-book
  // rows yet) are visible.
  if (roster) {
    for (const r of roster) {
      byId.set(r.studentId, {
        studentId: r.studentId,
        name: r.studentName?.trim() || `Student ${r.studentId}`,
        major: r.major?.trim() || 'Undeclared',
        email: r.email?.trim() || undefined,
        nationalId: r.nationalId?.trim() || undefined,
        _order: order++,
      });
    }
  }

  for (const r of rows) {
    const existing = byId.get(r.studentId);
    const rosterEntry = rosterById.get(r.studentId);
    const name =
      rosterEntry?.studentName?.trim() ||
      r.studentName?.trim() ||
      existing?.name ||
      `Student ${r.studentId}`;
    const major =
      rosterEntry?.major?.trim() ||
      r.major?.trim() ||
      existing?.major ||
      'Undeclared';
    const email = rosterEntry?.email?.trim() || existing?.email;
    const nationalId = rosterEntry?.nationalId?.trim() || existing?.nationalId;
    byId.set(r.studentId, {
      studentId: r.studentId,
      name,
      major,
      email,
      nationalId,
      _order: order++,
    });
  }
  return Array.from(byId.values())
    .map(({ _order, ...meta }) => meta)
    .sort((a, b) => a.studentId.localeCompare(b.studentId));
}
