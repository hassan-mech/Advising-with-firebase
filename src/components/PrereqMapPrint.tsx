/**
 * PrereqMapPrint — print-only DOM tree.
 *
 * One A4 portrait page per student, mirroring the **on-screen** prereq
 * map exactly: dark slate background, status-colour borders and tints,
 * lucide-react icons inside each course card. The goal is "what you
 * see on screen is what prints" so the colour codes the adviser used
 * while planning translate directly to the printed handout.
 *
 * Architecture:
 *   - Only mounted by Shell while a print is in flight (see
 *     PrintContext). print.css hides it on screen and shows it during
 *     print. One page per student via `[data-print-page]` page-breaks.
 *
 * CSS strategy: we DON'T use Tailwind utility classes in this tree
 * because Tailwind's content scanner doesn't visit the print CSS
 * file. All styling is hand-rolled in `print.css` under the
 * `pmaps-*` class names, with inline `style={{ ... }}` for the
 * per-status colours so they stay in lock-step with the on-screen
 * `STATUS_STYLES` palette in PrereqMapScreen.tsx.
 *
 * Status colour mapping (mirrors PrereqMapScreen.STATUS_STYLES):
 *   passed        : emerald  — CheckCircle2
 *   failed        : rose     — XCircle
 *   failed-prereq : pink     — AlertTriangle (upstream prereq was failed)
 *   blocked       : amber    — Lock (upstream prereq never attempted)
 *   open          : blue     — Circle (ready to register)
 *   planned       : fuchsia  — BookmarkCheck (on the active plan)
 *   in-program    : slate    — Circle (not on this student's plan)
 */

