/**
 * Academic Advisor v2 — Data layer types.
 *
 * The shape mirrors the user's Python pipeline: a list of grade-book
 * rows keyed by student id, plus a course catalog imported separately.
 * Everything else (UI, advising queries, persistence) derives from
 * these two sources.
 */

/**
 * One row from the imported grade-book Excel. Mirrors the columns the
 * Python script reads (student_id, course, units, grade, term,
 * cumulative_gpa). Student name and major are optional because the
 * historical Excel did not always include them.
 */
export interface GradeRow {
  studentId: string;
  studentName?: string;
  major?: string;
  course: string;
  units: number;
  grade: string;
  term: string;
  cumulativeGpa?: number;
}

/**
 * Tuple identifying a single GradeRow attempt. One student may have
 * many attempts of the same course across different terms (retakes),
 * and the (studentId, course, term) triple uniquely pins one of them.
 *
 * Used by the DataContext CRUD mutators and the DataManagerModal as
 * the canonical edit/delete key — kept as an object (not a stringified
 * JSON) so callers can `Set`/`delete` it cleanly.
 */
export interface GradeRowKey {
  studentId: string;
  course: string;
  term: string;
}

/**
 * One course from the imported course catalog Excel. The schema is
 * intentionally permissive — extras live in the loose bag so the
 * importer does not have to know about every future column.
 */
export interface CatalogCourse {
  code: string;
  title: string;
  credits: number;
  prerequisites: string[];
  majors?: unknown;
  semesters?: unknown;
  [k: string]: unknown;
}

/**
 * The full course catalog. Major-plan data lives elsewhere for now
 * (the major-plan editor is a v2 feature).
 */
export interface CourseCatalog {
  courses: CatalogCourse[];
}

/**
 * Pre-computed numbers per student. Every advising query reads from
 * this object so the v1 UI never has to re-iterate the raw rows.
 */
export interface StudentMetrics {
  studentId: string;
  name: string;
  major: string;
  /** Cumulative GPA as reported on the student's last term row. */
  gpa: number;
  /** Sum of unique passed-course credits (failed courses do not count). */
  totalUnits: number;
  /**
   * Sum of credits across every unique failed-course code (credits do
   * not change across retakes). Tracked separately from `totalUnits`
   * so the export and the UI can show "passed vs failed" at a glance.
   */
  totalFailedUnits: number;
  /** Codes the student failed (every attempt starts with F/FD/FA/FL). */
  failedCourseCodes: string[];
  /** Codes still missing from the catalog's "next term" for this student. */
  missingPrereqsForNextTerm: string[];
  /** True if a course already failed appears in any imported plan. */
  hasPlannedConflict: boolean;
  /**
   * Number of distinct terms the student appears in on the grade-book
   * + 1. A fresh student is semester 1; a student with two completed
   * terms is in semester 3 (their *next* term). Used by the Suggest
   * tab to render "Currently in semester N".
   */
  currentSemester: number;
  /** Roster email (optional). */
  email?: string;
  /** Roster national ID (optional). */
  nationalId?: string;
  /**
   * Academic level derived from `totalPassedUnits` and `gpa` using the
   * Excel formula:
   *   IF(K<33,"Level 0", IF(K<66,"Level 1", IF(K<99,"Level 2",
   *     IF(K<132,"Level 3", IF(K<165,"Level 4",
   *       IF(K=165, IF(GPA>=2,"Graduated","ERROR"), "ERROR"))))))
   * `K` = total passed units, GPA = cumulative GPA from the last term.
   */
  level: StudentLevel;
}

/** Seven literal strings returned by `studentLevel()`. */
export type StudentLevel =
  | 'Level 0'
  | 'Level 1'
  | 'Level 2'
  | 'Level 3'
  | 'Level 4'
  | 'Graduated'
  | 'ERROR';

/**
 * The four advising queries the v1 UI exposes. Adding a new query in
 * v2 means adding a new case here plus a function in advising.ts.
 */
