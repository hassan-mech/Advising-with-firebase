/**
 * RosterTable — v2.
 *
 * Dense table of every student with the metrics that drive advising
 * decisions. Columns are sortable. Clicking a row jumps to the
 * prereq map focused on that student (the most common advising
 * follow-up). The student-detail modal is still available via the
 * small "info" button in the rightmost cell for users who want
 * the per-student metric grid without leaving the roster.
 *
 * Includes a "Plan CH" column: the sum of credits for the courses a
 * student has planned on the CURRENTLY ACTIVE term (matches the
 * `registeredHours` field of `computePlanStats`). Recomputed
 * whenever the active term, the catalog, or the term entries change
 * so edits in the prereq map update the table immediately.
 */

import { useMemo, useState } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle, CheckCircle2, Info, Map } from 'lucide-react';
import { useData } from '../data/DataContext';
import type { StudentMetrics } from '../data/types';
import { normalizeCourseCodeLoose } from '../data/normalize';
import StudentDetailModal from './StudentDetailModal';

type SortKey =
  | keyof Pick<
      StudentMetrics,
      | 'studentId'
      | 'name'
      | 'major'
      | 'gpa'
      | 'totalUnits'
      | 'totalFailedUnits'
      | 'failedCourseCodes'
      | 'missingPrereqsForNextTerm'
      | 'email'
      | 'nationalId'
      | 'level'
    >
  // Derived columns — not part of StudentMetrics. Live here only so
  // the sortable column machinery (header click handler + arrow icon)
  // doesn't need a special case. Computed per-row from state + catalog.
  | 'plannedHoursActiveTerm'
  // Total credits the student attempted — passed + failed. Shown
  // alongside the "Passed" column so the adviser can see both at
  // a glance (e.g. "Sara passed 12, failed 6, total 18 attempted").
  | 'totalUnitsAll';

interface Column {
  key: SortKey;
  label: string;
  numeric?: boolean;
  /** Hint shown on hover for derived columns so users understand what
   *  the number means without us putting it in the column header. */
  hint?: string;
}

const COLUMNS: Column[] = [
  { key: 'studentId', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'major', label: 'Major' },
  { key: 'email', label: 'Email' },
  { key: 'nationalId', label: 'National ID' },
  { key: 'level', label: 'Level' },
  { key: 'gpa', label: 'GPA', numeric: true },
  {
    key: 'totalUnitsAll',
    label: 'Total',
    numeric: true,
    hint: 'Total credits attempted so far (passed + failed)',
  },
  { key: 'totalUnits', label: 'Passed', numeric: true },
  {
    key: 'plannedHoursActiveTerm',
    label: 'Plan CH',
    numeric: true,
    hint: 'Sum of credits for the courses planned on the active term',
  },
  { key: 'failedCourseCodes', label: '# Failed', numeric: true },
  { key: 'missingPrereqsForNextTerm', label: '# Missing', numeric: true },
];

