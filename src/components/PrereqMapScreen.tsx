/**
 * PrereqMapScreen — v2.
 *
 * Personalized prerequisite map. Top: prev/next buttons + student
 * picker + name/major strip. Body: 10 semester rows stacked
 * vertically; each row lays its courses out horizontally (code +
 * title + status badge + inline prereq list). Each course card lists
 * its declared prereqs in a footer chip row so the dependency
 * relationships are visible at a glance — no SVG arrows needed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowLeftCircle,
  ArrowRightCircle,
  BookmarkCheck,
  CheckCircle2,
  XCircle,
  Lock,
  Circle,
  Filter,
  GraduationCap,
  Moon,
  Printer,
  RotateCcw,
  Search,
  Settings2,
  Sun,
  X,
  Clock,
  CreditCard,
  Upload,
  Check,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import { useData } from '../data/DataContext';
import { useAuth } from '../auth/AuthContext';
import { updateStudentSisStatusInCloud, pushMyDataToCloud, pushMasterDataToCloud } from '../data/cloudSync';
import {
  buildPrereqMap,
  type CourseMapStatus,
  type MappedCourse,
} from '../data/prereqMap';
import type { CourseCatalog, StudentMetrics, Term, TermEntry } from '../data/types';
import { normalizeCourseCodeLoose } from '../data/normalize';
import {
  applyMapFilters,
  DEFAULT_FILTERS,
  getAvailableMajors,
  isFiltersEmpty,
  type MapFilters,
  type ProgressFilter,
} from '../data/filters';
import { StatsCard, StatsRow } from './shared/StatsCard';
import { buildCreditByCode, computePlanStats } from './shared/planStats';
import { gpaToken } from './shared/colorTokens';
import { formatGradeWithPoints, gradeTextToken } from './shared/formatGrade';
import { SCREEN_COLOR_CLASS } from './shared/colorTokens';
import TermManagerModal from './TermManagerModal';
import StudentCombobox from './StudentCombobox';
import { triggerPrint, usePrint } from './PrintContext';
import { canScheduleAll, getAllCombinationsForCourse } from './shared/scheuldeHelpers';


const STATUS_STYLES: Record<
  CourseMapStatus,
  { border: string; bg: string; text: string; icon: LucideIcon; label: string }
> = {
  passed: {
    border: 'border-emerald-500/40',
    bg: 'bg-emerald-500/15',
    text: 'text-emerald-200',
    icon: CheckCircle2,
    label: 'Passed',
  },
  // The student attempted AND failed this course — deep rose.
  failed: {
    border: 'border-rose-600/60',
    bg: 'bg-rose-600/15',
    text: 'text-rose-200',
    icon: XCircle,
    label: 'Failed',
  },
  // The student has not attempted this course, but a prereq was
  // failed. Distinct shade (lighter rose) so the eye can tell at a
  // glance that the problem is upstream, not on this card.
  'failed-prereq': {
    border: 'border-pink-500/50',
    bg: 'bg-pink-500/15',
    text: 'text-pink-200',
    icon: AlertTriangle,
    label: 'Prereq failed',
  },
  // Prereqs are merely missing (never attempted) — teal.
  blocked: {
    border: 'border-teal-500/50',
    bg: 'bg-teal-500/15',
    text: 'text-teal-200',
    icon: Lock,
    label: 'Blocked',
  },
  open: {
    border: 'border-blue-500/40',
    bg: 'bg-blue-500/15',
    text: 'text-blue-200',
    icon: Circle,
    label: 'Open',
  },
  planned: {
    border: 'border-fuchsia-500/60',
    bg: 'bg-fuchsia-500/15',
    text: 'text-fuchsia-200',
    icon: BookmarkCheck,
    label: 'Planned',
  },
  'in-program': {
    border: 'border-white/10',
    bg: 'bg-white/5',
    text: 'text-slate-300',
    icon: Circle,
    label: 'Other major',
  },
  closed: {
    border: 'border-slate-500/40',
    bg: 'bg-slate-500/15',
    text: 'text-slate-400',
    icon: Lock,
    label: 'Closed',
  },
  contradiction: {
    border: 'border-purple-500/50',
    bg: 'bg-purple-500/15',
    text: 'text-purple-200',
    icon: AlertTriangle,
    label: 'Contradiction',
  },
};

/**
 * Per-card style overrides for the three plan categories
 * (New / Enhancing / Repeated). Each is a *complete* card style
 * (border + bg + text + ring) that takes precedence over the
 * prereq-derived status so a "repeated" course on the plan does NOT
 * look like a regular failure card.
 *
 * Palette picks (chose for both dark- and light-mode contrast):
 *   - new       → violet  (cool, "fresh start")
 *   - enhancing → cyan    (cool, "topping up")
 *   - repeated  → orange  (warm, "needs attention")
 */
type PlanClassification = NonNullable<MappedCourse['planClassification']>;
const PLAN_CARD_STYLES: Record<
  PlanClassification,
  { border: string; bg: string; text: string; ring: string; label: string }
> = {
  new: {
    border: 'border-violet-500/60',
    bg: 'bg-violet-500/15',
    text: 'text-violet-200',
    ring: 'ring-violet-400/60 shadow-violet-500/20',
    label: 'New',
  },
  enhancing: {
    border: 'border-cyan-500/60',
    bg: 'bg-cyan-500/15',
    text: 'text-cyan-200',
    ring: 'ring-cyan-400/60 shadow-cyan-500/20',
    label: 'Enhancing',
  },
  repeated: {
    border: 'border-orange-500/60',
    bg: 'bg-orange-500/15',
    text: 'text-orange-200',
    ring: 'ring-orange-400/60 shadow-orange-500/20',
    label: 'Repeated',
  },
};

