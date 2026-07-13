/**
 * FailureReportPrint — hidden print-only DOM tree, single paper-friendly
 * report of the leaderboard + distribution + per-student lists.
 *
 * Rendered by the Stats tab when the user clicks "Print report". Lives
 * alongside the on-screen app; print.css hides it on screen and shows
 * it (with everything else hidden) on print.
 */

import { useMemo } from 'react';
import type {
  CourseCatalog,
  RosterEntry,
  GradeRow,
  StudentMetrics,
} from '../data/types';
import { downstreamCoursesFor, failureStats, type CourseFailureRow } from '../data/advising';
import { normalizeCourseCodeLoose } from '../data/normalize';
import { resolveStudentNames } from './shared/leaderboardStudents';
import {
  catalogMajorsFor,
  resolveMajorIndex,
} from '../data/majorIndex';

export interface FailureReportPrintProps {
  rows: GradeRow[];
  catalog: CourseCatalog | null;
  roster: RosterEntry[];
  /** Major that drives the "sem N" chips in the downstream section. */
  majorPick: string;
  /**
   * Per-student metrics map. Optional — when supplied the
   * "All students" tabular section uses it for current GPA + total
   * hours (passed + failed) so the printed page is consistent with
   * the on-screen Roster. When missing the section falls back to
   * zero values so the table renders even on legacy call sites.
   */
  metricsByStudent?: Record<string, StudentMetrics>;
}