export default function RosterTable({
  onJumpToPrereq,
}: {
  /**
   * Called with the student id when the user clicks a row. App uses
   * this to flip the top-level view to the prereq map and pre-seed
   * the focused student.
   */
  onJumpToPrereq: (studentId: string) => void;
}) {
  const { metricsByStudent, state, catalogIndex } = useData();
  const [sortKey, setSortKey] = useState<SortKey>('gpa');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [activeStudentId, setActiveStudentId] = useState<string | null>(null);

  // Memoized map of student id → planned credit hours on the
  // currently active term. Re-derived only when the active term id,
  // its entries, or the catalog changes — the same inputs the
  // prereq map screen uses, so the on-screen plan stats and this
  // table cell stay in lock-step.
  //
  // Lookup chain per code:
  //   catalog[code] (exact uppercase key from catalogIndex)
  //     → catalog[row.code] (lower-cased fallback)
  //     → 0 (course not in catalog; rare — happens if the user
  //       planned a course that the catalog doesn't list, e.g. a
  //       new course the catalog file doesn't have yet).
  //
  // We try catalogIndex first because it's the fast O(1) path
  // already used by CourseCombobox and the print trees. The
  // fallback to a fresh catalog walk covers the edge case where
  // catalog credits were imported with slightly different casing.
  const plannedHoursByStudent = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    const term = state.terms.find((t) => t.id === state.activeTermId);
    if (!term) return out;
    const creditFor = (rawCode: string): number => {
      const key = rawCode.trim().toUpperCase();
      const c = catalogIndex.get(key);
      if (c && typeof c.credits === 'number') return c.credits;
      if (state.catalog) {
        const loose = normalizeCourseCodeLoose(rawCode);
        const fallback = state.catalog.courses.find(
          (x) => normalizeCourseCodeLoose(x.code) === loose
        );
        if (fallback && typeof fallback.credits === 'number') return fallback.credits;
      }
      return 0;
    };
    for (const entry of term.entries) {
      let sum = 0;
      for (const code of entry.courseCodes) sum += creditFor(code);
      out[entry.studentId] = sum;
    }
    return out;
  }, [state.terms, state.activeTermId, state.catalog, catalogIndex]);

  const rows = useMemo(() => {
    const all = Object.values(metricsByStudent);
    const sorted = [...all].sort((a, b) =>
      compareMetrics(a, b, sortKey, plannedHoursByStudent)
    );
    return sortDir === 'desc' ? sorted.reverse() : sorted;
  }, [metricsByStudent, sortKey, sortDir, plannedHoursByStudent]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(
        key === 'name' ||
          key === 'major' ||
          key === 'studentId' ||
          key === 'plannedHoursActiveTerm' ||
          key === 'totalUnitsAll'
          ? 'asc'
          : 'desc'
      );
    }
  };

  return (
    <>
      <div className="flex-1 overflow-auto custom-scrollbar">
        <table className="w-full text-sm text-slate-200">
          <thead className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur-sm border-b border-white/10">
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  title={col.hint}
                  className={`px-4 py-3 text-left text-[10px] font-extrabold uppercase tracking-wider text-slate-400 cursor-pointer select-none hover:text-white transition-colors ${col.numeric ? 'text-right' : ''}`}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {col.key === sortKey ? (
                      sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                    ) : (
                      <ArrowUpDown className="w-3 h-3 opacity-30" />
                    )}
                  </span>
                </th>
              ))}
              <th className="px-4 py-3 text-left text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                Conflict
              </th>
              <th
                className="px-4 py-3 text-right text-[10px] font-extrabold uppercase tracking-wider text-slate-400"
                title="Open in prereq map / detail"
              >
                Open
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr
                key={m.studentId}
                onClick={() => onJumpToPrereq(m.studentId)}
                title={`Open ${m.name}'s prereq map`}
                className="border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors"
              >
                <td className="px-4 py-3 font-mono text-xs">{m.studentId}</td>
                <td className="px-4 py-3 font-bold">{m.name}</td>
                <td className="px-4 py-3 text-slate-300">{m.major}</td>
                <td className="px-4 py-3 text-slate-300 font-mono text-xs">
                  {m.email || <span className="text-slate-500">—</span>}
                </td>
                <td className="px-4 py-3 text-slate-300 font-mono text-xs">
                  {m.nationalId || <span className="text-slate-500">—</span>}
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-200 border border-blue-500/30 text-[10px] font-extrabold uppercase tracking-wider">
                    {m.level}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`font-mono font-bold ${
                      m.gpa >= 3.5 ? 'text-emerald-400' : m.gpa >= 2.0 ? 'text-amber-300' : 'text-rose-400'
                    }`}
                  >
                    {m.gpa.toFixed(2)}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-right" title={COLUMNS.find((c) => c.key === 'totalUnitsAll')?.hint}>
                  {m.totalUnits + m.totalFailedUnits}
                </td>
                <td className="px-4 py-3 font-mono text-right" title="Passed credits (excludes failed)">
                  {m.totalUnits}
                </td>
                <td className="px-4 py-3 font-mono text-right" title={COLUMNS.find((c) => c.key === 'plannedHoursActiveTerm')?.hint}>
                  {(() => {
                    const hours = plannedHoursByStudent[m.studentId] ?? 0;
                    // Show an em-dash when the student has no entry
                    // on the active term so the column reads the same
                    // as "no data" cells elsewhere in the table.
                    const hasEntry = state.terms
                      .find((t) => t.id === state.activeTermId)
                      ?.entries.some((e) => e.studentId === m.studentId);
                    if (!hasEntry) return <span className="text-slate-500">—</span>;
                    if (hours === 0) return <span className="text-slate-500">0</span>;
                    // Tint non-zero plans blue so the adviser can spot
                    // students with a pending load on the active term
                    // at a glance — matches the palette used for
                    // "active term" cues elsewhere in the app.
                    return <span className="text-blue-300 font-bold">{hours}</span>;
                  })()}
                </td>
                <td className="px-4 py-3">
                  {m.failedCourseCodes.length === 0 ? (
                    <span className="text-slate-500 text-xs">—</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 text-xs font-bold">
                      <AlertTriangle className="w-3 h-3" />
                      {m.failedCourseCodes.length}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {m.missingPrereqsForNextTerm.length === 0 ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 text-xs font-bold">
                      <CheckCircle2 className="w-3 h-3" />
                      0
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 text-xs font-bold">
                      {m.missingPrereqsForNextTerm.length}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {m.hasPlannedConflict ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 text-[10px] font-bold uppercase tracking-wider">
                      <AlertTriangle className="w-3 h-3" /> Conflict
                    </span>
                  ) : (
                    <span className="text-slate-500 text-xs">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {/* Secondary actions — clicking these does NOT fire
                      the row's onClick (we stopPropagation) so the user
                      can open the detail modal without also jumping
                      to the prereq map. */}
                  <div className="inline-flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveStudentId(m.studentId);
                      }}
                      title={`Open ${m.name}'s detail`}
                      className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-colors cursor-pointer"
                    >
                      <Info className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onJumpToPrereq(m.studentId);
                      }}
                      title={`Open ${m.name}'s prereq map`}
                      className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-blue-500/15 hover:bg-blue-500/25 text-blue-200 hover:text-white transition-colors cursor-pointer"
                    >
                      <Map className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 2} className="px-4 py-12 text-center text-slate-500">
                  No students in the roster yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <StudentDetailModal
        studentId={activeStudentId}
        onClose={() => setActiveStudentId(null)}
      />
    </>
  );
}

