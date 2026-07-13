/**
 * PlanTablePrint — print-only DOM tree.
 *
 * One A4 portrait page with a single tabular roll-up across every
 * student that planned at least one course on the ACTIVE term.
 *
 * Columns (added in v2):
 *   ID, Student Name, Major, Current GPA, Total Hours (passed+failed),
 *   New CH, Repeated CH, Enhancing CH, Expected GPA, New Total Hours
 *
 * "New Total Hours" = current totalHours + this-term registeredHours
 * (the credit load the student is about to attempt, summed on top of
 * the hours they've already attempted in the past). For students who
 * haven't planned any new courses the value equals their totalHours
 * because registeredHours is 0.
 *
 * Numeric cells are right-aligned and monospaced so the columns line
 * up visually when the user is scanning the page. The whole table is
 * a real <table> element (`.preport-plan-table`) so the user can
 * drag-select the cells and paste them into a spreadsheet — which
 * is the whole point of this tree, per the user's spec ("make the
 * copy of content of print page available").
 *
 * Cohort selection: only students that have a non-empty
 * `courseCodes` entry on the active term are listed. Roster-only
 * students with no planned courses, and grade-book-only students
 * with no plans, are skipped. This matches the on-screen "Print all
 * forms" cohort rule in Shell.tsx:107 so the printed roll-up never
 * lists a student who has nothing to show.
 *
 * Sorted by student id ascending so the printed output is stable
 * across runs.
 *
 * Compute path: reuses `computePlanStats` (shared with the on-screen
 * PrereqMap strip + PrereqMapPrint). The on-screen numbers and the
 * printed numbers are byte-for-byte identical because both call
 * sites build the same `PlanStatsInput`.
 */

import { useMemo } from 'react';
import type {
  CourseCatalog,
  DataState,
  GradeRow,
  RosterEntry,
  StudentMetrics,
} from '../data/types';
import { buildCreditByCode, computePlanStats } from './shared/planStats';

export interface PlanTablePrintProps {
  state: DataState;
  catalog: CourseCatalog | null;
  roster: RosterEntry[];
  metricsByStudent: Record<string, StudentMetrics>;
}

/** Per-row shape for the plan summary table. Pure data — UI lives in
 *  the JSX below. */
interface PlanTableRow {
  studentId: string;
  name: string;
  major: string;
  currentGpa: number;
  totalHours: number;
  newCh: number;
  repeatedCh: number;
  enhancingCh: number;
  expectedGpa: number | null;
  newTotalHours: number;
}