import { useMemo } from 'react';
import {
  AlertTriangle,
  BookmarkCheck,
  CheckCircle2,
  Circle,
  Lock,
  XCircle,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import type {
  CatalogCourse,
  CourseCatalog,
  GradeRow,
  RosterEntry,
  StudentMetrics,
} from '../data/types';
import {
  buildPrereqMap,
  type CourseMapStatus,
  type MappedCourse,
} from '../data/prereqMap';
import { buildCreditByCode, computePlanStats } from './shared/planStats';
import { formatGradeWithPoints, gradeTextToken } from './shared/formatGrade';
import { PRINT_COLOR_DARK, PRINT_COLOR_LIGHT, gpaToken } from './shared/colorTokens';
import { PrintStatCard, PrintStatRow } from './shared/PrintStatCard';

interface CourseCardProps {
  course: MappedCourse;
  courseByCode: Map<string, MappedCourse>;
  theme: 'dark' | 'light';
  studentGpa: number;
}

export interface PrereqMapPrintProps {
  rows: GradeRow[];
  catalog: CourseCatalog | null;
  roster: RosterEntry[];
  metricsByStudent: Record<string, StudentMetrics>;
  /** Optional cap — for a quick smoke test the user might want only
   *  the first 5 students. Default = all students. */
  limit?: number;
  /**
   * Optional single-student filter — when set, the print tree emits
   * ONE page for that student only. Used by the "Print this map"
   * button on PrereqMapScreen so the adviser can print just the
   * active student's map without paginating through the cohort.
   * Ignored when `limit` is also set (limit wins for bulk prints).
   */
  studentId?: string;
  /**
   * Active-term entries keyed by student id. When provided, the
   * print tree uses them to flag planned courses and feed them
   * through `buildPrereqMap`'s classification pipeline, so the
   * printed page shows the New/Enhancing/Repeated palette the user
   * saw on screen.
   */
  planByStudent?: Record<string, string[]>;
  /**
   * Colour theme for the printed handout.
   *   - 'dark'  : slate-950 background + status-coloured cards
   *               (matches the on-screen dark theme by default).
   *   - 'light' : white background + status-coloured cards on white.
   *               Better for B/W printers and ink-saving.
   * The user can pick either independently of the on-screen app theme.
   */
  theme?: 'dark' | 'light';
}

/**
 * Inline-style palette mirroring the Tailwind classes used in
 * `STATUS_STYLES` (PrereqMapScreen.tsx). Keeping these here means a
 * course that's "open" on screen is also light-blue on paper — no
 * drift between the screen and the printed handout.
 *
 * Hex values are the slate-950 (`#020617`) blend outputs of the
 * `bg-XXX-500/15` Tailwind utilities. The slate-950 base + 15%
 * emerald-500 = `#0a2921` etc. — values chosen to read clearly in
 * print without burning toner.
 */
interface StatusPalette {
  /** 1px solid border on the card. */
  borderColor: string;
  /** Card background fill. */
  background: string;
  /** Course code, status label, icon colour. */
  textColor: string;
  icon: LucideIcon;
  label: string;
  /** Specific prereq-pill colours. */
  prereqOkColor: string;
  prereqMissingColor: string;
}

const STATUS_PALETTE_DARK: Record<CourseMapStatus, StatusPalette> = {
  passed: {
    borderColor: 'rgba(16, 185, 129, 0.4)',     // emerald-500/40
    background: 'rgba(16, 185, 129, 0.15)',     // emerald-500/15
    textColor: '#a7f3d0',                       // emerald-200
    icon: CheckCircle2,
    label: 'Passed',
    prereqOkColor: '#6ee7b7',                   // emerald-300
    prereqMissingColor: '#fca5a5',              // rose-300
  },
  failed: {
    borderColor: 'rgba(225, 29, 72, 0.6)',      // rose-600/60
    background: 'rgba(225, 29, 72, 0.15)',      // rose-600/15
    textColor: '#fecdd3',                       // rose-200
    icon: XCircle,
    label: 'Failed',
    prereqOkColor: '#6ee7b7',
    prereqMissingColor: '#fca5a5',
  },
  'failed-prereq': {
    borderColor: 'rgba(236, 72, 153, 0.5)',     // pink-500/50
    background: 'rgba(236, 72, 153, 0.15)',     // pink-500/15
    textColor: '#fbcfe8',                       // pink-200
    icon: AlertTriangle,
    label: 'Prereq failed',
    prereqOkColor: '#6ee7b7',
    prereqMissingColor: '#fca5a5',
  },
  blocked: {
    borderColor: 'rgba(20, 184, 166, 0.5)',     // teal-500/50
    background: 'rgba(20, 184, 166, 0.15)',     // teal-500/15
    textColor: '#99f6e4',                       // teal-200
    icon: Lock,
    label: 'Blocked',
    prereqOkColor: '#6ee7b7',
    prereqMissingColor: '#fca5a5',
  },
  open: {
    borderColor: 'rgba(59, 130, 246, 0.4)',     // blue-500/40
    background: 'rgba(59, 130, 246, 0.15)',     // blue-500/15
    textColor: '#bfdbfe',                       // blue-200
    icon: Circle,
    label: 'Open',
    prereqOkColor: '#6ee7b7',
    prereqMissingColor: '#fca5a5',
  },
  planned: {
    borderColor: 'rgba(217, 70, 239, 0.6)',     // fuchsia-500/60
    background: 'rgba(217, 70, 239, 0.15)',     // fuchsia-500/15
    textColor: '#f5d0fe',                       // fuchsia-200
    icon: BookmarkCheck,
    label: 'Planned',
    prereqOkColor: '#6ee7b7',
    prereqMissingColor: '#fca5a5',
  },
  'in-program': {
    borderColor: 'rgba(255, 255, 255, 0.1)',    // white/10
    background: 'rgba(255, 255, 255, 0.05)',    // white/5
    textColor: '#cbd5e1',                       // slate-300
    icon: Circle,
    label: 'Other major',
    prereqOkColor: '#6ee7b7',
    prereqMissingColor: '#fca5a5',
  },
};

/**
 * Light-theme palette — the same status categories but with
 * foreground text colours flipped to 700/800 shades so the
 * course code, status label, and prereq chips stay legible on a
 * white page. Card backgrounds and borders get a touch more
 * saturation too (15% → 22%/55% alpha) so the colour-coded tiles
 * are visible on the white surface. The dark palette above uses
 * pale -200 foregrounds designed for slate-950; on white those
 * would be invisible.
 */
const STATUS_PALETTE_LIGHT: Record<CourseMapStatus, StatusPalette> = {
  passed: {
    borderColor: 'rgba(16, 185, 129, 0.55)',
    background: 'rgba(16, 185, 129, 0.18)',
    textColor: '#047857',                       // emerald-700
    icon: CheckCircle2,
    label: 'Passed',
    prereqOkColor: '#047857',                   // emerald-700
    prereqMissingColor: '#b91c1c',              // rose-700
  },
  failed: {
    borderColor: 'rgba(225, 29, 72, 0.6)',
    background: 'rgba(225, 29, 72, 0.18)',
    textColor: '#b91c1c',                       // rose-700
    icon: XCircle,
    label: 'Failed',
    prereqOkColor: '#047857',
    prereqMissingColor: '#b91c1c',
  },
  'failed-prereq': {
    borderColor: 'rgba(236, 72, 153, 0.6)',
    background: 'rgba(236, 72, 153, 0.18)',
    textColor: '#9d174d',                       // pink-700
    icon: AlertTriangle,
    label: 'Prereq failed',
    prereqOkColor: '#047857',
    prereqMissingColor: '#b91c1c',
  },
  blocked: {
    borderColor: 'rgba(20, 184, 166, 0.6)',
    background: 'rgba(20, 184, 166, 0.22)',
    textColor: '#0f766e',                       // teal-700
    icon: Lock,
    label: 'Blocked',
    prereqOkColor: '#047857',
    prereqMissingColor: '#b91c1c',
  },
  open: {
    borderColor: 'rgba(59, 130, 246, 0.6)',
    background: 'rgba(59, 130, 246, 0.18)',
    textColor: '#1d4ed8',                       // blue-700
    icon: Circle,
    label: 'Open',
    prereqOkColor: '#047857',
    prereqMissingColor: '#b91c1c',
  },
  planned: {
    borderColor: 'rgba(217, 70, 239, 0.65)',
    background: 'rgba(217, 70, 239, 0.22)',
    textColor: '#a21caf',                       // fuchsia-700
    icon: BookmarkCheck,
    label: 'Planned',
    prereqOkColor: '#047857',
    prereqMissingColor: '#b91c1c',
  },
  'in-program': {
    borderColor: 'rgba(15, 23, 42, 0.18)',      // slate-900/18
    background: 'rgba(241, 245, 249, 0.9)',     // slate-100
    textColor: '#334155',                       // slate-700
    icon: Circle,
    label: 'Other major',
    prereqOkColor: '#047857',
    prereqMissingColor: '#b91c1c',
  },
};

/** Backwards-compatible alias for callers that read the dark palette
 *  directly (the Legend swatches in the test fixtures). */
const STATUS_PALETTE = STATUS_PALETTE_DARK;

/**
 * Plan-classification palette — distinct colours for courses the
 * student has put on the active plan, derived from their grade-book
 * (New / Enhancing / Repeated). The dark palette mirrors the
 * on-screen `PLAN_CARD_STYLES` in PrereqMapScreen.tsx; the light
 * palette uses 700-shade foregrounds for legibility on white. When
 * a card has a classification the print tree uses the matching
 * plan palette INSTEAD of the prereq-derived status palette so the
 * "On plan" + classification is unmistakable on the printout.
 *
 * Palette (matches the on-screen picks):
 *   - new       → violet  (cool, "fresh start")
 *   - enhancing → cyan    (cool, "topping up")
 *   - repeated  → orange  (warm, "needs attention")
 */
type PlanClassification = NonNullable<MappedCourse['planClassification']>;
const PLAN_PALETTE_DARK: Record<
  PlanClassification,
  Omit<StatusPalette, 'icon'> & { icon: LucideIcon }
> = {
  new: {
    borderColor: 'rgba(139, 92, 246, 0.6)', // violet-500/60
    background: 'rgba(139, 92, 246, 0.15)', // violet-500/15
    textColor: '#ddd6fe',                   // violet-200
    icon: BookmarkCheck,
    label: 'New',
    prereqOkColor: '#6ee7b7',
    prereqMissingColor: '#fca5a5',
  },
  enhancing: {
    borderColor: 'rgba(6, 182, 212, 0.6)',  // cyan-500/60
    background: 'rgba(6, 182, 212, 0.15)',  // cyan-500/15
    textColor: '#a5f3fc',                   // cyan-200
    icon: BookmarkCheck,
    label: 'Enhancing',
    prereqOkColor: '#6ee7b7',
    prereqMissingColor: '#fca5a5',
  },
  repeated: {
    borderColor: 'rgba(251, 146, 60, 0.5)',   // slightly more saturated border
    background: 'rgba(251, 146, 60, 0.18)',   // slightly stronger tint
    textColor: '#fdba74',                     // orange-300  ← was orange-200
    icon: RefreshCw,
    label: 'Repeated',
    prereqOkColor: '#6ee7b7',
    prereqMissingColor: '#fca5a5',
  },
};

const PLAN_PALETTE_LIGHT: Record<
  PlanClassification,
  Omit<StatusPalette, 'icon'> & { icon: LucideIcon }
> = {
  new: {
    borderColor: 'rgba(139, 92, 246, 0.65)',
    background: 'rgba(139, 92, 246, 0.22)',
    textColor: '#6d28d9',                   // violet-700
    icon: BookmarkCheck,
    label: 'New',
    prereqOkColor: '#047857',
    prereqMissingColor: '#b91c1c',
  },
  enhancing: {
    borderColor: 'rgba(6, 182, 212, 0.65)',
    background: 'rgba(6, 182, 212, 0.22)',
    textColor: '#0e7490',                   // cyan-700
    icon: BookmarkCheck,
    label: 'Enhancing',
    prereqOkColor: '#047857',
    prereqMissingColor: '#b91c1c',
  },
  repeated: {
    borderColor: 'rgba(249, 115, 22, 0.7)',   // stronger border
    background: 'rgba(249, 115, 22, 0.25)',   // more saturated background
    textColor: '#ea580c',                     // orange-600  ← was orange-700
    icon: RefreshCw,
    label: 'Repeated',
    prereqOkColor: '#047857',
    prereqMissingColor: '#b91c1c',
  },
};

/** Pick the right palette for a card. The plan palette wins when
 *  the course has a classification (i.e. it's on the active plan);
 *  otherwise we fall back to the prereq-derived status palette. */
function pickPalette(course: MappedCourse, theme: 'dark' | 'light'): StatusPalette {
  if (course.planClassification) {
    const src = theme === 'light' ? PLAN_PALETTE_LIGHT : PLAN_PALETTE_DARK;
    return src[course.planClassification];
  }
  return (theme === 'light' ? STATUS_PALETTE_LIGHT : STATUS_PALETTE_DARK)[course.status];
}

/** Resolve a grade's color token into a hex string for the active
 *  print theme. Thin wrapper around the shared token map so the
 *  call site reads as "give me a colour for this grade on this
 *  page". */
function gradeTextColorFor(grade: string, theme: 'dark' | 'light'): string {
  const token = gradeTextToken(grade);
  return theme === 'light' ? PRINT_COLOR_LIGHT[token] : PRINT_COLOR_DARK[token];
}

export default function PrereqMapPrint({
  rows,
  catalog,
  roster,
  metricsByStudent,
  limit,
  studentId,
  planByStudent,
  theme = 'dark',
}: PrereqMapPrintProps) {
  // Stable student order — by student id asc — so the printout reads
  // the same on every run. Skip students with no metric.
  // The optional `studentId` filter (used by the "Print this map"
  // button) trims the list to one entry; `limit` still wins over
  // it because limit is the smoke-test escape hatch.
  const students = useMemo(() => {
    const list = Object.values(metricsByStudent).sort((a, b) =>
      a.studentId.localeCompare(b.studentId)
    );
    if (typeof limit === 'number') return list.slice(0, limit);
    if (studentId) return list.filter((s) => s.studentId === studentId);
    return list;
  }, [metricsByStudent, limit, studentId]);

  // Use the roster for the rendered name as a fallback when the
  // metric name is missing.
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of roster) m.set(r.studentId, r.studentName?.trim() || '');
    return m;
  }, [roster]);

  return (
    <div data-print="prereq-maps" className="pmaps-root">
      {students.map((s) => (
        <StudentPage
          key={s.studentId}
          student={s}
          fallbackName={nameById.get(s.studentId) || ''}
          rows={rows}
          catalog={catalog}
          theme={theme}
          planCodes={planByStudent?.[s.studentId] ?? []}
        />
      ))}
    </div>
  );
}