export type AdvisingQuery =
  | {
      kind: 'failed-course';
      courseCode: string;
      /** Optional free-text on student name (case-insensitive contains). */
      studentName?: string;
      /** Optional exact-major match. Omit or 'all' = no filter. */
      major?: string;
    }
  | { kind: 'blocked-next-term' }
  | { kind: 'suggest-next-registration'; studentId: string }
  | { kind: 'planned-conflict' };

/**
 * A row in the result list for any advising query. The UI consumes
 * this directly so each query can return whatever shape makes sense
 * without leaking into the UI layer.
 */
export interface AdvisingResultRow {
  studentId: string;
  studentName: string;
  major: string;
  /** Context-specific payload rendered in the panel. */
  detail: string;
  /** Optional sub-list (e.g. failed course codes for this student). */
  items?: string[];
  /**
   * For queries that group by status (e.g. suggest-next-registration),
   * the dispatcher attaches the per-status count map on the FIRST
   * result row of the query so the panel can render badges without
   * re-grouping. Undefined for flat-row queries.
   */
  groupCounts?: { open: number; blocked: number; 'failed-prereq': number };
  /**
   * Set by the dispatcher to tell the panel which status group this
   * row belongs to (for grouped rendering). Undefined for flat rows.
   */
  groupKey?: 'open' | 'blocked' | 'failed-prereq';
  /**
   * Set on suggest-next-registration rows so the panel can render
   * the "blocks N downstream" chip on failed-prereq cards. Only set
   * when meaningful; undefined for other queries.
   */
  blockingImpact?: number;
}

/**
 * The complete imported-data state. This is the shape serialised to
 * localStorage on every mutation and re-hydrated on app boot.
 */
/**
 * One row from the imported student-roster Excel. Pairs a `studentId`
 * with a friendly name + major. Optional because the grade-book itself
 * may also carry these columns — the roster just lets you avoid editing
 * each grade row.
 */
export interface RosterEntry {
  studentId: string;
  studentName?: string;
  major?: string;
  /** Imported from the optional roster "email" column. */
  email?: string;
  /** Imported from the optional roster "nationalId" / "National ID" column. */
  nationalId?: string;
  phone?: string;   // <-- add this
  /**
   * Firebase uid of the advisor this student is assigned to. Optional
   * and only meaningful once cloud sync is in use — unset for purely
   * offline/local data. Set automatically the first time a signed-in
   * advisor syncs a student who doesn't already have one. A "master"
   * account never overwrites this field.
   */
  advisorId?: string;
  sisRegistered?: boolean;
  /**
   * Advisor-confirmed: the student paid their registration fees on
   * SIS ("تم الدفع على SIS"). Same toggling/sync path as
   * `sisRegistered`.
   */
  sisPaid?: boolean;
  /** SIS password for the student (imported, never displayed). */
  sisPwd?: string;
}

export interface DataState {
  rows: GradeRow[];
  catalog: CourseCatalog | null;
  /** Imported roster (id + name + major, one row per student). */
  roster: RosterEntry[];
  /**
   * Named registration terms the user is building. A Term holds one
   * entry per student (their course list for that term). Many terms
   * may exist; the user picks which one is "active" via the picker in
   * the prereq-map header.
   */
  terms: Term[];
  /** The Term the user is currently editing. Persisted so reload
   *  restores the same context. Null only when terms is empty. */
  activeTermId: string | null;
  masterSchedule: MasterSchedule | null;   
  plans?: PlannedTerm[];
  
  // Global Schedule State
  enforceSchedule?: boolean;
  scheduleTerm?: string;
  studentGroup?: string;
}

/**
 * One student's course list inside a single Term. At most one entry
 * per `(termId, studentId)` pair — the DataContext reducer enforces
 * this by upserting on addCourseToTerm.
 */
export interface TermEntry {
  studentId: string;
  courseCodes: string[];
}

/**
 * A named registration term. The id is generated locally (no
 * coordination with a backend). `createdAt` lets the UI sort
 * terms by age when the user has many of them.
 */
export interface Term {
  id: string;
  name: string;
  createdAt: string;
  entries: TermEntry[];
}

/**
 * @deprecated Use `Term` + `TermEntry`. This shape was the v2
 * per-student plan and is still accepted by storage.ts's migration
 * path so older localStorage payloads don't lose data on upgrade.
 */