function compareMetrics(
  a: StudentMetrics,
  b: StudentMetrics,
  key: SortKey,
  plannedHoursByStudent: Record<string, number> = {}
): number {
  switch (key) {
    case 'gpa':
    case 'totalUnits':
      return a[key] - b[key];
    case 'totalUnitsAll': {
      // Total credits attempted = passed + failed. Sort by the
      // combined value so the row with the heaviest attempted load
      // floats to whichever end the user picked.
      return a.totalUnits + a.totalFailedUnits - (b.totalUnits + b.totalFailedUnits);
    }
    case 'plannedHoursActiveTerm': {
      // Default 0 for students with no entry on the active term —
      // they sort to the same place as students who planned zero-
      // credit courses. Sort direction decides which end they land on.
      const av = plannedHoursByStudent[a.studentId] ?? 0;
      const bv = plannedHoursByStudent[b.studentId] ?? 0;
      return av - bv;
    }
    case 'failedCourseCodes':
      return a.failedCourseCodes.length - b.failedCourseCodes.length;
    case 'missingPrereqsForNextTerm':
      return a.missingPrereqsForNextTerm.length - b.missingPrereqsForNextTerm.length;
    case 'studentId':
      return a.studentId.localeCompare(b.studentId);
    case 'name':
      return a.name.localeCompare(b.name);
    case 'major':
      return a.major.localeCompare(b.major);
    case 'email':
      // Empty emails sort to the end regardless of direction so the
      // table doesn't get cluttered with em-dash rows at the top.
      if (!a.email && !b.email) return 0;
      if (!a.email) return 1;
      if (!b.email) return -1;
      return a.email.localeCompare(b.email);
    case 'nationalId':
      if (!a.nationalId && !b.nationalId) return 0;
      if (!a.nationalId) return 1;
      if (!b.nationalId) return -1;
      return a.nationalId.localeCompare(b.nationalId);
    case 'level':
      // Sort by the underlying credit threshold so Level 0 < Level 1
      // < ... < Graduated. ERROR sorts to the end.
      const order = (s: StudentMetrics['level']) => {
        switch (s) {
          case 'Level 0': return 0;
          case 'Level 1': return 1;
          case 'Level 2': return 2;
          case 'Level 3': return 3;
          case 'Level 4': return 4;
          case 'Graduated': return 5;
          case 'ERROR': return 6;
        }
      };
      return order(a.level) - order(b.level);
  }
}