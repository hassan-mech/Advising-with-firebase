/**
 * Personalized prereq map — pure logic.
 *
 * Given the catalog + the active student's grade-book rows, builds the
 * data shape the `PrereqMap` screen renders:
 *   - 10 semester columns
 *   - courses inside each column, tagged with status
 *   - prereq edges (pairs of course codes) for SVG arrows
 *
 * Why the `semesters[]` lookup matters:
 *   each catalog row carries one semester index PER MAJOR
 *   (`semesters: [3, 0, 3, 0, 3, 3]` for [petrol, arch, aero, civil,
 *   mechatronics, biomed]). 0 means "not in this major's plan". We pick
 *   the index by matching the student's major name to the parallel
 *   `majors[]` array.
 */

import type { CatalogCourse, CourseCatalog, GradeRow } from './types';
import { normalizeCourseCodeLoose } from './normalize';
import {
  attemptsForCourse,
  checkCourseState,
  didStudentFailCourse,
  didStudentPassCourse,
  isFailingGrade,
} from './metrics';
import {
  MAX_SEMESTER,
  catalogMajorsFor,
  resolveMajorIndex,
  semesterForMajor,
} from './majorIndex';

export type CourseMapStatus =
  | 'passed'
  | 'failed'         // student attempted AND failed this course
  | 'failed-prereq'  // student never attempted; one or more prereqs was failed
  | 'open'           // student never attempted; all prereqs passed
  | 'blocked'        // student never attempted; one or more prereqs missing (never attempted)
  | 'planned'        // student has not attempted; course is on the active plan
  | 'in-program'     // not on this student's major plan
  | 'closed'         // course is not available in the selected schedule term
  | 'contradiction'; // course conflicts with another planned course in the schedule

export interface MappedCourse {
  code: string;
  title: string;
  credits: number;
  status: CourseMapStatus;
  /**
   * When `status === 'planned'`, this holds the New / Enhancing /
   * Repeated classification derived from the student's grade-book.
   * - `repeated`  — student attempted and failed this code before
   * - `enhancing` — student passed this code before (they're topping up)
   * - `new`       — student has never attempted this code
   *
   * Undefined when status is anything other than 'planned'.
   */
  planClassification?: 'new' | 'enhancing' | 'repeated';
  /**
   * Letter grade the student earned in this course on their LATEST
   * attempt (e.g. 'A', 'B+', 'F', 'FD'). Empty string when the
   * student has never attempted the course.
   */
  latestGrade: string;
  /** Prereq codes still missing (for blocked / failed-prereq). */
  missingPrereqs: string[];
  /** Every prereq code this course declares (shown inline on the card). */
  prereqCodes: string[];
  /**
   * Codes that THIS course is a prereq for within the ACTIVE
   * MAJOR's plan only — i.e. downstream courses the student is
   * blocked from taking because they haven't passed this one yet.
   * Empty when the course is not a prereq for anything in this
   * student's major, even if it has dependents in other majors.
   * The inverse of prereqs[], filtered by major plan membership.
   */
  blocks: string[];
  /** True if this course was attempted and failed. */
  failed: boolean;
}

export interface SemesterColumn {
  /** 1-based semester number (1..10). */
  number: number;
  courses: MappedCourse[];
}

export interface PrereqEdge {
  from: string; // prereq code
  to: string;   // dependent code
}

export interface PrereqMapData {
  semesters: SemesterColumn[];
  edges: PrereqEdge[];
  /** The student's major as resolved against the catalog. */
  resolvedMajor: string | null;
  /** True when the catalog has majors but the student's major didn't match. */
  majorMismatch: boolean;
}

export interface PlanInput {
  /** Course codes on the student's plan. */
  courseCodes: string[];
}