export interface PlannedTerm {
  studentId: string;
  termId: string;
  termName: string;
  courseCodes: string[];
}



// ──────────────────────────────────────────────
// 1. Session type (lecture, lab, tutorial)
// ──────────────────────────────────────────────
export type SessionType = 'LEC' | 'LAB' | 'TUT';

// ──────────────────────────────────────────────
// 2. Student groups / majors (columns in timetable)
// ──────────────────────────────────────────────
export interface ProgramGroup {
  id: string;   // e.g., "MEC-G1", "MEC-G2", "Energy"
  name: string; // e.g., "Mechatronics Group 1"
  department: string;
}

// ──────────────────────────────────────────────
// 3. Exact day & time of a session
// ──────────────────────────────────────────────
export interface TimeSlot {
  dayOfWeek:
    | 'Saturday'
    | 'Sunday'
    | 'Monday'
    | 'Tuesday'
    | 'Wednesday'
    | 'Thursday'
    | 'Friday';
  /** 24‑hour string, e.g. "09:00" */
  startTime: string;
  /** 24‑hour string, e.g. "11:30" (can span multiple grid cells) */
  endTime: string;
}

// ──────────────────────────────────────────────
// 4. One coloured block on the timetable
// ──────────────────────────────────────────────
export interface ClassSession {
  id: string;                 // unique id (e.g., row number or generated)
  term: string;               // e.g., "Fall 2026" — the schedule term this session belongs to
  targetGroups: string[];     // ProgramGroup.id array
  courseCode: string;         // e.g., "MEC212"
  courseName: string;         // e.g., "Stress Analysis"
  sessionType: SessionType;   // LEC / LAB / TUT
  instructorName: string;
  roomCode: string;
  sisClassNumber: string;     // used to link to capacity/enrollment data later
  time: TimeSlot;

  // ───── future extensions (optional) ─────
  /** Seat capacity (optional, add when you have the data) */
  capacity?: number;
  /** Currently enrolled students (optional) */
  enrolled?: number;
  /** Override open/closed status (optional) */
  statusOverride?: SectionStatus;
  /**
   * Set by the "Sync SIS Class Numbers" flow when this session's time no
   * longer matches what PeopleSoft reports and a corrected replacement
   * session has been added instead. Outdated sessions are kept (not
   * deleted) for audit purposes but are excluded from scheduling logic
   * (getSessionsForCourse / getConflictingSessions) and from the
   * timetable grid.
   */
  outdated?: boolean;
  /** Id of the replacement session created for this one, if any. */
  supersededBy?: string;
}

// ──────────────────────────────────────────────
// 5. Root schedule for a specific term
// ──────────────────────────────────────────────
export interface MasterSchedule {
  term: string;               // e.g., "Fall 2026" or "Spring Term 2025-2026"
  /** ID of the Term this schedule belongs to. Set on cloud sync. */
  termId?: string;
  groups: ProgramGroup[];
  sessions: ClassSession[];
}

// ──────────────────────────────────────────────
// Helper: determine open/closed from session list
// ──────────────────────────────────────────────
export type SectionStatus = 'Open' | 'Closed' | 'Unknown' | 'Waitlist' | 'Online';

export function getSectionStatus(session: ClassSession): SectionStatus {
  if (session.statusOverride) return session.statusOverride;
  if (session.capacity != null && session.enrolled != null) {
    if (session.capacity <= 0) return 'Unknown';
    return session.enrolled >= session.capacity ? 'Closed' : 'Open';
  }
  // Without capacity data, if the session exists we assume open.
  return 'Open';
}

export function isOnlineSession(session: ClassSession): boolean {
  return session.statusOverride === 'Online';
}


export function doTimeSlotsOverlap(a: TimeSlot, b: TimeSlot): boolean {
  if (a.dayOfWeek !== b.dayOfWeek) return false;            // different day → no conflict
  const aStart = a.startTime;   // e.g., "09:00"
  const aEnd = a.endTime;
  const bStart = b.startTime;
  const bEnd = b.endTime;
  // Overlap if one starts before the other ends.
  return aStart < bEnd && bStart < aEnd;
}