function StudentPage({
  student,
  fallbackName,
  rows,
  catalog,
  theme,
  planCodes,
}: {
  student: StudentMetrics;
  fallbackName: string;
  rows: GradeRow[];
  catalog: CourseCatalog | null;
  theme: 'dark' | 'light';
  /** Active-term entries for THIS student — fed into buildPrereqMap
   *  so cards on the plan render with the New/Enhancing/Repeated
   *  palette instead of the prereq-derived status. */
  planCodes: string[];
}) {
  const name = student.name?.trim() || fallbackName || `Student ${student.studentId}`;
  const mapData = useMemo(
    () =>
      buildPrereqMap(catalog, rows, student.studentId, student.major, {
        courseCodes: planCodes,
      }),
    [catalog, rows, student.studentId, student.major, planCodes]
  );

  // Build a course-by-code lookup so we can resolve prereq codes into
  // "passed" / "missing" for the print.
  const courseByCode = useMemo(() => {
    const m = new Map<string, MappedCourse>();
    for (const col of mapData.semesters) {
      for (const c of col.courses) m.set(c.code, c);
    }
    return m;
  }, [mapData]);

  // Light theme swaps the page chrome (background + base text) but
  // keeps every per-status colour intact — the JSX inline styles use
  // the same palette for both, since emerald-500 on white reads just
  // as well as emerald-500 on slate-950.
  const pageClass = theme === 'light' ? 'pmaps-page pmaps-page-light' : 'pmaps-page';

  return (
    <div data-print-page className={pageClass}>
      <div className="pmaps-header">
        <div className="pmaps-label">Student</div>
        <div className="pmaps-name">
          {name}
          <span className="pmaps-id">{student.studentId}</span>
        </div>
        <div className="pmaps-label">Major</div>
        <div className="pmaps-major">
          {student.major || 'Undeclared'}
          {mapData.majorMismatch && mapData.resolvedMajor && (
            <span className="pmaps-mismatch">
              (showing plan for {mapData.resolvedMajor})
            </span>
          )}
        </div>
        <div className="pmaps-label">Summary</div>
        <div className="pmaps-summary">
          <span className="pmaps-summary-line">
            GPA {student.gpa.toFixed(3)} · {student.totalUnits} cr passed ·{' '}
            {student.failedCourseCodes.length} failure(s)
          </span>
        </div>
      </div>

      {/* Two-card plan-impact strip — mirrors the on-screen
          PlanStats component so the printed handout shows the
          same rolled-up figures the adviser saw on screen. */}
      <PlanStatsGrid
        student={student}
        planCodes={planCodes}
        catalog={catalog}
        rows={rows}
        theme={theme}
      />

      {mapData.semesters.map((col) => (
        <SemesterRowView
          key={col.number}
          column={col}
          courseByCode={courseByCode}
          theme={theme}
          studentGpa={student.gpa}
        />
      ))}

      <Legend theme={theme} />
    </div>
  );
}