/** Place every catalog course into a 1..10 column for the given major. */
export function buildPrereqMap(
  catalog: CourseCatalog | null,
  rows: GradeRow[],
  studentId: string,
  studentMajor: string | undefined,
  plan?: PlanInput
): PrereqMapData {
  const semesters: SemesterColumn[] = Array.from({ length: MAX_SEMESTER }, (_, i) => ({
    number: i + 1,
    courses: [],
  }));

  if (!catalog || catalog.courses.length === 0) {
    return { semesters, edges: [], resolvedMajor: null, majorMismatch: false };
  }

  // The catalog may have multiple majors on each row. Resolve which
  // index applies to this student.
  const catalogMajors = catalogMajorsFor(catalog.courses[0]);

  const { index: majorIdx, resolved, mismatch } = resolveMajorIndex(studentMajor, catalogMajors);

  const edges: PrereqEdge[] = [];

  const plannedSet = new Set(
    (plan?.courseCodes ?? []).map((c) => normalizeCourseCodeLoose(c))
  );

  // Inverse prereq map scoped to the active major: courseCode →
  // list of codes that depend on it AND are on this major's plan.
  //
  // We filter downstream dependents by major plan membership
  // (`semesterForMajor(course, majorIdx, catalogMajors) >= 1`) so
  // each mapped card only answers "what does this course block in
  // MY major?" — never the full catalog. Without this filter, a
  // core course like MAT101 would list every major that uses it as
  // a prereq, drowning the card in courses the student will never
  // take. Built once from the catalog so each mapped card can read
  // its dependents without re-scanning every row.
  const dependentsByCode = new Map<string, string[]>();
  for (const course of catalog.courses) {
    const code = normalizeCourseCodeLoose(course.code);
    if (!code) continue;
    // Only consider this row as a downstream dependent if it's on
    // the active major's plan (semester >= 1). Rows whose semester
    // is 0 for this major are filtered out of the map entirely.
    const onPlan = catalogMajors
      ? semesterForMajor(course, majorIdx, catalogMajors) >= 1
      : true;
    if (!onPlan) continue;
    for (const prereq of course.prerequisites ?? []) {
      const fromCode = normalizeCourseCodeLoose(prereq);
      if (!fromCode) continue;
      const list = dependentsByCode.get(fromCode);
      if (list) {
        if (!list.includes(code)) list.push(code);
      } else {
        dependentsByCode.set(fromCode, [code]);
      }
    }
  }

  for (const course of catalog.courses) {
    const code = normalizeCourseCodeLoose(course.code);
    if (!code) continue;

    // Where in the grid does this course live for the active major?
    const semesterNum = catalogMajors
      ? semesterForMajor(course, majorIdx, catalogMajors)
      : 0;

    const status = classifyCourse(course, rows, studentId, plannedSet);
    const mapped: MappedCourse = {
      code,
      title: course.title || code,
      credits: course.credits || 0,
      status,
      // Only the three plan categories get the New / Enhancing /
      // Repeated label; everything else (passed/failed/open/blocked)
      // would be misleading. Derived from the student's grade-book so
      // it stays correct even if the plan reorders or removes courses.
      planClassification:
        status === 'planned' ? planClassificationFor(rows, studentId, code) : undefined,
      // Letter grade on the LATEST attempt — the same value the
      // student's transcript shows. Empty string when the student
      // has never attempted the course.
      latestGrade: gradeFor(rows, studentId, code),
      missingPrereqs:
        status === 'blocked' || status === 'failed-prereq' || status === 'failed'
          ? collectMissingPrereqs(course, rows, studentId)
          : [],
      prereqCodes: (course.prerequisites ?? [])
        .map((p) => normalizeCourseCodeLoose(p))
        .filter((p): p is string => Boolean(p)),
      blocks: dependentsByCode.get(code) ?? [],
      failed: status === 'failed',
    };

    if (semesterNum >= 1) {
      semesters[semesterNum - 1].courses.push(mapped);
    }

    for (const prereq of course.prerequisites ?? []) {
      const fromCode = normalizeCourseCodeLoose(prereq);
      if (fromCode) edges.push({ from: fromCode, to: code });
    }
  }

  // Sort each column by code so the layout is stable across renders.
  for (const col of semesters) {
    col.courses.sort((a, b) => a.code.localeCompare(b.code));
  }

  return { semesters, edges, resolvedMajor: resolved, majorMismatch: mismatch };
}

function classifyCourse(
  course: CatalogCourse,
  rows: GradeRow[],
  studentId: string,
  plannedSet: Set<string>
): CourseMapStatus {
  const code = normalizeCourseCodeLoose(course.code);
  // "Planned" wins for never-attempted courses the student has put on
  // their active plan — the user wants to register it, so the badge
  // is positive even if prereqs are missing.
  if (plannedSet.has(code)) return 'planned';
  const state = checkCourseState(rows, studentId, code);
  if (state === 'passed') return 'passed';
  if (state === 'failed') return 'failed';

  // Never attempted. Open iff every prereq is satisfied.
  const missing = collectMissingPrereqs(course, rows, studentId);
  if (missing.length === 0) return 'open';
  // If any missing prereq itself was FAILED, surface a distinct
  // 'failed-prereq' status (rose) — different from 'blocked' (amber)
  // because it requires adviser attention, not just course sequence.
  const failedPrereq = missing.some(
    (p) => isFailingGrade(gradeFor(rows, studentId, p))
  );
  return failedPrereq ? 'failed-prereq' : 'blocked';
}

function collectMissingPrereqs(
  course: CatalogCourse,
  rows: GradeRow[],
  studentId: string
): string[] {
  const out: string[] = [];
  for (const p of course.prerequisites ?? []) {
    const code = normalizeCourseCodeLoose(p);
    if (!code) continue;
    if (checkCourseState(rows, studentId, code) !== 'passed') out.push(code);
  }
  return out;
}

function gradeFor(rows: GradeRow[], studentId: string, code: string): string {
  const matches = attemptsForCourse(rows, studentId, code);
  if (matches.length === 0) return '';
  const lastPass = [...matches].reverse().find((r) => !isFailingGrade(r.grade));
  if (lastPass) return lastPass.grade;
  return matches[matches.length - 1].grade;
}

/**
 * Classify a planned course as New / Enhancing / Repeated from the
 * student's grade-book. Mirrors the export-side `planCourseStatus`
 * helper so the screen and the export agree.
 *
 *   - failed (any failed attempt, no passing attempt) → repeated
 *   - passed (at least one passing attempt)            → enhancing
 *   - never attempted                                  → new
 */
function planClassificationFor(
  rows: GradeRow[],
  studentId: string,
  code: string
): 'new' | 'enhancing' | 'repeated' {
  if (didStudentFailCourse(rows, studentId, code)) return 'repeated';
  if (didStudentPassCourse(rows, studentId, code)) return 'enhancing';
  return 'new';
}