export default function FailureReportPrint({
  rows,
  catalog,
  roster,
  majorPick,
  metricsByStudent,
}: FailureReportPrintProps) {
  const stats = useMemo(
    () => failureStats(rows, catalog, roster),
    [rows, catalog, roster]
  );

  const catalogMajors = useMemo(
    () => (catalog && catalog.courses.length > 0
      ? catalogMajorsFor(catalog.courses[0])
      : undefined),
    [catalog]
  );
  const majorIdx = useMemo(() => {
    if (!catalogMajors || majorPick === '') return -1;
    return resolveMajorIndex(majorPick, catalogMajors).index;
  }, [catalogMajors, majorPick]);

  // Build the "all students" roll-up. One row per distinct student
  // in the dataset, regardless of whether they failed anything — so
  // the adviser sees the full cohort at a glance and can spot
  // students who would benefit from a remediation plan.
  //
  // Columns: ID, Student Name, Major, Total Hours (passed + failed),
  // Failed Courses (one per line, code + title), Expected GPA if all
  // failures ace at B+ (3.3).
  //
  // The "all failures ace at B+" calculation mirrors the `repeated`
  // classification rule already used by `computeExpectedGpa` —
  // retakes cap at B+, not A. Numerator = currentGpa × oldHours +
  // 3.3 × failedCredits; denominator = oldHours (unchanged because
  // failed credits are already counted in totalFailedUnits). For
  // students with zero failures the value is just their current GPA
  // (formula degenerates to currentGpa × total / total).
  const allStudentsRows = useMemo(() => {
    const nameById = new Map<string, string>();
    const majorById = new Map<string, string>();
    for (const r of roster) {
      nameById.set(r.studentId, r.studentName?.trim() || `Student ${r.studentId}`);
      majorById.set(r.studentId, r.major?.trim() || 'Undeclared');
    }
    // Catalog lookup so each failed code renders as "CODE — title".
    const titleByCode = new Map<string, string>();
    if (catalog) {
      for (const c of catalog.courses) {
        const code = normalizeCourseCodeLoose(c.code);
        if (code && c.title) titleByCode.set(code, c.title);
      }
    }
    // Walk the distinct student ids once.
    const ids = new Set<string>();
    for (const r of rows) ids.add(r.studentId);
    const sortedIds = Array.from(ids).sort();
    return sortedIds.map((id) => {
      const metric = metricsByStudent?.[id];
      const totalPassed = metric?.totalUnits ?? 0;
      const totalFailed = metric?.totalFailedUnits ?? 0;
      const totalHours = totalPassed + totalFailed;
      // Each failed course as code + title (one per line in the
      // printed cell). Code is normalized via the helper so
      // "MEC 11" / "MEC011" dedupe to one entry.
      const failedCodes: string[] = metric?.failedCourseCodes ?? [];
      const failedCreditsByCode = new Map<string, number>();
      for (const r of rows) {
        if (r.studentId !== id) continue;
        const code = normalizeCourseCodeLoose(r.course);
        if (!code) continue;
        if (failedCodes.includes(code)) {
          if (!failedCreditsByCode.has(code)) {
            failedCreditsByCode.set(code, typeof r.units === 'number' ? r.units : 0);
          }
        }
      }
      const failedCourses = failedCodes.map((code) => ({
        code,
        title: titleByCode.get(code) || '',
        credits: failedCreditsByCode.get(code) ?? 0,
      }));
      // Expected GPA: if every failed course is aced (B+, capped).
      // 3.3 × credits per failed course, hours stay the same.
      let expectedGpa: number | null = null;
      if (totalHours > 0) {
        const currentPoints = (metric?.gpa ?? 0) * totalHours;
        const failedCreditsTotal = failedCourses.reduce((s, c) => s + (c.credits || 0), 0);
        const newPoints = 3.3 * failedCreditsTotal;
        expectedGpa =
          Math.round(((currentPoints + newPoints) / totalHours) * 1000 + 1e-9) / 1000;
      }
      return {
        studentId: id,
        name: nameById.get(id) ?? metric?.name ?? `Student ${id}`,
        major:
          majorById.get(id) ??
          metric?.major ??
          (rows.find((r) => r.studentId === id)?.major?.trim() ?? 'Undeclared'),
        currentGpa: metric?.gpa ?? null,
        totalHours,
        failedCourses,
        expectedGpa,
      };
    });
  }, [rows, roster, catalog, metricsByStudent]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div data-print="failure-report">
      <div className="print-page">
        <h1>Failure Statistics Report</h1>
        <div className="small">
          Generated {today}
          {majorPick && <> · Major plan: <strong>{majorPick}</strong></>}
          {' '}· {stats.totalStudents} student(s) · {stats.leaderboard.length} distinct failed course(s)
        </div>

        <h2 style={{ marginTop: '6mm' }}>Summary</h2>
        <div className="summary-grid">
          <div className="summary-card">
            <div className="num">{stats.totalStudentsWithFailure}</div>
            <div className="label">Students with ≥1 failure (of {stats.totalStudents})</div>
          </div>
          <div className="summary-card">
            <div className="num">{stats.leaderboard.length}</div>
            <div className="label">Distinct failed courses</div>
          </div>
          <div className="summary-card">
            <div className="num">
              {stats.leaderboard[0]
                ? `${stats.leaderboard[0].courseCode}`
                : '—'}
            </div>
            <div className="label">
              Most-failed ({stats.leaderboard[0]?.count ?? 0} student(s))
            </div>
          </div>
        </div>

        <h2 style={{ marginTop: '6mm' }}>Failure distribution</h2>
        <div className="distribution">
          {stats.distribution.map((d) => (
            <div className="summary-card" key={d.label}>
              <div className="num">{d.count}</div>
              <div className="label">{d.label}</div>
            </div>
          ))}
        </div>

        <h2 style={{ marginTop: '6mm' }}>Top failed courses</h2>
        {stats.leaderboard.length === 0 ? (
          <div className="small">No failures recorded.</div>
        ) : (
          stats.leaderboard.map((row) => (
            <LeaderboardPrintRow
              key={row.courseCode}
              row={row}
              roster={roster}
              catalog={catalog}
              majorIdx={majorIdx}
              catalogMajors={catalogMajors}
            />
          ))
        )}

        {/*
          Tabular student lists — added in v2. For every failed
          course, a clean (ID, Student Name) table with one row per
          student. The user explicitly asked for plain selectable
          tables so the printed page can be drag-selected and
          pasted into another document or spreadsheet. Rendered as
          a real <table> with `preport-student-table` class so the
          text behaves like table cells (one row = one student).

          We KEEP the leaderboard cards above — they're the
          at-a-glance view that shows downstream-courses cascade
          per failed course. This section is the "give me the raw
          list" supplement.
        */}
        <h2 style={{ marginTop: '6mm' }}>Tabular student lists</h2>
        {stats.leaderboard.length === 0 ? (
          <div className="preport-table-empty">No failures recorded.</div>
        ) : (
          stats.leaderboard.map((row) => (
            <CourseStudentTable key={row.courseCode} row={row} roster={roster} />
          ))
        )}

        {/*
          All-students roll-up — added in v2 per the user's spec.

          One row per distinct student in the dataset (not just
          students who failed). Columns: ID, Student Name, Major,
          Current GPA (3 decimals), Total Hours (passed + failed),
          Failed Courses (one per line, code + title), Expected GPA
          if every failed course aced at B+ (3.3 — the retake cap the
          user asked for, mirroring `computeExpectedGpa`'s 'repeated'
          classification).

          This supplements the per-course tables above. The per-
          course table answers "who failed this course"; this one
          answers "for each student, what would their GPA look like
          if they aced every failure". Useful at advisement time —
          the adviser can see at a glance which students have a
          meaningful GPA upside from a retake plan.
        */}
        <h2 style={{ marginTop: '6mm' }}>All students (with failure info)</h2>
        {allStudentsRows.length === 0 ? (
          <div className="preport-table-empty">No students in the dataset.</div>
        ) : (
          <AllStudentsTable rows={allStudentsRows} />
        )}

        {stats.studentsByFailureCount.length > 0 && (
          <>
            <h2 style={{ marginTop: '6mm' }}>Students by failure count</h2>
            <div className="summary-grid">
              {stats.studentsByFailureCount.slice(0, 12).map((s) => (
                <div className="summary-card" key={s.studentId}>
                  <div className="num" style={{ fontSize: '14pt' }}>{s.count}</div>
                  <div style={{ fontWeight: 700, fontSize: '10pt' }}>{s.studentName}</div>
                  <div className="label">{s.studentId}</div>
                </div>
              ))}
            </div>
            {stats.studentsByFailureCount.length > 12 && (
              <div className="small" style={{ marginTop: '2mm' }}>
                … and {stats.studentsByFailureCount.length - 12} more.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function LeaderboardPrintRow({
  row,
  roster,
  catalog,
  majorIdx,
  catalogMajors,
}: {
  row: CourseFailureRow;
  roster: RosterEntry[];
  catalog: CourseCatalog | null;
  majorIdx: number;
  catalogMajors?: string[];
}) {
  const studentNames = resolveStudentNames(row.studentIds, roster);
  const downstream = useMemo(
    () => downstreamCoursesFor(catalog, row.courseCode, majorIdx, catalogMajors),
    [catalog, row.courseCode, majorIdx, catalogMajors]
  );
  return (
    <div className="leaderboard-row">
      <div className="top">
        <div>
          <span className="code">{row.courseCode}</span>
          {row.courseTitle && <span className="title"> — {row.courseTitle}</span>}
        </div>
        <div className="count">
          {row.count} {row.count === 1 ? 'student' : 'students'}
        </div>
      </div>

      {downstream.length > 0 && (
        <div className="downstream">
          <h4>Blocks downstream ({downstream.length})</h4>
          {downstream.map((d) => (
            <span className="chip" key={d.courseCode}>
              {d.courseCode}
              {d.semester > 0 ? ` · sem ${d.semester}` : ''}
              {d.credits > 0 ? ` · ${d.credits}cr` : ''}
            </span>
          ))}
        </div>
      )}

      {studentNames.length > 0 && (
        <div className="student-list">
          {studentNames.map((name, i) => (
            <div className="item" key={row.studentIds[i]}>
              <span className="name">{name}</span>
              <span className="id">{row.studentIds[i]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Tabular student list — one row per student for the given failed
 * course. Added in v2 so the printed failure report has a
 * copy-friendly supplement to the leaderboard cards above.
 *
 * Uses a real <table> (preport-student-table) so the rendered text
 * behaves like a spreadsheet: drag-select across cells, paste into
 * Excel. The class lives in print.css alongside the rest of the
 * print stylesheet because Tailwind's content scanner does NOT visit
 * print.css and so any inline Tailwind classes would silently fail
 * to render in print mode.
 *
 * Course codes live in `.preport-course-heading .code` (monospace)
 * so the heading reads like a row header. The "N student(s)" counter
 * is on the right of the heading row.
 *
 * studentIds is already sorted alphabetically upstream
 * (`failureStats` calls `Array.from(students).sort()`) so we just
 * walk them in order — one row per student, no resorting.
 */
function CourseStudentTable({
  row,
  roster,
}: {
  row: CourseFailureRow;
  roster: RosterEntry[];
}) {
  const studentNames = resolveStudentNames(row.studentIds, roster);
  // Build a rosterById lookup so we can resolve a student's major
  // next to their ID + name. Falls back to "Undeclared" when the
  // roster lacks the id (same convention the rest of the app uses —
  // see `studentRoster` in data/metrics.ts).
  const majorsById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of roster) {
      m.set(r.studentId, r.major?.trim() || 'Undeclared');
    }
    return m;
  }, [roster]);
  return (
    <div className="preport-course-block">
      <div className="preport-course-heading">
        <span>
          <span className="code">{row.courseCode}</span>
          {row.courseTitle && <span> — </span>}
          {row.courseTitle && <span className="title">{row.courseTitle}</span>}
        </span>
        <span className="count">
          {row.count} {row.count === 1 ? 'student' : 'students'}
        </span>
      </div>
      <table className="preport-student-table">
        <thead>
          <tr>
            <th style={{ width: '22%' }}>ID</th>
            <th>Student Name</th>
            <th style={{ width: '24%' }}>Major</th>
          </tr>
        </thead>
        <tbody>
          {row.studentIds.map((id, i) => (
            <tr key={id}>
              <td className="id">{id}</td>
              <td>{studentNames[i]}</td>
              <td>{majorsById.get(id) ?? 'Undeclared'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * All-students tabular roll-up — added in v2 per the user's spec.
 *
 * One row per distinct student in the grade-book, regardless of
 * whether they failed anything. Columns (in order):
 *
 *   1. ID                   — student id (monospaced)
 *   2. Student Name         — friendly name from roster
 *   3. Major                — roster major (Undeclared when missing)
 *   4. Current GPA          — cumulative GPA as reported on the
 *                             student's last term row, shown in
 *                             3-decimal precision so it lines up
 *                             visually with the Expected GPA column.
 *                             `—` when the student has no metric
 *                             (no grade-book rows).
 *   5. Total Hours          — passed + failed credits (the student's
 *                             full credit load so far)
 *   6. Failed Courses       — every failed course as
 *                             `CODE — Title` on its own line inside
 *                             the same cell. Empty when the student
 *                             has no failures.
 *   7. Expected GPA         — what the student's GPA would be if
 *                             every failed course is aced, capped at
 *                             B+ (3.3) per retake rule. `—` when
 *                             totalHours is 0 (no hours at all).
 *
 * Real <table> (`.preport-all-students-table`) so the user can
 * drag-select the cells and paste them into a spreadsheet. The
 * failed-course cell uses a stacked line list (one course per line)
 * so a student with 4 failures stays readable.
 *
 * Input is a pre-sorted list (sorted by studentId asc) so the
 * printed page reads the same on every run.
 */
function AllStudentsTable({
  rows,
}: {
  rows: Array<{
    studentId: string;
    name: string;
    major: string;
    currentGpa: number | null;
    totalHours: number;
    failedCourses: Array<{ code: string; title: string; credits: number }>;
    expectedGpa: number | null;
  }>;
}) {
  return (
    <table className="preport-all-students-table">
      <thead>
        <tr>
          <th style={{ width: '10%' }}>ID</th>
          <th style={{ width: '18%' }}>Student Name</th>
          <th style={{ width: '16%' }}>Major</th>
          <th className="num" style={{ width: '10%' }}>Current GPA</th>
          <th className="num" style={{ width: '8%' }}>Total Hours</th>
          <th>Failed Courses</th>
          <th className="num" style={{ width: '10%' }}>Expected GPA</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.studentId}>
            <td className="mono">{r.studentId}</td>
            <td>{r.name}</td>
            <td>{r.major}</td>
            <td className="num">
              {r.currentGpa == null ? '—' : r.currentGpa.toFixed(3)}
            </td>
            <td className="num">{r.totalHours}</td>
            <td className="failed-cell">
              {r.failedCourses.length === 0 ? (
                <span className="muted">—</span>
              ) : (
                r.failedCourses.map((c, i) => (
                  <div className="failed-line" key={`${r.studentId}-${c.code}-${i}`}>
                    <span className="mono">{c.code}</span>
                    {c.title && <span> — {c.title}</span>}
                  </div>
                ))
              )}
            </td>
            <td className="num">
              {r.expectedGpa == null ? '—' : r.expectedGpa.toFixed(3)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}