/**
 * Print version of the on-screen `<PlanStats>` strip — two cards
 * laid out side-by-side via flex, each with a small list of
 * label/value rows. Colours flip with the page theme so the
 * printed page stays legible on both dark and light stock.
 *
 * The card and row shells are now `PrintStatCard` / `PrintStatRow`
 * from `shared/PrintStatCard.tsx`; the plan breakdown is computed by
 * `computePlanStats` (shared with the on-screen strip). The only
 * thing this component still owns is the strip layout (a flex row
 * with two cards) — every value colour is picked via `ColorToken`
 * through the shared map.
 */
function PlanStatsGrid({
  student,
  planCodes,
  catalog,
  rows,
  theme,
}: {
  student: StudentMetrics;
  planCodes: string[];
  catalog: CourseCatalog | null;
  rows: GradeRow[];
  theme: 'dark' | 'light';
}) {
  const creditByCode = useMemo(() => buildCreditByCode(catalog), [catalog]);

  const planStats = useMemo(
    () =>
      computePlanStats({
        studentId: student.studentId,
        metricGpa: student.gpa,
        totalUnits: student.totalUnits,
        totalFailedUnits: student.totalFailedUnits,
        planCodes,
        rows,
        creditByCode,
      }),
    [
      student.studentId,
      student.gpa,
      student.totalUnits,
      student.totalFailedUnits,
      planCodes,
      rows,
      creditByCode,
    ]
  );

  const totalHours = student.totalUnits + student.totalFailedUnits;
  const gpaTrend = planStats.expectedGpa == null ? null : planStats.expectedGpa - student.gpa;

  // "Plain text" foreground inside the cards. Pulled from the shared
  // PRINT_COLOR_* map under the `slate` token so a future palette
  // tweak stays a one-file change.
  const fgToken: 'slate' = 'slate';

  return (
    <div className="pmaps-stat-strip">
      <PrintStatCard title="Current standing" theme={theme}>
        <PrintStatRow label="Current GPA" value={student.gpa.toFixed(3)} valueColor={gpaToken(student.gpa)} theme={theme} />
        <PrintStatRow label="Total passed hours" value={`${student.totalUnits}`} valueColor={fgToken} theme={theme} />
        <PrintStatRow
          label="Failed hours"
          value={`${student.totalFailedUnits}`}
          valueColor={student.totalFailedUnits > 0 ? 'rose' : fgToken}
          theme={theme}
        />
        <PrintStatRow label="Total hours" value={`${totalHours}`} valueColor={fgToken} theme={theme} />
        <PrintStatRow
          label="Term registered hours"
          value={`${planStats.registeredHours}`}
          valueColor={planStats.registeredHours > 0 ? 'fuchsia' : fgToken}
          theme={theme}
        />
      </PrintStatCard>
      <PrintStatCard title="Plan impact" theme={theme}>
        <PrintStatRow label="New CH" value={`${planStats.newCh}`} valueColor="violet" theme={theme} />
        <PrintStatRow label="Enhancing CH" value={`${planStats.enhancingCh}`} valueColor="cyan" theme={theme} />
        <PrintStatRow label="Repeated CH" value={`${planStats.repeatedCh}`} valueColor="orange" theme={theme} />
        <PrintStatRow
          label="Expected GPA"
          value={planStats.expectedGpa == null ? '—' : planStats.expectedGpa.toFixed(3)}
          valueColor={
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
          theme={theme}
        />
      </PrintStatCard>
    </div>
  );
}

function SemesterRowView({
  column,
  courseByCode,
  theme,
  studentGpa,
}: {
  column: { number: number; courses: MappedCourse[] };
  courseByCode: Map<string, MappedCourse>;
  theme: 'dark' | 'light';
  /** Active student's cumulative GPA — only used on cards that have
   *  never been attempted (no latest grade to show). */
  studentGpa: number;
}) {
  return (
    <div className="pmaps-semester">
      <div className="pmaps-sem-label">
        Semester
        <span className="pmaps-sem-num">{column.number}</span>
      </div>
      <div className="pmaps-sem-body">
        {column.courses.length === 0 ? (
          <div className="pmaps-sem-empty">No courses for this semester</div>
        ) : (
          <div className="pmaps-cards">
            {column.courses.map((c) => (
              <CourseCard
                key={c.code}
                course={c}
                courseByCode={courseByCode}
                theme={theme}
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
  courseByCode,
  theme,
  studentGpa,
}: {
  course: MappedCourse;
  courseByCode: Map<string, MappedCourse>;
  theme: 'dark' | 'light';
  /**
   * Active student's cumulative GPA. Currently unused on the print
   * card itself — the per-course grade row always renders a letter
   * or an em-dash, never the student's overall GPA. Kept on the
   * prop list so the parent keeps threading it without changing
   * the call site.
   */
  studentGpa: number;
}) {
  // Pick the right palette: dark uses pale-200 foregrounds (designed
  // for slate-950); light uses 700-shade foregrounds (designed for
  // white). The plan-classification palette wins over the prereq-
  // derived status when the card has one (i.e. it's on the active
  // plan).
  const palette = pickPalette(course, theme);
  const Icon = palette.icon;
  return (
    <div
      className="pmaps-card"
      data-card-classification={course.planClassification ?? ''}
      style={{
        borderColor: palette.borderColor,
        backgroundColor: palette.background,
      }}
    >
      <div className="pmaps-card-top">
        <span
          className="pmaps-code"
          style={{
            color: palette.textColor,
            borderColor: palette.borderColor,
          }}
        >
          {course.code}
        </span>
        <Icon
          className="pmaps-card-icon"
          style={{ color: palette.textColor }}
        />
      </div>
      <div className="pmaps-title">{course.title}</div>
      <div className="pmaps-meta">
        <span className="pmaps-credits">{course.credits} cr</span>
        <span
          className="pmaps-status-label"
          style={{ color: palette.textColor }}
        >
          {palette.label}
        </span>
      </div>
      {/*
        Grade row: letter grade the student earned in THIS specific
        course, em-dash when never attempted. Never falls back to the
        student's overall GPA (that lives in the page header) so two
        cards with the same dash unambiguously mean "never taken".
      */}
      <div className="pmaps-grade-row">
        <span className="pmaps-grade-label">Grade</span>
        {course.latestGrade ? (
          <span
            className="pmaps-grade-value"
            style={{ color: gradeTextColorFor(course.latestGrade, theme) }}
          >
            {formatGradeWithPoints(course.latestGrade)}
          </span>
        ) : (
          <span
            className="pmaps-grade-value"
            style={{ color: theme === 'light' ? '#64748b' : '#64748b' }}
            title="Course has never been attempted"
          >
            —
          </span>
        )}
      </div>
      {course.prereqCodes.length > 0 && (
        <div className="pmaps-prereqs">
          <span className="pmaps-prereqs-label">prereqs:</span>{' '}
          {course.prereqCodes.map((p, i) => {
            const target = courseByCode.get(p);
            const passed = target?.status === 'passed';
            const failed = target?.status === 'failed';
            const isMissing =
              !passed && (failed || course.missingPrereqs.includes(p));
            const color = passed
              ? palette.prereqOkColor
              : isMissing
                ? palette.prereqMissingColor
                : theme === 'light'
                  ? '#475569'   // slate-600 on white
                  : '#475569';  // slate-600 on dark — same hex works
            return (
              <span key={p}>
                <span
                  className="pmaps-prereq-pill"
                  style={{
                    color,
                    fontWeight: isMissing || passed ? 700 : 400,
                  }}
                >
                  {p}
                </span>
                {i < course.prereqCodes.length - 1 && (
                  <span className="pmaps-prereq-sep"> · </span>
                )}
              </span>
            );
          })}
        </div>
      )}
      {/*
        Blocks row — the inverse of the prereq row. Lists
        downstream courses (within the active major's plan) that
        this card is a prereq for. Suppressed when the course has
        no dependents in this major. Uses the plan-palette's
        prereq-OK colour (emerald) on dark, green on light, so the
        eye can tell prereq chips (status-driven colours) from
        blocks chips (always green = "unlocks") at a glance on
        the printed page.
      */}
      {course.blocks.length > 0 && (
        <div className="pmaps-prereqs">
          <span className="pmaps-prereqs-label">blocks:</span>{' '}
          {course.blocks.map((p, i) => (
            <span key={p}>
              <span
                className="pmaps-prereq-pill"
                style={{
                  color: palette.prereqOkColor,
                  fontWeight: 700,
                }}
              >
                {p}
              </span>
              {i < course.blocks.length - 1 && (
                <span className="pmaps-prereq-sep"> · </span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Legend({ theme }: { theme: 'dark' | 'light' }) {
  // Same legend order as the on-screen screen so the print matches.
  const order: CourseMapStatus[] = [
    'passed',
    'failed',
    'failed-prereq',
    'blocked',
    'open',
    'planned',
    'in-program',
  ];
  const palette = theme === 'light' ? STATUS_PALETTE_LIGHT : STATUS_PALETTE_DARK;
  const planPalette = theme === 'light' ? PLAN_PALETTE_LIGHT : PLAN_PALETTE_DARK;
  return (
    <div className="pmaps-legend">
      {order.map((s) => {
        const p = palette[s];
        const Icon = p.icon;
        return (
          <span key={s} className="pmaps-legend-item">
            <span
              className="pmaps-legend-swatch"
              style={{
                borderColor: p.borderColor,
                backgroundColor: p.background,
                color: p.textColor,
              }}
            >
              <Icon className="pmaps-legend-icon" />
            </span>
            <span className="pmaps-legend-label">{p.label}</span>
          </span>
        );
      })}
      {(['new', 'enhancing', 'repeated'] as PlanClassification[]).map((k) => {
        const p = planPalette[k];
        return (
          <span key={k} className="pmaps-legend-item">
            <span
              className="pmaps-legend-swatch"
              style={{
                borderColor: p.borderColor,
                backgroundColor: p.background,
                color: p.textColor,
              }}
            >
              <p.icon className="pmaps-legend-icon" />
            </span>
            <span className="pmaps-legend-label">{p.label}</span>
          </span>
        );
      })}
    </div>
  );
}

/* Backwards-compatible alias for callers that still consult the
 * palette directly. Returns the DARK palette — the historical
 * default. New code should pick dark/light explicitly. */
export const PrintPalette = STATUS_PALETTE_DARK;

/* Re-export `CatalogCourse` so the import-side of this file
   matches the rest of the print tree components. */
export type { CatalogCourse };