/**
 * AdvisingPanel — v2.
 *
 * Right-hand collapsible panel with four tabs, one per advising query.
 * The "Planned conflict" tab is a v2 placeholder because plan import
 * is deferred.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Link2,
  ListChecks,
  Printer,
  Search,
  Sparkles,
  TrendingDown,
  UserSearch,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useData } from '../data/DataContext';
import type { AdvisingResultRow, RosterEntry } from '../data/types';
import { normalizeCourseCodeLoose } from '../data/normalize';
import { getAvailableMajors } from '../data/filters';
import { downstreamCoursesFor, failureStats, type CourseFailureRow, type DownstreamCourse } from '../data/advising';
import { triggerPrint, usePrint } from './PrintContext';
import { resolveStudentNames } from './shared/leaderboardStudents';
import {
  catalogMajorsFor,
  resolveMajorIndex,
  semesterForMajor,
} from '../data/majorIndex';
import CourseCombobox from './CourseCombobox';

type Tab = 'failed' | 'blocked' | 'suggest' | 'conflict' | 'stats';

const TABS: Array<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: 'failed', label: 'Failed', icon: UserSearch },
  { id: 'blocked', label: 'Blocked', icon: Users },
  { id: 'suggest', label: 'Suggest', icon: Sparkles },
  { id: 'stats', label: 'Failure Stats', icon: BarChart3 },
  { id: 'conflict', label: 'Conflict', icon: AlertTriangle },
];

/** Status group definitions used by SuggestTab. */
const GROUP_ORDER: Array<{
  key: 'failed-prereq' | 'blocked' | 'open';
  label: string;
  chip: string;
}> = [
  { key: 'failed-prereq', label: 'Failed prereq', chip: 'bg-rose-500/20 text-rose-200 border-rose-500/30' },
  { key: 'blocked', label: 'Blocked', chip: 'bg-teal-500/20 text-teal-200 border-teal-500/30' },
  { key: 'open', label: 'Open', chip: 'bg-blue-500/20 text-blue-200 border-blue-500/30' },
];

