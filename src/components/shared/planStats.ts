/**
 * Plan-stats computation — shared between the on-screen PlanStats
 * strip (PrereqMapScreen) and the printed PlanStatsGrid
 * (PrereqMapPrint). Both call sites were running the same logic:
 *
 *   - build a credit-by-code map from the catalog
 *   - for each code on the active plan, classify it as
 *     new / enhancing / repeated based on the student's history
 *   - sum credits per classification
 *   - build a synthetic "expected GPA" assuming every planned
 *     course lands at its cap (new = A, enhancing = A minus the
 *     current points, repeated = B+)
 *
 * Extracted here so the two rendering trees are pure presentational
 * shells that just call `computePlanStats` and lay out the result.
 */

import type { CourseCatalog, GradeRow } from '../../data/types';
import { normalizeCourseCodeLoose } from '../../data/normalize';
import {
  computeExpectedGpa,
  didStudentFailCourse,
  didStudentPassCourse,
  letterToPoints,
} from '../../data/metrics';

/** Build a Map<code, credits> from a catalog. Codes are normalised
 *  with `normalizeCourseCodeLoose` so the lookup is tolerant of
 *  "MEC 11" vs "MEC011" variants — same convention the rest of the
 *  app uses. Courses with no credits count as 0. */
export function buildCreditByCode(
  catalog: CourseCatalog | null
): Map<string, number> {
  const m = new Map<string, number>();
  if (!catalog) return m;
  for (const c of catalog.courses) {
    const code = normalizeCourseCodeLoose(c.code);
    if (code) m.set(code, c.credits ?? 0);
  }
  return m;
}

export interface PlanStatsInput {
  studentId: string;
  metricGpa: number;
  totalUnits: number;
  totalFailedUnits: number;
  planCodes: string[];
  rows: GradeRow[];
  creditByCode: Map<string, number>;
}

export interface PlanStatsResult {
  newCh: number;
  enhancingCh: number;
  repeatedCh: number;
  registeredHours: number;
  /** Projected GPA if every planned course lands at its cap.
   *  `null` when there is nothing to compute (no history, no plan). */
  expectedGpa: number | null;
}

interface InternalPlanEntry {
  credits: number;
  classification: 'new' | 'enhancing' | 'repeated';
  currentPoints: number | null;
}

/** Classify one plan code against the student's history. Internal
 *  helper, exposed as a separate export so unit tests can pin the
 *  classification rule (new / enhancing / repeated) without
 *  re-running the whole computation. */
export function classifyPlanCode(
  code: string,
  studentId: string,
  rows: GradeRow[]
): 'new' | 'enhancing' | 'repeated' {
  if (didStudentFailCourse(rows, studentId, code)) return 'repeated';
  if (didStudentPassCourse(rows, studentId, code)) return 'enhancing';
  return 'new';
}

/** Compute the plan breakdown. Pure function — the only side
 *  effect is reading `rows` and `creditByCode`, both passed in. */
export function computePlanStats(input: PlanStatsInput): PlanStatsResult {
  const {
    studentId,
    metricGpa,
    totalUnits,
    totalFailedUnits,
    planCodes,
    rows,
    creditByCode,
  } = input;

  let newCh = 0;
  let enhancingCh = 0;
  let repeatedCh = 0;
  let registeredHours = 0;
  const planForExpected: InternalPlanEntry[] = [];

  for (const raw of planCodes) {
    const code = normalizeCourseCodeLoose(raw);
    if (!code) continue;
    const credits = creditByCode.get(code) ?? 0;
    const classification = classifyPlanCode(code, studentId, rows);
    if (classification === 'new') newCh += credits;
    else if (classification === 'enhancing') enhancingCh += credits;
    else repeatedCh += credits;
    registeredHours += credits;
    let currPts: number | null = null;
    if (classification === 'enhancing') {
      // Find the latest passing grade's point value (mirrors
      // prereqMap.gradeFor). Walk the rows in reverse so we stop
      // at the most recent passing attempt.
      const passing = rows
        .filter(
          (r) =>
            r.studentId === studentId &&
            normalizeCourseCodeLoose(r.course) === code
        )
        .reverse()
        .find((r) => !didStudentFailCourse(rows, studentId, code) && r.grade);
      if (passing) currPts = letterToPoints(passing.grade);
    }
    planForExpected.push({ credits, classification, currentPoints: currPts });
  }

  const expectedGpa =
    totalUnits === 0 && totalFailedUnits === 0 && planForExpected.length === 0
      ? null
      : computeExpectedGpa(
          metricGpa,
          totalUnits,
          totalFailedUnits,
          planForExpected
        );

  return {
    newCh,
    enhancingCh,
    repeatedCh,
    registeredHours,
    expectedGpa,
  };
}