export default function PrereqMapScreen({
  onBack,
  initialStudentId,
  onOpenTimetable,   // new
}: {
  onBack: () => void;
  /**
   * Optional student id to focus on mount. Used by the roster table
   * "open in map" action — when the user clicks a row, App navigates
   * here and passes the clicked id so this screen opens already
   * showing that student's prereq map. When the user navigates back
   * and re-opens without a fresh `initialStudentId`, the previously
   * chosen student stays put (we only seed the local state on the
   * first render via `useState`'s initial value).
   */
  initialStudentId?: string;
  onOpenTimetable?: (studentId: string) => void;
}) {
  const {
    state,
    metricsByStudent,
    toggleCourseInActiveTerm,
    addCourseToTerm,
    removeCourseFromTerm,
    clearTermForStudent,
    renameTerm,
    setActiveTerm,
    createTerm,
    getSessionsForCourse,
    getConflictingSessions,
    setEnforceSchedule,
    setScheduleTerm,
    setStudentGroup,
  } = useData();
  const { setActiveTree } = usePrint();
  const { cloudEnabled, user, profile } = useAuth();

  const [showTermManager, setShowTermManager] = useState(false);
  const [filters, setFilters] = useState<MapFilters>(DEFAULT_FILTERS);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle');

  const enforceSchedule = state.enforceSchedule ?? false;
  const scheduleTerm = state.scheduleTerm ?? '';
  const studentGroup = state.studentGroup ?? '';




  // Stable list of every student, sorted by name. Used as the input to
  // the filter helper AND to fall back to when the active student is
  // filtered out (we keep them rendered even if they don't match).
  const allStudents = useMemo(
    () =>
      Object.values(metricsByStudent).sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
    [metricsByStudent]
  );
  const [studentId, setStudentId] = useState<string>(
    initialStudentId ?? allStudents[0]?.studentId ?? ''
  );

  // Pick a sensible default when students load asynchronously.
  useEffect(() => {
    if (!studentId && allStudents.length > 0) setStudentId(allStudents[0].studentId);
  }, [allStudents, studentId]);

  const activeTerm = useMemo(
    () => state.terms.find((t) => t.id === state.activeTermId) ?? null,
    [state.terms, state.activeTermId]
  );

  const handleSave = useCallback(async () => {
    if (!user) return;
    setSaving('saving');
    try {
      if (profile?.role === 'master') {
        await pushMasterDataToCloud(state);
      } else {
        await pushMyDataToCloud(state, user.uid);
      }
      setSaving('saved');
      setTimeout(() => setSaving('idle'), 2000);
    } catch (err) {
      console.error('[Save] Failed to push data to cloud', err);
      setSaving('idle');
    }
  }, [state, user, profile]);

  // Lookup callback used by applyMapFilters — depends only on the
  // currently-active term, so we recreate it only when that changes.
  const activeTermEntryLookup = useCallback(
    (id: string): TermEntry | null => {
      if (!activeTerm) return null;
      return activeTerm.entries.find((e) => e.studentId === id) ?? null;
    },
    [activeTerm]
  );

  useEffect(() => {
    if (state.masterSchedule && !scheduleTerm) {
      const distinctTerms = [...new Set(state.masterSchedule.sessions.map(s => s.term))];
      setScheduleTerm(distinctTerms[0] ?? '');
    }
  }, [state.masterSchedule]);

  // Apply the filter on every render where inputs change. The
  // helper is cheap (a single linear pass) so we don't need
  // additional memoisation here — useMemo with the right deps is
  // already cheap.
  const filteredStudents = useMemo(
    () => applyMapFilters(allStudents, filters, activeTermEntryLookup),
    [allStudents, filters, activeTermEntryLookup]
  );

  // Prev/Next indices operate on the filtered list. When the active
  // student is filtered out, we still compute an index — we pick the
  // closest match (searching forward, then backward) so the next
  // press moves into the filtered set immediately rather than
  // getting stuck.
  const idxInFiltered = filteredStudents.findIndex((s) => s.studentId === studentId);
  const activeInFiltered = idxInFiltered >= 0;
  const canPrev =
    activeInFiltered
      ? idxInFiltered > 0
      : filteredStudents.length > 0 && allStudents.findIndex((s) => s.studentId === studentId) > 0;
  const canNext =
    activeInFiltered
      ? idxInFiltered < filteredStudents.length - 1
      : filteredStudents.length > 0 &&
      allStudents.findIndex((s) => s.studentId === studentId) < allStudents.length - 1;
  const prev = useCallback(() => {
    if (!canPrev) return;
    if (activeInFiltered) {
      setStudentId(filteredStudents[idxInFiltered - 1].studentId);
      return;
    }
    // Active student not in filtered set — walk the full list
    // backward from them, skipping non-matches.
    const activeIdx = allStudents.findIndex((s) => s.studentId === studentId);
    for (let i = activeIdx - 1; i >= 0; i--) {
      if (filteredStudents.some((s) => s.studentId === allStudents[i].studentId)) {
        setStudentId(allStudents[i].studentId);
        return;
      }
    }
  }, [
    canPrev,
    activeInFiltered,
    filteredStudents,
    idxInFiltered,
    allStudents,
    studentId,
  ]);
  const next = useCallback(() => {
    if (!canNext) return;
    if (activeInFiltered) {
      setStudentId(filteredStudents[idxInFiltered + 1].studentId);
      return;
    }
    const activeIdx = allStudents.findIndex((s) => s.studentId === studentId);
    for (let i = activeIdx + 1; i < allStudents.length; i++) {
      if (filteredStudents.some((s) => s.studentId === allStudents[i].studentId)) {
        setStudentId(allStudents[i].studentId);
        return;
      }
    }
  }, [
    canNext,
    activeInFiltered,
    filteredStudents,
    idxInFiltered,
    allStudents,
    studentId,
  ]);

  const metrics = studentId ? metricsByStudent[studentId] : undefined;
  const activeEntry = useMemo<TermEntry | null>(() => {
    if (!activeTerm || !studentId) return null;
    return activeTerm.entries.find((e) => e.studentId === studentId) ?? null;
  }, [activeTerm, studentId]);
  const plannedSet = useMemo(
    () => new Set((activeEntry?.courseCodes ?? []).map((c) => normalizeCourseCodeLoose(c))),
    [activeEntry]
  );
  const mapData = useMemo(
    () => {
      const data = buildPrereqMap(state.catalog, state.rows, studentId, metrics?.major, {
        courseCodes: activeEntry?.courseCodes ?? [],
      });

      if (enforceSchedule && state.masterSchedule) {
        const plannedCodes = Array.from(plannedSet);
        
        for (const col of data.semesters) {
          for (const course of col.courses) {
            if (!plannedSet.has(course.code)) {
              const sessions = getSessionsForCourse(course.code, scheduleTerm);
              if (sessions.length === 0) {
                course.status = 'closed';
              } else {
                const combos = getAllCombinationsForCourse(sessions, studentGroup);
                if (combos.length === 0) {
                  course.status = 'closed';
                } else {
                  // Check contradiction with already planned courses
                  const allCodes = [...plannedCodes, course.code];
                  const coursesToSchedule = allCodes.map(c => {
                    const sess = getSessionsForCourse(c, scheduleTerm);
                    if (sess.length === 0) return null;
                    const cCombos = getAllCombinationsForCourse(sess, studentGroup);
                    if (cCombos.length === 0) return null;
                    return { code: c, combos: cCombos };
                  });
                  
                  if (coursesToSchedule.some(c => c === null)) {
                    course.status = 'contradiction';
                  } else {
                    if (!canScheduleAll(coursesToSchedule as any, studentGroup)) {
                      course.status = 'contradiction';
                    }
                  }
                }
              }
            }
          }
        }
      }
      return data;
    },
    [state.catalog, state.rows, studentId, metrics?.major, activeEntry?.courseCodes, enforceSchedule, state.masterSchedule, scheduleTerm, studentGroup, getSessionsForCourse, plannedSet]
  );

  const handleCardClick = useCallback(
    (code: string) => {
      if (!studentId || !activeTerm) return;

      const course = mapData.semesters
        .flatMap(s => s.courses)
        .find(c => c.code === code);
      if (!course) return;

      const isPlanned = plannedSet.has(code);

      // 1. Always block blocked / failed‑prereq
      if (!isPlanned) {
        if (course.status === 'blocked') {
          setRejectionReason(`${code} is blocked because you haven't completed its prerequisites.`);
          return;
        }
        if (course.status === 'failed-prereq') {
          setRejectionReason(`${code} requires a prerequisite that you have failed. You must retake the failed prerequisite first.`);
          return;
        }
      }

      // 2. Schedule enforcement (only when toggle is ON and course not already planned)
      if (!isPlanned && enforceSchedule) {
        // if (!studentGroup) {
        //   setRejectionReason('Please select a student group before adding courses.');
        //   return;
        // }

        const plannedCodes = Array.from(plannedSet);
        const allCodes = [...plannedCodes, code]; // all courses that would be in the plan

        // Build data for each course: its code and all valid combos
        const coursesToSchedule = allCodes.map(c => {
          const sessions = getSessionsForCourse(c, scheduleTerm);
          if (sessions.length === 0) return null; // course not offered
          const combos = getAllCombinationsForCourse(sessions, studentGroup);
          if (combos.length === 0) return null; // no self‑consistent combo
          return { code: c, combos };
        });

        // If any course has no valid combos, can't add
        const missing = coursesToSchedule.findIndex(c => c === null);
        if (missing !== -1) {
          const missingCode = allCodes[missing];
          setRejectionReason(
            missingCode === code
              ? `${code} is not offered in the current schedule.`
              : `Cannot schedule all courses because ${missingCode} has no valid session combination for group ${studentGroup}.`
          );
          return;
        }

        // Run the global scheduler
        const feasible = canScheduleAll(coursesToSchedule as any[], studentGroup);
        if (!feasible) {
          setRejectionReason(
            `Adding ${code} would create unavoidable time conflicts with your already planned courses. No combination of sessions works for all courses together.`
          );
          return;
        }


      }
      console.log('schedule data:', state.masterSchedule)
      // 3. All checks passed → toggle
      toggleCourseInActiveTerm(activeTerm.id, studentId, code);
    },
    [
      studentId,
      activeTerm,
      mapData,
      plannedSet,
      enforceSchedule,
      studentGroup,
      scheduleTerm,
      getSessionsForCourse,
      toggleCourseInActiveTerm,
    ]
  );

  // Position text shown in the header next to Prev/Next.
  // Examples:
  //   "3 / 12"            (in filtered, no total — single-line legacy form)
  //   "1 / 5 of 47"       (in filtered, total also visible — matches count)
  //   "(out) 0 / 0"       (active student not in filtered set)
  const positionLabel = (() => {
    if (allStudents.length === 0) return '0 / 0';
    if (activeInFiltered) {
      const filteredOnly = isFiltersEmpty(filters);
      return filteredOnly
        ? `${idxInFiltered + 1} / ${filteredStudents.length}`
        : `${idxInFiltered + 1} / ${filteredStudents.length} of ${allStudents.length}`;
    }
    return `0 / 0 of ${allStudents.length}`;
  })();

  const availableMajors = useMemo(() => getAvailableMajors(allStudents), [allStudents]);

  return (
    <main className="flex-1 flex flex-col min-h-0 bg-slate-950">
      <header className="px-6 py-4 border-b border-white/10 flex items-center gap-4 bg-slate-950/80 backdrop-blur-md sticky top-0 z-20 flex-wrap">
        <div className="flex flex-col gap-4 w-full">
          <div className="">
            <StudentCombobox
              students={allStudents}
              value={studentId}
              onChange={setStudentId}
              label="Student"
            />
          </div>
          <div className="flex flex-row gap-4">
            <button
              onClick={onBack}
              className="flex items-center gap-2 text-slate-300 hover:text-white px-2 py-1.5 rounded-lg hover:bg-white/5 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-wider">Back</span>
            </button>

            {/* Prev/Next student — match the v1 keyboard-style control */}
            <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl px-1 py-1">
              <button
                onClick={prev}
                disabled={!canPrev}
                title="Previous student (in filtered list)"
                className={`p-1.5 rounded-lg cursor-pointer ${canPrev ? 'hover:bg-white/10 text-slate-200' : 'text-slate-600 cursor-not-allowed'
                  }`}
              >
                <ArrowLeftCircle className="w-4 h-4" />
              </button>
              <span
                className={`text-[10px] uppercase tracking-wider font-bold px-1 ${activeInFiltered ? 'text-slate-500' : 'text-amber-400'
                  }`}
              >
                {positionLabel}
              </span>
              <button
                onClick={next}
                disabled={!canNext}
                title="Next student (in filtered list)"
                className={`p-1.5 rounded-lg cursor-pointer ${canNext ? 'hover:bg-white/10 text-slate-200' : 'text-slate-600 cursor-not-allowed'
                  }`}
              >
                <ArrowRightCircle className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-extrabold tracking-tight truncate flex items-center gap-2">
                <GraduationCap className="w-5 h-5 text-blue-400 shrink-0" />
                <span className="truncate">
                  Prerequisite Map — {metrics?.name ?? 'No student'}
                </span>
              </h1>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">
                {metrics?.major ?? 'Undeclared'}
                {mapData.majorMismatch && (
                  <span className="ml-2 text-amber-400 normal-case tracking-normal">
                    · major not matched (showing {mapData.resolvedMajor ?? 'first available'})
                  </span>
                )}
              </p>
            </div>

            {/* SIS Status toggles — clear, color-coded buttons with icons */}
            {studentId && (
              <SisToggleButtons
                studentId={studentId}
              />
            )}



            {/* Term picker — every student shares the same named term.
            Switching terms swaps what the PlanPanel shows for this
            student, without touching any other student's entries. */}
            <div className="flex items-stretch rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/5 overflow-hidden">
              <BookmarkCheck className="w-3.5 h-3.5 text-fuchsia-300 m-auto ml-2.5" />
              <select
                value={activeTerm?.id ?? ''}
                onChange={(e) => setActiveTerm(e.target.value || null)}
                disabled={state.terms.length === 0}
                title="Active registration term"
                className="bg-transparent px-2 py-2 text-xs text-fuchsia-100 font-bold uppercase tracking-wider outline-none disabled:opacity-50 max-w-[10rem]"
              >
                {state.terms.length === 0 && <option value="">No terms</option>}
                {state.terms.map((t) => (
                  <option key={t.id} value={t.id} className="bg-slate-950 text-white">
                    {t.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setShowTermManager(true)}
                title="Manage terms"
                className="px-2 border-l border-fuchsia-500/30 text-fuchsia-200 hover:bg-fuchsia-500/10 cursor-pointer"
              >
                <Settings2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* … after the term picker div … */}
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none ml-4">
              <input
                type="checkbox"
                checked={enforceSchedule}
                onChange={(e) => setEnforceSchedule(e.target.checked)}
                className="accent-amber-500"
              />
              <span className="font-bold uppercase tracking-wider">Enforce schedule</span>
            </label>

            {state.masterSchedule && (
              <select
                value={studentGroup}
                onChange={(e) => setStudentGroup(e.target.value)}
                className="bg-slate-950 border border-white/10 rounded-md px-2 py-1 text-xs text-white outline-none focus:ring-1 focus:ring-amber-500 ml-3"
                title="Select student group for schedule enforcement"
              >
                <option value="">Group (all)</option>
                {state.masterSchedule.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name || g.id}
                  </option>
                ))}
              </select>
            )}
            {state.masterSchedule && (
              <select
                value={scheduleTerm}
                onChange={(e) => setScheduleTerm(e.target.value)}
                className="bg-slate-950 border border-white/10 rounded-md px-2 py-1 text-xs text-white outline-none focus:ring-1 focus:ring-amber-500 ml-3"
                title="Schedule term"
              >
                {[...new Set(
                  state.masterSchedule.sessions
                    .map(s => s.term)
                    .filter(Boolean)
                )].map(term => (
                  <option key={term} value={term}>{term}</option>
                ))}
              </select>
            )}

            <button
              onClick={() => onOpenTimetable?.(studentId)}
              disabled={!studentId}
              title="View this student’s weekly timetable"
              className="flex items-center gap-2 bg-teal-500/10 hover:bg-teal-500/20 text-teal-200 px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider border border-teal-500/30 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Timetable</span>
            </button>


          </div>
          <div>


            {/* Per-student registration form — one A4 portrait page
                rendered by the per-student tree that Shell mounts
                when this button fires. Disabled when there's no
                active term or no student is selected. */}
            <div className="flex gap-4 justify-between">
              <Legend />
              <div className="flex gap-4">

                {/* Save to cloud — only when signed in */}
                {cloudEnabled && user && (
                  <button
                    onClick={handleSave}
                    disabled={saving !== 'idle'}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 transition-all cursor-pointer disabled:opacity-60 active:scale-95"
                  >
                    {saving === 'saving' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : saving === 'saved' ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Upload className="w-3.5 h-3.5" />
                    )}
                    <span>حفظ التسجيل</span>
                  </button>
                )}

                <button
                  onClick={() => {
                    if (!activeTerm || !studentId) return;
                    triggerPrint(setActiveTree, 'reg-form-single', {
                      studentId,
                      title: studentPrintFilename(metrics, studentId),
                    });
                  }}
                  disabled={!activeTerm || !studentId}
                  title={
                    activeTerm
                      ? `Print ${metrics?.name ?? 'student'}'s registration form for ${activeTerm.name}`
                      : 'Create a term first'
                  }
                  className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-slate-200 px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider border border-white/10 transition-all cursor-pointer active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white/5"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print form</span>
                </button>

                {/* Print-this-map buttons — one per theme, mirroring the
                cohort bulk-print pair below. Distinct from "Print
                form" (which renders the NMU registration form) and
                from the bulk "Print dark / light" (which renders the
                whole cohort). Prints ONE A4 page for the active
                student using the chosen palette so the
                New/Enhancing/Repeated colours translate straight to
                paper.

                Text uses `text-violet-200` (not `text-violet-100`)
                because the on-screen `theme-light` override in
                index.css already maps violet-200 → violet-700 for
                white surfaces; violet-100 has no override and
                stays near-white, making the label invisible in
                light mode. */}
                <div className="flex items-stretch rounded-lg border border-violet-500/30 overflow-hidden">
                  <button
                    onClick={() => {
                      if (!studentId) return;
                      triggerPrint(setActiveTree, 'prereq-maps', {
                        studentId,
                        theme: 'dark',
                        title: studentPrintFilename(metrics, studentId),
                      });
                    }}
                    disabled={!studentId}
                    title={
                      studentId
                        ? `Print ${metrics?.name ?? studentId}'s prereq map — dark theme`
                        : 'Select a student first'
                    }
                    className="flex items-center gap-1.5 bg-violet-500/10 hover:bg-violet-500/20 text-violet-200 px-3 py-2 text-[10px] font-bold uppercase tracking-wider cursor-pointer active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>This map · dark</span>
                  </button>
                  <button
                    onClick={() => {
                      if (!studentId) return;
                      triggerPrint(setActiveTree, 'prereq-maps', {
                        studentId,
                        theme: 'light',
                        title: studentPrintFilename(metrics, studentId),
                      });
                    }}
                    disabled={!studentId}
                    title={
                      studentId
                        ? `Print ${metrics?.name ?? studentId}'s prereq map — light theme (B/W friendly)`
                        : 'Select a student first'
                    }
                    className="flex items-center gap-1.5 bg-violet-500/10 hover:bg-violet-500/20 text-violet-200 px-3 py-2 text-[10px] font-bold uppercase tracking-wider border-l border-violet-500/30 cursor-pointer active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>This map · light</span>
                  </button>
                </div>

                {/* Print-all-maps buttons — one per theme. Triggers the
                browser print dialog with a payload that picks the
                dark or light print palette (see print.css and
                PrereqMapPrint). The actual pages are pre-rendered in
                `<PrereqMapPrint>` mounted by Shell.tsx; print.css
                hides the on-screen app and shows one A4 page per
                student. Splitting the buttons by theme lets the
                adviser print a B/W-friendly handout without
                switching the on-screen app theme. */}
                <div className="flex items-stretch rounded-lg border border-white/10 overflow-hidden">
                  <button
                    onClick={() =>
                      triggerPrint(setActiveTree, 'prereq-maps', { theme: 'dark' })
                    }
                    title="Print one page per student — dark theme (matches the on-screen app)"
                    className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-slate-200 px-3 py-2 text-[10px] font-bold uppercase tracking-wider cursor-pointer active:scale-95"
                  >
                    <Moon className="w-3.5 h-3.5" />
                    <span>Print dark</span>
                  </button>
                  <button
                    onClick={() =>
                      triggerPrint(setActiveTree, 'prereq-maps', { theme: 'light' })
                    }
                    title="Print one page per student — light theme (better for B/W printers and ink-saving)"
                    className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-slate-200 px-3 py-2 text-[10px] font-bold uppercase tracking-wider border-l border-white/10 cursor-pointer active:scale-95"
                  >
                    <Sun className="w-3.5 h-3.5" />
                    <span>Print light</span>
                  </button>
                </div>
              </div>

            </div>

          </div>
        </div>


      </header>

      {/* Filter row — secondary header that owns the four filter
          inputs. Always visible (the user said they want to slide
          through filtered cohorts often). Lives under the main
          header in its own slimmer row to keep visual hierarchy. */}
      <FilterBar
        filters={filters}
        onChange={setFilters}
        majors={availableMajors}
        matchCount={filteredStudents.length}
        totalCount={allStudents.length}
        activeFilteredOut={!activeInFiltered}
      />

      {!activeInFiltered && allStudents.length > 0 && (
        <div className="px-6 py-2 bg-amber-500/10 border-b border-amber-500/20 text-[11px] text-amber-200 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>
            Active student doesn&apos;t match the current filters. Prev/Next
            steps through matches around their position.
          </span>
        </div>
      )}

      {/* Stat strip — two cards side-by-side summarising the
          active student: rolled-up metrics (GPA, passed/failed/
          total hours, registered hours) and the plan-impact panel
          (New / Enhancing / Repeated credit totals + the
          projected GPA after the planned term lands). Mirrors the
          header summary on the printed handout. */}
      {metrics && (
        <PlanStats
          metric={metrics}
          planCodes={activeEntry?.courseCodes ?? []}
          catalog={state.catalog}
          rows={state.rows}
          studentId={studentId}
        />
      )}

      <div className="flex-1 flex flex-row min-h-0">
        <MapBody
          mapData={mapData}
          onCardClick={handleCardClick}
          plannedSet={plannedSet}
          studentGpa={metrics?.gpa ?? 0}
        />
        <PlanPanel
          term={activeTerm}
          entry={activeEntry}
          studentId={studentId}
          studentName={metrics?.name}
          catalog={state.catalog}
          onClear={() =>
            studentId && activeTerm && clearTermForStudent(activeTerm.id, studentId)
          }
          onRename={(name) => activeTerm && renameTerm(activeTerm.id, name)}
          onRemove={(code) =>
            studentId && activeTerm && removeCourseFromTerm(activeTerm.id, studentId, code)
          }
          onAdd={(code) =>
            studentId && activeTerm && addCourseToTerm(activeTerm.id, studentId, code)
          }
          onCreate={() => createTerm()}
        />
      </div>

      {showTermManager && (
        <TermManagerModal onClose={() => setShowTermManager(false)} />
      )}

      {rejectionReason && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-white/10 rounded-xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-extrabold uppercase tracking-wider text-amber-200 mb-2">
                  Cannot add course
                </h3>
                <p className="text-sm text-slate-300 leading-relaxed">{rejectionReason}</p>
              </div>
            </div>
            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setRejectionReason(null)}
                className="px-4 py-2 bg-amber-500/20 border border-amber-500/30 text-amber-100 rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-amber-500/30 transition-colors cursor-pointer"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Legend() {
  const order: CourseMapStatus[] = ['passed', 'failed', 'failed-prereq', 'blocked', 'open', 'closed', 'contradiction', 'planned'];
  return (
    <div className="hidden md:flex items-center gap-3 flex-wrap">
      {order.map((s) => {
        const Icon = STATUS_STYLES[s].icon;
        return (
          <div key={s} className="flex items-center gap-1.5">
            <Icon className={`w-3 h-3 ${STATUS_STYLES[s].text}`} />
            <span className="text-[10px] uppercase tracking-wider text-slate-400">
              {STATUS_STYLES[s].label}
            </span>
          </div>
        );
      })}
      {/* Plan categories — only meaningful when a course is on the
          active plan, but listed here so the colour key is visible. */}
      {(['new', 'enhancing', 'repeated'] as PlanClassification[]).map((k) => {
        const ps = PLAN_CARD_STYLES[k];
        return (
          <div key={k} className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-full ${ps.bg} ${ps.border} border`} />
            <span className="text-[10px] uppercase tracking-wider text-slate-400">
              {ps.label}
            </span>
          </div>
        );
      })}
      <div className="flex items-center gap-1.5">
        <ArrowRight className="w-3 h-3 text-slate-400" />
        <span className="text-[10px] uppercase tracking-wider text-slate-400">Prereq</span>
      </div>
    </div>
  );
}

/**
 * Two-card stat strip pinned above the prereq map.
 *
 * Card 1 ("Current standing") — read-only metrics pulled straight
 * from the StudentMetrics object: GPA, passed hours, failed hours,
 * total attempted hours (= passed + failed), and the credit load
 * the student just put on the active term.
 *
 * Card 2 ("Plan impact") — derived from the active term's entries:
 *   - credit totals broken down by New / Enhancing / Repeated
 *   - the projected GPA if every planned course lands at its cap
 *     (new = A, enhancing = A − currentLetterPoints, repeated = B+)
 *
 * The Expected GPA mirrors `computeExpectedGpa` in data/metrics.ts;
 * the breaking-down by classification duplicates the logic the
 * export uses (see exportPlans.planCourseStatus) so the on-screen
 * numbers stay in lock-step with the workbook.
 */
function PlanStats({
  metric,
  planCodes,
  catalog,
  rows,
  studentId,
}: {
  metric: StudentMetrics;
  planCodes: string[];
  catalog: CourseCatalog | null;
  rows: import('../data/types').GradeRow[];
  studentId: string;
}) {
  // Catalog credits keyed by normalized course code. Same helper the
  // print tree uses — keeps the on-screen strip and the printed page
  // in lock-step.
  const creditByCode = useMemo(() => buildCreditByCode(catalog), [catalog]);

  const planStats = useMemo(
    () =>
      computePlanStats({
        studentId,
        metricGpa: metric.gpa,
        totalUnits: metric.totalUnits,
        totalFailedUnits: metric.totalFailedUnits,
        planCodes,
        rows,
        creditByCode,
      }),
    [
      studentId,
      metric.gpa,
      metric.totalUnits,
      metric.totalFailedUnits,
      planCodes,
      rows,
      creditByCode,
    ]
  );

  const totalHours = metric.totalUnits + metric.totalFailedUnits;
  const gpaTrend = planStats.expectedGpa == null ? null : planStats.expectedGpa - metric.gpa;

  return (
    <div className="px-6 pt-4 pb-3 grid grid-cols-1 md:grid-cols-2 gap-3 border-b border-white/5 bg-slate-950/60">
      <StatsCard title="Current standing">
        <StatsRow label="Current GPA" value={metric.gpa.toFixed(3)} accent={gpaToken(metric.gpa)} />
        <StatsRow label="Total passed hours" value={`${metric.totalUnits}`} />
        <StatsRow
          label="Failed hours"
          value={`${metric.totalFailedUnits}`}
          accent={metric.totalFailedUnits > 0 ? 'rose' : undefined}
        />
        <StatsRow label="Total hours" value={`${totalHours}`} />
        <StatsRow
          label="Term registered hours"
          value={`${planStats.registeredHours}`}
          accent={planStats.registeredHours > 0 ? 'fuchsia' : undefined}
        />
      </StatsCard>

      <StatsCard
        title="Plan impact"
        accent={planStats.expectedGpa == null ? undefined : 'violet'}
      >
        <StatsRow label="New CH" value={`${planStats.newCh}`} accent="violet" />
        <StatsRow label="Enhancing CH" value={`${planStats.enhancingCh}`} accent="cyan" />
        <StatsRow label="Repeated CH" value={`${planStats.repeatedCh}`} accent="orange" />
        <StatsRow
          label="Expected GPA"
          value={
            planStats.expectedGpa == null
              ? '—'
              : planStats.expectedGpa.toFixed(3)
          }
          accent={
            planStats.expectedGpa == null
              ? 'slate'
              : gpaTrend != null && gpaTrend >= 0
                ? 'emerald'
                : 'rose'
          }
          hint={
            gpaTrend == null
              ? undefined
              : gpaTrend >= 0
                ? `+${gpaTrend.toFixed(3)} vs current`
                : `${gpaTrend.toFixed(3)} vs current`
          }
        />
      </StatsCard>
    </div>
  );
}

function FilterBar({
  filters,
  onChange,
  majors,
  matchCount,
  totalCount,
  activeFilteredOut,
}: {
  filters: MapFilters;
  onChange: (next: MapFilters) => void;
  majors: string[];
  matchCount: number;
  totalCount: number;
  activeFilteredOut: boolean;
}) {
  const progressOptions: Array<{ value: ProgressFilter; label: string }> = [
    { value: 'all', label: 'All progress' },
    { value: 'has-failures', label: 'Has failures' },
    { value: 'all-passed', label: 'All passed' },
  ];
  const filtersActive = !isFiltersEmpty(filters);
  return (
    <div className="px-6 py-2 border-b border-white/5 bg-slate-950/60 flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-slate-400">
        <Filter className="w-3 h-3" />
        <span>Filter</span>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1.5 w-3 h-3 text-slate-500 pointer-events-none" />
        <input
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          placeholder="Search name or ID..."
          className="bg-slate-950 border border-white/10 rounded-md pl-7 pr-2 py-1 text-[11px] text-white outline-none focus:ring-1 focus:ring-blue-500 w-44"
        />
        {filters.search && (
          <button
            onClick={() => onChange({ ...filters, search: '' })}
            title="Clear search"
            className="absolute right-1 top-1 p-0.5 rounded text-slate-500 hover:text-slate-200"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Major */}
      <select
        value={filters.major}
        onChange={(e) => onChange({ ...filters, major: e.target.value })}
        className="bg-slate-950 border border-white/10 rounded-md px-2 py-1 text-[11px] text-white outline-none focus:ring-1 focus:ring-blue-500 max-w-[16rem]"
        title="Filter by major"
      >
        <option value="all">All majors</option>
        {majors.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>

      {/* Progress */}
      <select
        value={filters.progress}
        onChange={(e) =>
          onChange({ ...filters, progress: e.target.value as ProgressFilter })
        }
        className="bg-slate-950 border border-white/10 rounded-md px-2 py-1 text-[11px] text-white outline-none focus:ring-1 focus:ring-blue-500"
        title="Filter by progress"
      >
        {progressOptions.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>

      {/* Status checkboxes */}
      <label className="flex items-center gap-1.5 text-[11px] text-slate-300 px-2 py-1 rounded-md hover:bg-white/5 cursor-pointer">
        <input
          type="checkbox"
          checked={filters.status.plannedConflict}
          onChange={(e) =>
            onChange({
              ...filters,
              status: { ...filters.status, plannedConflict: e.target.checked },
            })
          }
          className="accent-rose-500"
        />
        <span>Planned conflict</span>
      </label>
      <label className="flex items-center gap-1.5 text-[11px] text-slate-300 px-2 py-1 rounded-md hover:bg-white/5 cursor-pointer">
        <input
          type="checkbox"
          checked={filters.status.hasPlans}
          onChange={(e) =>
            onChange({
              ...filters,
              status: { ...filters.status, hasPlans: e.target.checked },
            })
          }
          className="accent-fuchsia-500"
        />
        <span>Has plans</span>
      </label>

      <div className="flex-1" />

      <span
        className={`text-[10px] uppercase tracking-wider font-bold ${filtersActive ? 'text-blue-300' : 'text-slate-500'
          }`}
        title={
          activeFilteredOut
            ? `${matchCount} match(es); active student is outside the filter`
            : `${matchCount} of ${totalCount} student(s)`
        }
      >
        {matchCount} / {totalCount}
        {activeFilteredOut && (
          <span className="ml-1 text-amber-400" title="Active student is filtered out">
            (out)
          </span>
        )}
      </span>

      {filtersActive && (
        <button
          onClick={() => onChange(DEFAULT_FILTERS)}
          className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-slate-300 hover:text-white px-2 py-1 rounded-md hover:bg-white/5 cursor-pointer"
          title="Clear all filters"
        >
          <RotateCcw className="w-3 h-3" />
          Reset
        </button>
      )}
    </div>
  );
}

function MapBody({
  mapData,
  onCardClick,
  plannedSet,
  studentGpa,
}: {
  mapData: ReturnType<typeof buildPrereqMap>;
  onCardClick: (code: string) => void;
  plannedSet: Set<string>;
  /** Active student's cumulative GPA — pinned on every card so the
   *  advisor sees the metric at a glance while planning. Only
   *  rendered when the value is finite and > 0. */
  studentGpa: number;
}) {
  const totalCourses = mapData.semesters.reduce((n, c) => n + c.courses.length, 0);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {totalCourses === 0 && (
        <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
          {mapData.resolvedMajor
            ? `No catalog entries for ${mapData.resolvedMajor} (check that majors[] and semesters[] columns are populated).`
            : 'Import a course catalog to populate the prereq map.'}
        </div>
      )}
      <div
        className="flex-1 overflow-auto p-8"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      >
        <div className="flex flex-col gap-4 min-w-full">
          {mapData.semesters.map((col) => (
            <SemesterRowView
              key={col.number}
              column={col}
              onCardClick={onCardClick}
              plannedSet={plannedSet}
              studentGpa={studentGpa}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SemesterRowView({
  column,
  onCardClick,
  plannedSet,
  studentGpa,
}: {
  column: { number: number; courses: MappedCourse[] };
  onCardClick: (code: string) => void;
  plannedSet: Set<string>;
  /** Active student's cumulative GPA — pinned on every card so the
   *  advisor sees the metric at a glance while planning. Only
   *  rendered when the value is finite and > 0. */
  studentGpa: number;
}) {
  return (
    // Row layout: semester label pinned to the left, courses flow
    // horizontally to the right. Wraps inside the row if the viewport
    // is narrow. The outer wrapper scrolls vertically (set by the
    // parent `overflow-auto` container).
    <div className="flex items-start gap-4">
      <div className="w-24 shrink-0 pt-2 text-right">
        <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
          Semester
        </div>
        <div className="text-base font-extrabold text-white">{column.number}</div>
        <div className="text-[9px] text-slate-600 mt-0.5">{column.courses.length} course(s)</div>
      </div>
      <div className="flex-1 min-w-0 border-l border-white/15 pl-4">
        {column.courses.length === 0 ? (
          <div className="text-[10px] text-slate-600 italic px-3 py-3 border border-dashed border-white/10 rounded-lg text-center">
            No courses for this semester
          </div>
        ) : (
          // HORIZONTAL: courses sit side-by-side inside the row,
          // wrapping to a new line inside the same semester if needed.
          <div className="flex flex-wrap gap-2">
            {column.courses.map((c) => (
              <CourseCard
                key={c.code}
                course={c}
                onClick={onCardClick}
                isPlanned={plannedSet.has(c.code)}
                studentGpa={studentGpa}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CourseCard({
  course,
  onClick,
  isPlanned,
  studentGpa,
}: {
  course: MappedCourse;
  onClick: (code: string) => void;
  isPlanned: boolean;
  /**
   * Active student's cumulative GPA. Currently unused on the card
   * itself (the per-course grade row always shows a letter or a dash,
   * never the student's overall GPA — that lives in the page header).
   * Kept on the prop list so the parent can keep threading the metric
   * through without changing the call site.
   */
  studentGpa: number;
}) {
  const style = STATUS_STYLES[course.status];
  const Icon = style.icon;
  // When the course is on the active plan AND we have a
  // classification for it, the New/Enhancing/Repeated palette wins
  // over the prereq-derived status — those colours are louder and
  // carry the action context. Falls back to the legacy "Planned"
  // fuchsia if the classification is missing (defensive only).
  const planStyle =
    isPlanned && course.planClassification
      ? PLAN_CARD_STYLES[course.planClassification]
      : null;
  const effectiveStyle = planStyle
    ? {
      border: planStyle.border,
      bg: planStyle.bg,
      text: planStyle.text,
      icon: BookmarkCheck,
      label: planStyle.label,
    }
    : isPlanned
      ? { ...STATUS_STYLES.planned }
      : { ...style };
  const isAlert = course.status === 'failed' || course.status === 'blocked';
  return (
    <div
      data-card-code={course.code}
      data-card-classification={course.planClassification ?? ''}
      onClick={() => onClick(course.code)}
      title={`Click to ${isPlanned ? 'remove from' : 'add to'} plan`}
      className={`relative border ${effectiveStyle.border} ${effectiveStyle.bg} rounded-xl p-2 w-44 shadow-sm hover:scale-[1.02] transition-transform cursor-pointer ${planStyle
        ? `ring-2 ${planStyle.ring} shadow-md`
        : isPlanned
          ? 'ring-2 ring-fuchsia-400/60 shadow-fuchsia-500/20 shadow-md'
          : ''
        }`}
    >
      <div className="flex items-start justify-between gap-1.5">
        <span
          className={`font-mono font-extrabold text-[10px] px-1.5 py-0.5 rounded ${planStyle
            ? `${planStyle.bg} ${planStyle.text}`
            : effectiveStyle.label === 'Passed'
              ? 'bg-emerald-500/20 text-emerald-300'
              : effectiveStyle.label === 'Failed'
                ? 'bg-rose-600/20 text-rose-300'
                : effectiveStyle.label === 'Prereq failed'
                  ? 'bg-pink-500/20 text-pink-300'
                  : effectiveStyle.label === 'Open'
                    ? 'bg-blue-500/20 text-blue-300'
                    : effectiveStyle.label === 'Blocked'
                      ? 'bg-amber-500/20 text-amber-300'
                      : effectiveStyle.label === 'Planned'
                        ? 'bg-fuchsia-500/30 text-fuchsia-200'
                        : effectiveStyle.label === 'Contradiction'
                          ? 'bg-orange-500/20 text-orange-300'
                          : effectiveStyle.label === 'Closed'
                            ? 'bg-slate-500/20 text-slate-300'
                            : 'bg-white/10 text-slate-400'
            }`}
        >
          {course.code}
        </span>
        <Icon className={`w-3.5 h-3.5 shrink-0 ${effectiveStyle.text}`} />
      </div>
      <div className="text-[10px] text-slate-200 mt-1.5 leading-snug line-clamp-3">
        {course.title}
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[9px] text-slate-500">{course.credits} cr</span>
        <span
          className={`text-[9px] uppercase tracking-wider font-bold ${effectiveStyle.text}`}
        >
          {effectiveStyle.label}
        </span>
      </div>
      {/*
        Grade row: shows the letter grade the student earned in THIS
        specific course (their latest attempt). When the course has
        never been attempted, we render an em-dash — never the
        student's overall GPA. The grade row is per-course, not
        per-student; mixing in the GPA here would be misleading
        because two cards with the same dash would imply the same
        mark, but a planned MEC011 and a passed MAT101 are
        fundamentally different cases.
      */}
      <div
        data-card-grade={course.latestGrade || ''}
        className="mt-1 pt-1 border-t border-white/10 flex items-center justify-between text-[9px] text-slate-400"
      >
        <span className="uppercase tracking-wider font-bold text-slate-500">
          Grade
        </span>
        {course.latestGrade ? (
          <span
            className={`font-mono font-extrabold ${SCREEN_COLOR_CLASS[gradeTextToken(course.latestGrade)]
              }`}
          >
            {formatGradeWithPoints(course.latestGrade)}
          </span>
        ) : (
          <span
            className="font-mono font-extrabold text-slate-500"
            title="Course has never been attempted"
          >
            —
          </span>
        )}
      </div>
      {course.prereqCodes.length > 0 && (
        <div className="mt-1 pt-1 border-t border-white/10 text-[9px] text-slate-400 font-mono leading-snug">
          <span className="text-slate-500 not-italic mr-1">prereqs:</span>
          {course.prereqCodes.map((p, i) => {
            const missing = course.missingPrereqs.includes(p);
            return (
              <span key={p}>
                <span
                  className={
                    missing
                      ? 'text-rose-300 font-bold'
                      : 'text-emerald-300'
                  }
                  title={missing ? 'Still missing' : 'Already passed'}
                >
                  {p}
                </span>
                {i < course.prereqCodes.length - 1 && (
                  <span className="text-slate-600"> · </span>
                )}
              </span>
            );
          })}
        </div>
      )}
      {/*
        Blocks row — the inverse of the prereq row. Lists the
        downstream courses (within this major's plan) that this
        card is a prereq for, so the adviser can see at a glance
        which future courses this one unblocks. Suppressed when
        the course has no dependents in the active major (otherwise
        every low-level elective would show an empty row).
        Colour-coded with amber to suggest "future impact",
        distinct from the prereq emerald.
      */}
      {course.blocks.length > 0 && (
        <div className="mt-1 pt-1 border-t border-white/10 text-[9px] text-slate-400 font-mono leading-snug">
          <span className="text-slate-500 not-italic mr-1">blocks:</span>
          {course.blocks.map((p, i) => (
            <span key={p}>
              <span className="text-amber-300" title={`Unlocks ${p}`}>
                {p}
              </span>
              {i < course.blocks.length - 1 && (
                <span className="text-slate-600"> · </span>
              )}
            </span>
          ))}
        </div>
      )}
      {isPlanned && !planStyle && (
        <div className="absolute -top-1.5 -right-1.5 bg-fuchsia-500 text-white text-[8px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-full shadow-md">
          On plan
        </div>
      )}
      {planStyle && (
        <div
          data-card-plan-pill
          className={`absolute -top-1.5 -right-1.5 ${planStyle.bg.replace('/15', '')} text-white text-[8px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-full shadow-md border ${planStyle.border}`}
        >
          {planStyle.label}
        </div>
      )}
      {void isAlert /* keep var referenced for future alert styling */}
    </div>
  );
}

/**
 * Format a letter grade together with its 4.0-scale point value as
 * "X.X - A" (e.g. "4.0 - A", "3.3 - B+", "0.0 - F"). The point value
 * always uses one decimal place so column widths stay uniform on the
 * card and on the printed handout.
 *
 * Letter-only grades (`U`, `FL`, `FD`, `FA`, `P`) carry no standard
 * point value, so we render the letter alone (e.g. "U") and let the
 * colour convention flag them as failing.
 *
 * (Both helpers now live in `./shared/formatGrade.ts` — re-exported
 * locally so existing imports keep working without churn.)
 */

function PlanPanel({
  term,
  entry,
  studentId,
  studentName,
  catalog,
  onClear,
  onRename,
  onRemove,
  onAdd,
  onCreate,
}: {
  term: Term | null;
  entry: TermEntry | null;
  studentId: string;
  studentName: string | undefined;
  catalog: CourseCatalog;
  onClear: () => void;
  onRename: (name: string) => void;
  onRemove: (code: string) => void;
  onAdd: (code: string) => void;
  onCreate: () => void;
}) {
  const [draftCode, setDraftCode] = useState('');
  const courseCodes = entry?.courseCodes ?? [];
  const canAdd = !!term && draftCode.trim().length > 0;
  return (
    <aside className="w-80 shrink-0 border-l border-white/10 bg-slate-950/80 backdrop-blur-md p-4 flex flex-col gap-3 overflow-y-auto">
      <div>
        <div className="text-[10px] uppercase tracking-wider font-extrabold text-fuchsia-300 mb-1 flex items-center gap-1.5">
          <BookmarkCheck className="w-3 h-3" />
          Registration plan
        </div>
        <div className="text-xs text-slate-300 truncate">
          {studentName ?? `Student ${studentId}`}
        </div>
        {term ? (
          <input
            type="text"
            value={term.name}
            onChange={(e) => onRename(e.target.value)}
            placeholder="Term name (e.g. Summer 2025)"
            className="mt-2 w-full bg-slate-950 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:ring-1 focus:ring-fuchsia-500"
          />
        ) : (
          <button
            onClick={onCreate}
            className="mt-2 w-full bg-fuchsia-500/10 border border-fuchsia-500/30 rounded-lg px-2 py-2 text-xs text-fuchsia-200 hover:bg-fuchsia-500/15 cursor-pointer"
          >
            Create a new term
          </button>
        )}
        <p className="mt-1 text-[10px] text-slate-500">
          Click a course card on the map to toggle it on/off this term.
          Each student has at most one entry per term.
        </p>
      </div>

      {/* Manual add — lets the adviser type a code rather than
          hunting for the card on the map. */}
      {term && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canAdd) return;
            onAdd(draftCode);
            setDraftCode('');
          }}
          className="flex items-center gap-1.5"
        >
          <input
            value={draftCode}
            onChange={(e) => setDraftCode(e.target.value)}
            placeholder="Add course code (e.g. MEC011)"
            className="flex-1 bg-slate-950 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:ring-1 focus:ring-fuchsia-500 font-mono"
          />
          <button
            type="submit"
            disabled={!canAdd}
            className="px-2 py-1.5 rounded-lg bg-fuchsia-500/20 border border-fuchsia-500/40 text-[10px] uppercase tracking-wider font-bold text-fuchsia-100 hover:bg-fuchsia-500/30 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            Add
          </button>
        </form>
      )}

      <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400 flex items-center justify-between">
        <span>Courses</span>
        <span className="text-slate-600">{courseCodes.length}</span>
      </div>

      {courseCodes.length > 0 ? (
        <div className="flex flex-col gap-2">
          {courseCodes.map((code) => {
            const courseTitle = catalog.courses[code]?.title || 'Unknown Course';
            const courseCredits = catalog.courses[code]?.credits || 0;
            return (
              <div
                key={code}
                className="flex flex-col bg-fuchsia-500/10 border border-fuchsia-500/30 rounded-lg p-2.5 relative group"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-bold text-fuchsia-200">{code}</span>
                  <button
                    onClick={() => onRemove(code)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-fuchsia-300 hover:text-fuchsia-100 text-[10px] uppercase font-bold tracking-wider cursor-pointer"
                    title="Remove from plan"
                  >
                    Remove
                  </button>
                </div>
                <div className="text-[10px] text-fuchsia-100/70 mt-1 leading-snug pr-8 line-clamp-2">
                  {courseTitle}
                </div>
                <div className="absolute bottom-2.5 right-2.5 text-[9px] text-fuchsia-500 font-bold">
                  {courseCredits} cr
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-[10px] text-slate-500 italic border border-dashed border-white/10 rounded-lg p-3 text-center">
          No courses yet for this student on this term. Click a card on
          the map to add one, or type a code above.
        </div>
      )}

      {courseCodes.length > 0 && (
        <button
          onClick={onClear}
          className="mt-auto text-[10px] uppercase tracking-wider font-bold text-rose-300 hover:text-rose-200 self-start cursor-pointer"
        >
          Clear this student's term
        </button>
      )}
    </aside>
  );
}

/**
 * Build the default filename for a per-student print. Format is
 * `"<name> - <id>"` (with the literal hyphen-space-hyphen), so the
 * browser's print dialog (and "Save as PDF") pre-fills with
 * something like `"Hassan Mohamed - 20201234"`.
 *
 * Falls back gracefully:
 *   - When the metric's name is missing or a placeholder, only the
 *     id is used.
 *   - When the id is also missing, the string is empty so
 *     `triggerPrint` skips the swap and the browser uses whatever
 *     the page's default title is.
 *
 * `sanitiseFilename` inside PrintContext strips illegal Windows
 * characters (`< > : " / \ | ? *`) and collapses whitespace, so the
 * caller can pass names with arbitrary text without breaking the
 * "Save as PDF" dialog on Windows.
 */
function studentPrintFilename(
  metric: StudentMetrics | undefined,
  studentId: string
): string {
  if (!studentId) return '';
  const rawName = metric?.name?.trim();
  const hasRealName =
    rawName && rawName.length > 0 && !/^Student\s+/i.test(rawName);
  return hasRealName ? `${rawName} - ${studentId}` : studentId;
}

/**
 * SIS Status toggle buttons — two clear, color-coded buttons with
 * distinct icons for Paid (سداد) and SIS Registration (تسجيل SIS).
 * Green when active, grey when inactive. Syncs to cloud for advisers.
 */
function SisToggleButtons({ studentId }: { studentId: string }) {
  const { state, updateRosterEntry } = useData();
  const { cloudEnabled, user, profile } = useAuth();
  const isAdvisor = cloudEnabled && !!user && profile?.role === 'advisor';

  const rosterEntry = state.roster.find((r) => r.studentId === studentId);
  const sisRegistered = rosterEntry?.sisRegistered ?? false;
  const sisPaid = rosterEntry?.sisPaid ?? false;

  const handleToggle = (patch: { sisRegistered?: boolean; sisPaid?: boolean }) => {
    updateRosterEntry(studentId, patch);
    if (isAdvisor) {
      updateStudentSisStatusInCloud(studentId, user!.uid, patch).catch((err) => {
        console.warn('[sis] Cloud patch failed — local change kept.', err);
      });
    }
  };

  return (
    <div className="flex items-center gap-2 shrink-0">
      {/* سداد — Paid toggle */}
      <button
        onClick={() => handleToggle({ sisPaid: !sisPaid })}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border transition-all cursor-pointer active:scale-95 ${
          sisPaid
            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm shadow-emerald-500/10'
            : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10'
        }`}
        title={sisPaid ? 'Paid — click to unmark' : 'Not paid — click to mark as paid'}
      >
        {sisPaid ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        ) : (
          <XCircle className="w-4 h-4 text-slate-500" />
        )}
        <span>سداد</span>
      </button>

      {/* تسجيل SIS — Registration toggle */}
      <button
        onClick={() => handleToggle({ sisRegistered: !sisRegistered })}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border transition-all cursor-pointer active:scale-95 ${
          sisRegistered
            ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-sm shadow-cyan-500/10'
            : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10'
        }`}
        title={sisRegistered ? 'Registered on SIS — click to unmark' : 'Not registered — click to mark as registered'}
      >
        {sisRegistered ? (
          <CheckCircle2 className="w-4 h-4 text-cyan-400" />
        ) : (
          <XCircle className="w-4 h-4 text-slate-500" />
        )}
        <span>تسجيل SIS</span>
      </button>
    </div>
  );
}