export default function AdvisingPanel() {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<Tab>('failed');

  return (
    <aside
      className={`shrink-0 border-l border-white/10 bg-slate-950/80 backdrop-blur-md flex flex-col transition-all duration-300 ${
        open ? 'w-[28rem]' : 'w-12'
      }`}
    >
      <div className="flex items-center justify-between p-3 border-b border-white/10">
        {open ? (
          <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-blue-400" /> Advising Queries
          </span>
        ) : null}
        <button
          onClick={() => setOpen((v) => !v)}
          className="p-1.5 hover:bg-white/10 rounded text-slate-300 cursor-pointer"
          title={open ? 'Collapse panel' : 'Expand panel'}
        >
          {open ? '›' : '‹'}
        </button>
      </div>
      {open && (
        <>
          <div className="flex border-b border-white/10">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex-1 px-2 py-3 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                  tab === id
                    ? 'text-blue-300 border-b-2 border-blue-400 bg-blue-500/5'
                    : 'text-slate-400 hover:text-slate-200 border-b-2 border-transparent'
                }`}
                title={label}
              >
                <Icon className="w-4 h-4 mx-auto mb-1" />
                <span className="block truncate">{label}</span>
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {tab === 'failed' && <FailedTab />}
            {tab === 'blocked' && <BlockedTab />}
            {tab === 'suggest' && <SuggestTab />}
            {tab === 'stats' && <StatsTab />}
            {tab === 'conflict' && <ConflictTab />}
          </div>
        </>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Tab bodies
// ---------------------------------------------------------------------------

function FailedTab() {
  const { query, metricsByStudent, state, studentCount } = useData();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [major, setMajor] = useState('all');

  // Major dropdown sourced from the loaded roster (so roster-only
  // students are represented too). Built from metricsByStudent which
  // already merges roster + grade-book.
  const majors = useMemo(
    () => getAvailableMajors(Object.values(metricsByStudent)),
    [metricsByStudent]
  );

  const results = useMemo(() => {
    const trimmedCode = normalizeCourseCodeLoose(code);
    if (!trimmedCode) return [];
    return query({ kind: 'failed-course', courseCode: trimmedCode, studentName: name, major });
  }, [code, name, major, query]);

  if (studentCount === 0) {
    return <EmptyHint text="Import a grade-book first." />;
  }

  const emptyHint =
    code.trim().length === 0
      ? 'Pick a course above.'
      : name.trim() || major !== 'all'
        ? 'No students match these filters.'
        : 'No students failed this course.';

  return (
    <div className="space-y-3">
      <CourseCombobox
        label="Course"
        courses={state.catalog?.courses ?? []}
        value={code}
        onChange={setCode}
      />

      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
        Student name
      </label>
      <div className="relative">
        <UserSearch className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-500" />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Search by name..."
          className="w-full bg-slate-950 border border-white/10 rounded-lg py-2 pl-9 pr-3 text-xs text-white outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
        Student major
      </label>
      <select
        value={major}
        onChange={(e) => setMajor(e.target.value)}
        className="w-full bg-slate-950 border border-white/10 rounded-lg px-2 py-2 text-xs text-white outline-none focus:ring-1 focus:ring-blue-500"
      >
        <option value="all">All majors</option>
        {majors.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>

      <ResultList
        results={results}
        emptyHint={emptyHint}
      />
    </div>
  );
}

function BlockedTab() {
  const { query, studentCount } = useData();
  const results = useMemo(() => query({ kind: 'blocked-next-term' }), [query]);
  if (studentCount === 0) return <EmptyHint text="Import a grade-book first." />;
  return (
    <ResultList
      results={results}
      emptyHint="No students are blocked on their major's plan."
    />
  );
}

function SuggestTab() {
  const { query, metricsByStudent, state } = useData();
  const [studentId, setStudentId] = useState('');
  const [pickedCourse, setPickedCourse] = useState('');

  const studentIds = useMemo(
    () => Object.values(metricsByStudent).map((m) => ({ id: m.studentId, label: `${m.name} (${m.studentId})` })),
    [metricsByStudent]
  );

  const results = useMemo(() => {
    if (!studentId) return [];
    return query({ kind: 'suggest-next-registration', studentId });
  }, [studentId, query]);

  // When a course is picked from the dropdown, filter the suggestion
  // rows down to that one course. Empty pick = show full grouped list.
  const filteredResults = useMemo(() => {
    if (!pickedCourse) return results;
    const pickedNorm = normalizeCourseCodeLoose(pickedCourse);
    return results.filter((r) => {
      // `detail` carries `code — title — status`; parse the code back out.
      const code = r.detail.split(' — ')[0]?.trim();
      return code && normalizeCourseCodeLoose(code) === pickedNorm;
    });
  }, [results, pickedCourse]);

  if (studentIds.length === 0) return <EmptyHint text="Import a grade-book first." />;

  const metric = metricsByStudent[studentId];
  const semester = metric?.currentSemester;
  // Counts come from the first row's groupCounts envelope (attached by
  // the dispatcher). When there are no rows there is no envelope — we
  // fall back to all zeros so the badges stay present-but-empty.
  const counts = results[0]?.groupCounts ?? { open: 0, blocked: 0, 'failed-prereq': 0 };

  // Group the (possibly filtered) rows so each status section renders
  // together. When a course is picked we also recompute counts for the
  // filtered subset so the badges reflect "1 of 1" rather than the full
  // totals.
  const grouped = useMemo(() => {
    const out: Record<'failed-prereq' | 'blocked' | 'open', AdvisingResultRow[]> = {
      'failed-prereq': [],
      blocked: [],
      open: [],
    };
    for (const r of filteredResults) {
      if (r.groupKey) out[r.groupKey].push(r);
    }
    return out;
  }, [filteredResults]);

  const filteredCounts = {
    open: grouped.open.length,
    blocked: grouped.blocked.length,
    'failed-prereq': grouped['failed-prereq'].length,
  };

  return (
    <div className="space-y-3">
      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
        Pick a student
      </label>
      <select
        value={studentId}
        onChange={(e) => setStudentId(e.target.value)}
        className="w-full bg-slate-950 border border-white/10 rounded-lg px-2 py-2 text-xs text-white outline-none focus:ring-1 focus:ring-blue-500"
      >
        <option value="">-- select --</option>
        {studentIds.map((s) => (
          <option key={s.id} value={s.id}>{s.label}</option>
        ))}
      </select>

      <CourseCombobox
        label="Focus on a course"
        courses={state.catalog?.courses ?? []}
        value={pickedCourse}
        onChange={setPickedCourse}
      />

      {studentId && metric && (
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
          Currently in semester {semester}
        </div>
      )}

      {results.length === 0 && studentId && (
        <EmptyHint text="No open or blocked catalog courses for this student." />
      )}

      {pickedCourse && filteredResults.length === 0 && results.length > 0 && (
        <EmptyHint text={`This student has no suggestion for ${normalizeCourseCodeLoose(pickedCourse)}.`} />
      )}

      {filteredResults.length > 0 && (
        <div className="space-y-4">
          {GROUP_ORDER.map((g) => {
            const rows = grouped[g.key];
            if (rows.length === 0) return null;
            // When a course is picked, the visible count matches the
            // group; otherwise we show the full-count from the
            // dispatcher envelope.
            const visibleCount = pickedCourse ? filteredCounts[g.key] : counts[g.key];
            return (
              <div key={g.key} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${g.chip}`}
                  >
                    {g.label}
                  </span>
                  <span className="text-[10px] font-mono text-slate-500">
                    ({visibleCount})
                  </span>
                </div>
                {rows.map((r, idx) => {
                  const impact =
                    r.groupKey === 'failed-prereq' ? r.blockingImpact ?? 0 : 0;
                  return (
                    <div
                      key={`${r.detail}-${idx}`}
                      className="bg-white/5 border border-white/10 rounded-xl p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-mono font-bold text-blue-200">{r.detail}</div>
                        {impact > 0 && (
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border bg-rose-500/15 text-rose-200 border-rose-500/30">
                            blocks {impact}
                          </span>
                        )}
                      </div>
                      {r.items?.map((it, i) => (
                        <div key={i} className="text-[11px] text-slate-400 mt-1">{it}</div>
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ConflictTab() {
  const { state, query, studentCount } = useData();
  const results = useMemo(
    () => query({ kind: 'planned-conflict' }),
    [query]
  );

  if (studentCount === 0) {
    return <EmptyHint text="Import a grade-book first." />;
  }

  if (state.plans.length === 0) {
    return (
      <div className="space-y-3">
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-xs text-amber-200 leading-relaxed">
          <strong className="block mb-1">No plans yet.</strong>
          Open the Prereq Map tab and click course cards to add them to a
          student's plan. Plans save automatically and surface here as
          conflicts when a previously failed course is included.
        </div>
      </div>
    );
  }

  return (
    <ResultList
      results={results}
      emptyHint="No conflicts. No plan currently includes a course the student previously failed."
    />
  );
}

function StatsTab() {
  const { state, studentCount } = useData();
  const { setActiveTree } = usePrint();
  // Use a query so the tab re-runs when the grade-book changes — and
  // so the catalog is already in the right shape.
  const stats = useMemo(
    () => failureStats(state.rows, state.catalog, state.roster),
    [state.rows, state.catalog, state.roster]
  );

  // Discover the catalog's majors[] column (assumed identical on every
  // row) so the adviser can pick a major to drive the "sem N" chips
  // next to each course code. Falls back to an empty list when the
  // catalog doesn't expose majors — then no semester chips render.
  const catalogMajors = useMemo(
    () => (state.catalog && state.catalog.courses.length > 0
      ? catalogMajorsFor(state.catalog.courses[0])
      : undefined),
    [state.catalog]
  );
  const sortedCatalogMajors = useMemo(
    () => (catalogMajors ? [...catalogMajors].sort((a, b) => a.localeCompare(b)) : []),
    [catalogMajors]
  );

  // The adviser picks a major to read semester numbers for. Default
  // to the first catalog major (alphabetical) so chips render on first
  // paint rather than appearing empty.
  const [majorPick, setMajorPick] = useState<string>(() => sortedCatalogMajors[0] ?? '');
  // Re-seed when the catalog changes (e.g. user imports a different
  // workbook) so the pick always refers to a major that exists.
  useEffect(() => {
    if (sortedCatalogMajors.length === 0) {
      if (majorPick !== '') setMajorPick('');
      return;
    }
    if (!sortedCatalogMajors.includes(majorPick)) {
      setMajorPick(sortedCatalogMajors[0]);
    }
  }, [sortedCatalogMajors, majorPick]);

  const majorIdx = useMemo(() => {
    if (!catalogMajors || majorPick === '') return -1;
    return resolveMajorIndex(majorPick, catalogMajors).index;
  }, [catalogMajors, majorPick]);

  // Look up the catalog row for each failed course once. Drives the
  // "sem N" chip on the leaderboard row and would also drive a future
  // credits/load indicator if we add one.
  const courseByCode = useMemo(() => {
    const m = new Map<string, NonNullable<typeof state.catalog>['courses'][number]>();
    if (!state.catalog) return m;
    for (const c of state.catalog.courses) {
      const code = normalizeCourseCodeLoose(c.code);
      if (code) m.set(code, c);
    }
    return m;
  }, [state.catalog]);

  if (studentCount === 0) {
    return <EmptyHint text="Import a grade-book first." />;
  }

  if (stats.leaderboard.length === 0) {
    return <EmptyHint text="No failures in the grade-book. Everyone is passing." />;
  }

  const maxCount = stats.leaderboard[0].count;

  // Active term — used to build a sensible filename for the plan
  // table print so the browser's "Save as PDF" dialog defaults to
  // something the adviser can find later. Falls back to a generic
  // string when there's no active term.
  const activeTerm = useMemo(
    () => state.terms.find((t) => t.id === state.activeTermId) ?? null,
    [state.terms, state.activeTermId]
  );
  const activeTermName = activeTerm?.name ?? 'Plan summary';
  // Disabled when there's no active term — the print tree would
  // render an empty hint anyway but the button being greyed out
  // tells the user WHY there's nothing to print.
  const planPrintDisabled = !activeTerm;

  return (
    <div className="space-y-4">
      {/* Major picker — drives the "sem N" chips on each course row.
          Hidden when the catalog has no majors[] column. */}
      {sortedCatalogMajors.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0">
            Major
          </span>
          <select
            value={majorPick}
            onChange={(e) => setMajorPick(e.target.value)}
            className="flex-1 bg-slate-950 border border-white/10 rounded px-2 py-1.5 text-xs text-white outline-none focus:ring-1 focus:ring-blue-500"
            title="Major that drives the semester chips"
          >
            {sortedCatalogMajors.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {/* Print report — Shell mounts <FailureReportPrint /> on demand
              via the PrintContext. The current `majorPick` is
              passed in the payload so the printed report reflects
              whatever the user has picked in the dropdown above. */}
          <button
            onClick={() =>
              triggerPrint(setActiveTree, 'failure-report', { majorPick })
            }
            title="Print the failure report (light theme)"
            className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-slate-200 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border border-white/10 transition-all cursor-pointer active:scale-95 shrink-0"
          >
            <Printer className="w-3 h-3" />
            <span>Print</span>
          </button>
        </div>
      )}

      {/* Print row — printed artefacts available from the Failure
          Stats tab: the existing failure report, plus the new plan
          summary table (added in v2) that rolls current GPA, total
          hours, and the planned New / Repeated / Enhancing credit
          breakdown across every student who planned at least one
          course on the active term.

          When the catalog has no majors[] the failure-report button
          is on its own row above; this row always renders so the two
          print buttons sit together on screen. */}
      <div className="flex items-center justify-end gap-2 flex-wrap">
        {sortedCatalogMajors.length === 0 && (
          <button
            onClick={() =>
              triggerPrint(setActiveTree, 'failure-report', { majorPick })
            }
            title="Print the failure report (light theme)"
            className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-slate-200 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border border-white/10 transition-all cursor-pointer active:scale-95"
          >
            <Printer className="w-3 h-3" />
            <span>Print report</span>
          </button>
        )}
        {/* Plan table — opens the new PlanTablePrint tree. Distinct
            from "Print report" (which prints the failure breakdown)
            and from "Print all forms" in the header (which prints
            one NMU registration form per student). Disabled when no
            term is active. */}
        <button
          onClick={() =>
            triggerPrint(setActiveTree, 'plan-table', {
              title: `Plan summary - ${activeTermName}`,
            })
          }
          disabled={planPrintDisabled}
          title={
            planPrintDisabled
              ? 'Create a term first'
              : `Print a tabular roll-up of every student planned on ${activeTermName}`
          }
          className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-slate-200 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border border-white/10 transition-all cursor-pointer active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white/5"
        >
          <Printer className="w-3 h-3" />
          <span>Print plan table</span>
        </button>
      </div>

      {/* Summary header — at-a-glance totals. */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard
          label="Students with ≥1 failure"
          value={`${stats.totalStudentsWithFailure} / ${stats.totalStudents}`}
        />
        <StatCard
          label="Distinct failed courses"
          value={String(stats.leaderboard.length)}
        />
        <StatCard
          label="Most-failed course"
          value={`${stats.leaderboard[0].courseCode} (${stats.leaderboard[0].count})`}
        />
      </div>

      {/* Distribution buckets */}
      <section>
        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
          Failure distribution
        </h3>
        <div className="grid grid-cols-3 gap-2">
          {stats.distribution.map((d) => (
            <div
              key={d.label}
              className="bg-white/5 border border-white/10 rounded-lg p-2 text-center"
            >
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                {d.label}
              </div>
              <div className="text-lg font-mono font-bold text-rose-200 mt-1">
                {d.count}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Leaderboard */}
      <section>
        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
          Top failed courses
        </h3>
        <div className="space-y-2">
          {stats.leaderboard.map((row) => {
            const course = courseByCode.get(row.courseCode);
            const semester =
              majorIdx >= 0 && course
                ? semesterForMajor(course, majorIdx, catalogMajors)
                : 0;
            // Downstream: every catalog course that lists this code as
            // a prereq. Computed once per row so the row stays cheap
            // to render on the full list. Empty list = this course
            // doesn't lock anything else; the row shows a hint.
            const downstream = downstreamCoursesFor(
              state.catalog,
              row.courseCode,
              majorIdx,
              catalogMajors
            );
            return (
              <LeaderboardRow
                key={row.courseCode}
                row={row}
                maxCount={maxCount}
                roster={state.roster}
                semester={semester}
                downstream={downstream}
              />
            );
          })}
        </div>
      </section>

      {/* Per-student totals */}
      {stats.studentsByFailureCount.length > 0 && (
        <section>
          <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
            Students by failure count
          </h3>
          <div className="space-y-1">
            {stats.studentsByFailureCount.map((s) => (
              <div
                key={s.studentId}
                className="flex items-center justify-between gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs"
              >
                <span className="text-white truncate">{s.studentName}</span>
                <span className="text-[10px] font-mono text-slate-500 shrink-0">
                  {s.studentId}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border bg-rose-500/15 text-rose-200 border-rose-500/30">
                  {s.count} {s.count === 1 ? 'failure' : 'failures'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Compact stat card for the top-of-tab summary row. */
function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-lg p-2">
      <div className="text-[9px] uppercase tracking-wider text-slate-500 font-bold leading-tight">
        {label}
      </div>
      <div className="text-sm font-mono font-bold text-blue-200 mt-1 truncate">{value}</div>
    </div>
  );
}

/**
 * Palette of distinct chip colours rotated by downstream-course index
 * so each blocked course stands out at a glance. We keep the list
 * short on purpose — six hues is more than enough for a typical
 * Mechanical / Civil / Aero prereq chain.
 */
const DOWNSTREAM_CHIP_COLORS: Array<{ bg: string; text: string; border: string }> = [
  { bg: 'bg-violet-500/15',  text: 'text-violet-200',  border: 'border-violet-500/30' },
  { bg: 'bg-amber-500/15',   text: 'text-amber-200',   border: 'border-amber-500/30' },
  { bg: 'bg-sky-500/15',     text: 'text-sky-200',     border: 'border-sky-500/30' },
  { bg: 'bg-emerald-500/15', text: 'text-emerald-200', border: 'border-emerald-500/30' },
  { bg: 'bg-pink-500/15',    text: 'text-pink-200',    border: 'border-pink-500/30' },
  { bg: 'bg-cyan-500/15',    text: 'text-cyan-200',    border: 'border-cyan-500/30' },
];

/**
 * One row in the leaderboard — bar + count + title + vertical student
 * list + downstream-courses block. The full student list is shown (no
 * preview cap) so the adviser can read every name when triaging a
 * course. The semester chip renders when the StatsTab has a major
 * selected and the catalog row carries a semester number for that
 * major. Downstream chips render in distinct colours keyed by index so
 * the same code in the same row always shows in the same colour.
 */
function LeaderboardRow({
  row,
  maxCount,
  roster,
  semester,
  downstream,
}: {
  row: CourseFailureRow;
  maxCount: number;
  roster: RosterEntry[];
  semester: number;
  downstream: DownstreamCourse[];
}) {
  const pct = maxCount === 0 ? 0 : Math.round((row.count / maxCount) * 100);
  // Look up names once so the vertical list reads as "Sara Khan"
  // rather than "S1". Shared with the printed failure report — see
  // shared/leaderboardStudents.ts.
  const studentNames = resolveStudentNames(row.studentIds, roster);
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-2">
      {/* Header: code + title + semester chip + count chip */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <TrendingDown className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-mono font-extrabold text-blue-200">
                {row.courseCode}
              </span>
              {semester > 0 && (
                <span
                  className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-blue-500/15 text-blue-200 border-blue-500/30 shrink-0"
                  title={`Semester on selected major's plan`}
                >
                  sem {semester}
                </span>
              )}
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border bg-rose-500/15 text-rose-200 border-rose-500/30 shrink-0">
                {row.count} {row.count === 1 ? 'student' : 'students'}
              </span>
            </div>
            {row.courseTitle && (
              <div className="text-xs text-slate-300 mt-1">{row.courseTitle}</div>
            )}
          </div>
        </div>
      </div>

      {/* Bar — visual ranking cue. */}
      <div className="h-1.5 bg-white/5 rounded overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-rose-500 to-rose-400"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Downstream block — every catalog course that lists this one
          as a prereq. Each downstream course gets its own chip colour
          (rotating palette, keyed by index) plus a "sem N" badge when
          a major is selected. Empty list → "no downstream courses"
          hint so the adviser knows we computed it, not that we forgot. */}
      <div className="border-t border-white/5 pt-2">
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
          <Link2 className="w-3 h-3" />
          <span>Blocks downstream</span>
          <span className="text-slate-600 normal-case tracking-normal">
            ({downstream.length})
          </span>
        </div>
        {downstream.length === 0 ? (
          <p className="text-[10px] text-slate-500 italic">
            No catalog course lists this as a prerequisite.
          </p>
        ) : (
          <ul className="space-y-1">
            {downstream.map((d, i) => {
              const palette =
                DOWNSTREAM_CHIP_COLORS[i % DOWNSTREAM_CHIP_COLORS.length];
              return (
                <li
                  key={d.courseCode}
                  className={`flex items-center justify-between gap-2 px-2 py-1 rounded-md border ${palette.bg} ${palette.border}`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span
                      className={`font-mono font-bold text-[11px] ${palette.text}`}
                    >
                      {d.courseCode}
                    </span>
                    {d.courseTitle && (
                      <span className="text-[11px] text-slate-300 truncate">
                        — {d.courseTitle}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {d.semester > 0 && (
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${palette.bg} ${palette.border} ${palette.text}`}
                        title={`Semester on selected major's plan`}
                      >
                        sem {d.semester}
                      </span>
                    )}
                    {d.credits > 0 && (
                      <span className="text-[10px] font-mono text-slate-400">
                        {d.credits}cr
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Full vertical student list — the user wants every name
          visible, not a 3-name preview. */}
      {studentNames.length > 0 && (
        <ul className="mt-1 space-y-0.5 border-t border-white/5 pt-1.5">
          {studentNames.map((name, i) => (
            <li
              key={row.studentIds[i]}
              className="flex items-center justify-between gap-2 text-xs text-slate-200"
            >
              <span className="truncate flex-1">{name}</span>
              <span className="text-[10px] font-mono text-slate-500 shrink-0">
                {row.studentIds[i]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ResultList({ results, emptyHint }: { results: AdvisingResultRow[]; emptyHint: string }) {
  if (results.length === 0) return <EmptyHint text={emptyHint} />;
  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
        {results.length} match(es)
      </p>
      {results.map((r, idx) => (
        <div key={`${r.studentId}-${idx}`} className="bg-white/5 border border-white/10 rounded-xl p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-bold text-white">{r.studentName}</div>
              <div className="text-[10px] text-slate-500 font-mono">{r.studentId} · {r.major}</div>
            </div>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          </div>
          <div className="mt-2 text-[11px] text-slate-300">{r.detail}</div>
          {r.items && r.items.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {r.items.map((it, i) => (
                <li key={i} className="text-[10px] text-slate-400 font-mono">{it}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="text-center text-slate-500 text-xs py-12 px-4">
      <Search className="w-6 h-6 mx-auto mb-2 opacity-50" />
      <p>{text}</p>
    </div>
  );
}