export default function PlanTablePrint({
  state,
  catalog,
  roster,
  metricsByStudent,
}: PlanTablePrintProps) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Active term — derived from state, not a prop, so the cohort
  // matches the rest of the print system (the user picks a term via
  // the header picker; the print always targets the active one).
  const activeTerm = useMemo(
    () => state.terms.find((t) => t.id === state.activeTermId) ?? null,
    [state.terms, state.activeTermId]
  );

  // Catalog credits keyed by normalized code. Shared helper — same
  // map the on-screen `PlanStats` strip uses, so credit totals on
  // paper and on screen match byte-for-byte.
  const creditByCode = useMemo(() => buildCreditByCode(catalog), [catalog]);

  // Single studentsById map for fast name + major lookup. Mirrors
  // what DataContext already computed via `studentRoster`, so the
  // names here match the names on the existing print trees
  // (RegistrationFormPrint, PrereqMapPrint).
  const nameById = useMemo(() => {
    const m = new Map<
      string,
      { name: string; major: string; email?: string; nationalId?: string }
    >();
    for (const r of roster) {
      m.set(r.studentId, {
        name: r.studentName?.trim() || `Student ${r.studentId}`,
        major: r.major?.trim() || 'Undeclared',
        email: r.email?.trim() || undefined,
        nationalId: r.nationalId?.trim() || undefined,
      });
    }
    // Fall back to grade-book identity when roster lacks the id.
    for (const row of state.rows) {
      if (m.has(row.studentId)) continue;
      m.set(row.studentId, {
        name: row.studentName?.trim() || `Student ${row.studentId}`,
        major: row.major?.trim() || 'Undeclared',
      });
    }
    return m;
  }, [roster, state.rows]);

  // Compute one row per student that has at least one course on the
  // active term. Sorted by student id asc for stable output.
  const rows = useMemo<PlanTableRow[]>(() => {
    if (!activeTerm) return [];
    const out: PlanTableRow[] = [];
    const sortedEntries = [...activeTerm.entries]
      .filter((e) => e.courseCodes.length > 0)
      .sort((a, b) => a.studentId.localeCompare(b.studentId));
    for (const entry of sortedEntries) {
      const metric = metricsByStudent[entry.studentId];
      const id = entry.studentId;
      // Metric is the canonical source. For students with no metric
      // (e.g. planned but no grade-book rows yet) fall back to zero
      // values so the table is well-formed — the user can see the
      // plan without having to load the grade-book first.
      const currentGpa = metric?.gpa ?? 0;
      const totalUnits = metric?.totalUnits ?? 0;
      const totalFailedUnits = metric?.totalFailedUnits ?? 0;
      const totalHours = totalUnits + totalFailedUnits;
      const planResult = computePlanStats({
        studentId: id,
        metricGpa: currentGpa,
        totalUnits,
        totalFailedUnits,
        planCodes: entry.courseCodes,
        rows: state.rows,
        creditByCode,
      });
      const meta = nameById.get(id);
      out.push({
        studentId: id,
        name: meta?.name ?? `Student ${id}`,
        major: meta?.major ?? metric?.major ?? 'Undeclared',
        currentGpa,
        totalHours,
        newCh: planResult.newCh,
        repeatedCh: planResult.repeatedCh,
        enhancingCh: planResult.enhancingCh,
        expectedGpa: planResult.expectedGpa,
        newTotalHours: totalHours + planResult.registeredHours,
      });
    }
    return out;
  }, [activeTerm, metricsByStudent, nameById, state.rows, creditByCode]);

  // Empty state — mount the wrapper so the print CSS hides
  // everything but the print tree, even when there's nothing to
  // render. The user explicitly chose to filter to "students who
  // planned at least one course on the active term", so an empty
  // term yields a friendly "no plans" hint instead of a blank page.
  if (!activeTerm) {
    return (
      <div data-print="plan-table">
        <div data-print-page className="print-page">
          <h1>Plan summary</h1>
          <div className="small">
            Generated {today} · No active term. Create a term in the Prereq Map
            and add courses to a student&apos;s plan first.
          </div>
        </div>
      </div>
    );
  }

  // Sum row for the table footer — used by the on-screen adviser to
  // sanity-check totals across the cohort.
  const totals = useMemo(() => {
    let currentGpaSum = 0;
    let totalHoursSum = 0;
    let newChSum = 0;
    let repeatedChSum = 0;
    let enhancingChSum = 0;
    let expectedGpaSum = 0;
    let expectedGpaCount = 0;
    let newTotalHoursSum = 0;
    for (const r of rows) {
      currentGpaSum += r.currentGpa;
      totalHoursSum += r.totalHours;
      newChSum += r.newCh;
      repeatedChSum += r.repeatedCh;
      enhancingChSum += r.enhancingCh;
      if (r.expectedGpa != null) {
        expectedGpaSum += r.expectedGpa;
        expectedGpaCount += 1;
      }
      newTotalHoursSum += r.newTotalHours;
    }
    return {
      currentGpaSum,
      totalHoursSum,
      newChSum,
      repeatedChSum,
      enhancingChSum,
      expectedGpaAvg: expectedGpaCount > 0 ? expectedGpaSum / expectedGpaCount : null,
      newTotalHoursSum,
      expectedGpaCount,
    };
  }, [rows]);

  return (
    <div data-print="plan-table">
      <div data-print-page className="print-page">
        <h1>Plan summary</h1>
        <div className="small">
          Generated {today} · Term: <strong>{activeTerm.name}</strong> ·
          {' '}{rows.length} student{rows.length === 1 ? '' : 's'} planned
        </div>

        {rows.length === 0 ? (
          <div className="preport-table-empty">
            No student has planned at least one course on this term yet.
            Open the Prereq Map and click course cards to add them to a
            student&apos;s plan.
          </div>
        ) : (
          <table className="preport-plan-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Student Name</th>
                <th>Major</th>
                <th className="num">Current GPA</th>
                <th className="num">Total Hours</th>
                <th className="num">New CH</th>
                <th className="num">Repeated CH</th>
                <th className="num">Enhancing CH</th>
                <th className="num">Expected GPA</th>
                <th className="num">New Total Hours</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.studentId}>
                  <td className="mono">{r.studentId}</td>
                  <td>{r.name}</td>
                  <td>{r.major}</td>
                  <td className="num">{r.currentGpa.toFixed(2)}</td>
                  <td className="num">{r.totalHours}</td>
                  <td className="num">{r.newCh || '—'}</td>
                  <td className="num">{r.repeatedCh || '—'}</td>
                  <td className="num">{r.enhancingCh || '—'}</td>
                  <td className="num">
                    {r.expectedGpa == null ? '—' : r.expectedGpa.toFixed(3)}
                  </td>
                  <td className="num">{r.newTotalHours}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>
                  Totals
                  {totals.expectedGpaCount > 0 && (
                    <>
                      {' '}· Expected GPA avg across {totals.expectedGpaCount}{' '}
                      student{totals.expectedGpaCount === 1 ? '' : 's'}
                    </>
                  )}
                </td>
                <td className="num">
                  {(totals.currentGpaSum / Math.max(rows.length, 1)).toFixed(2)}
                </td>
                <td className="num">{totals.totalHoursSum}</td>
                <td className="num">{totals.newChSum}</td>
                <td className="num">{totals.repeatedChSum}</td>
                <td className="num">{totals.enhancingChSum}</td>
                <td className="num">
                  {totals.expectedGpaAvg == null
                    ? '—'
                    : totals.expectedGpaAvg.toFixed(3)}
                </td>
                <td className="num">{totals.newTotalHoursSum}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
