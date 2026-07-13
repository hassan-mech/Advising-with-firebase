/**
 * DataContext — v2.
 *
 * Single React Context wrapping the imported grade-book rows + course
 * catalog + named registration terms + plans-style persisted data.
 * Every component reads from `useData()` instead of receiving props.
 * The provider:
 *
 *   1. Hydrates from localStorage on mount (with v2→v3 migration).
 *   2. Persists to localStorage on every mutation.
 *   3. Auto-creates a default Term ("Summer 2025") on first mount
 *      when terms[] is empty, so the click-to-plan flow Just Works.
 *   4. Memoizes `metricsByStudent` from `rows` + `terms`.
 *   5. Memoizes `query` results keyed by `(query, state)`.
 *
 * State mutators accept a File (from `<input type=file>`) or no
 * argument (for clear/export). They never block on UI work — parsers
 * are async because they read the ArrayBuffer.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type {
  AdvisingQuery,
  AdvisingResultRow,
  CatalogCourse,
  CourseCatalog,
  DataState,
  GradeRow,
  GradeRowKey,
  RosterEntry,
  StudentMetrics,
  Term,
  TermEntry,
  MasterSchedule,
  ClassSession,
} from './types';
import { doTimeSlotsOverlap } from './types';   // ← value import
import {
  emptyState,
  exportDataFile,
  importDataFile,
  loadData,
  saveData,
  loadMasterScheduleIDB,
  saveMasterScheduleIDB,
} from './storage';
import { parseGradeBook } from './parseGradeBook';
import { parseCatalog } from './parseCatalog';
import { parseRoster } from './parseRoster';
import { parseScheduleCSV } from './parseScheule'
import {
  parseSisClassNumbersJson,
  syncSisClassNumbers as applySisSync,
  formatSyncSummary,
  type SyncSisSummary,
  type SyncSisResult,
} from './syncSis'
import {
  failedSubjects,
  lastTermGpa,
  currentSemesterForStudent,
  rowsForStudent,
  studentLevel,
  studentRoster,
  totalFailedUnits,
  totalPassedUnits,
} from './metrics';
import { normalizeCourseCodeLoose } from './normalize';
import {
  catalogStatusForStudent,
  studentsBlockedFromNextTerm,
  studentsWhoFailedCourse,
  studentsWithPlannedConflict,
  suggestNextRegistration,
} from './advising';
import { readAndParseAscXML } from './ascXmlParser'

// ---------------------------------------------------------------------------
// Context value shape
// ---------------------------------------------------------------------------

interface DataContextValue {
  state: DataState;
  metricsByStudent: Record<string, StudentMetrics>;
  catalogIndex: Map<string, CatalogCourse>;
  /** Number of unique students in the dataset. */
  studentCount: number;
  importGradeBook(file: File): Promise<void>;
  importCatalog(file: File): Promise<void>;
  importRoster(file: File): Promise<void>;
  importScheduleFromXML(file: File, term: string): Promise<{ ok: boolean; sessions: number; error?: string }>;

  // --- Grade-book CRUD (added for Manage data modal) ---
  /** Add one GradeRow. Rejects if (studentId, course, term) collides
   *  with an existing row — caller should `updateGradeRow` instead. */
  addGradeRow(row: GradeRow): boolean;
  /** Update an existing GradeRow by its key. No-op if the key is missing. */
  updateGradeRow(key: GradeRowKey, patch: Partial<GradeRow>): void;
  /** Bulk-delete rows by key. Rows that don't exist are silently skipped. */
  deleteGradeRows(keys: GradeRowKey[]): void;
  /** Wipe the entire grade-book (with confirm at the caller). */
  clearGradeRows(): void;
  /** Parse a file and append rows whose key isn't already present.
   *  Reports "added N, skipped M" via `lastError`. */
  importGradeBookAppend(file: File): Promise<void>;

  // --- Catalog CRUD ---
  /** Add one CatalogCourse. Rejects if the normalized code already exists. */
  addCatalogCourse(course: CatalogCourse): boolean;
  /** Update an existing CatalogCourse identified by code (normalized). */
  updateCatalogCourse(code: string, patch: Partial<CatalogCourse>): void;
  /** Bulk-delete catalog entries by code (normalized). */
  deleteCatalogCourses(codes: string[]): void;
  /** Wipe the catalog (with confirm at the caller). */
  clearCatalog(): void;
  /** Append-only import. Codes already present are skipped. */
  importCatalogAppend(file: File): Promise<void>;

  // --- Roster CRUD ---
  /** Add one RosterEntry. Rejects if the studentId is already present. */
  addRosterEntry(entry: RosterEntry): boolean;
  /** Update an existing RosterEntry by studentId. */
  updateRosterEntry(studentId: string, patch: Partial<RosterEntry>): void;
  /** Bulk-delete roster entries by studentId. */
  deleteRosterEntries(studentIds: string[]): void;
  /** Wipe the roster (with confirm at the caller). */
  clearRoster(): void;
  /** Append-only import. Student ids already present are skipped. */
  importRosterAppend(file: File): Promise<void>;
  /** Loads GradeRow[] directly (used by the dev-only "demo" button). */
  loadDemoRows(rows: GradeRow[]): void;
  /**
   * Loads a CourseCatalog directly (used by the dev-only "demo"
   * button, which ships a tiny catalog alongside the demo rows so
   * the prereq map has courses to render immediately).
   */
  loadDemoCatalog(catalog: CourseCatalog): void;
  exportData(): void;
  /**
   * Restores the entire dataset from a JSON file produced by
   * `exportData()`. Replaces the current state on success; the
   * `lastError` channel surfaces parse / validation failures.
   */
  importData(file: File): Promise<void>;
  deleteData(): void;
  query(q: AdvisingQuery): AdvisingResultRow[];

  // --- Term management ---
  /** Create a new Term. Returns its id. Auto-activates it. */
  createTerm(name?: string): string;
  /** Rename an existing Term. */
  renameTerm(id: string, name: string): void;
  /** Delete a Term. If it was active, activeTermId becomes the
   *  next-most-recent term, or null if none remain. */
  deleteTerm(id: string): void;
  /** Duplicate a Term under a new name. Returns the new id. */
  duplicateTerm(id: string, newName: string): string;
  /** Switch which Term the UI is editing. */
  setActiveTerm(id: string | null): void;
  /** Upsert a course into a Term for a student (no-op if already there). */
  addCourseToTerm(termId: string, studentId: string, courseCode: string): void;
  /** Remove a course from a Term for a student (no-op if not there). */
  removeCourseFromTerm(termId: string, studentId: string, courseCode: string): void;
  /** Clear a student's course list inside a Term. */
  clearTermForStudent(termId: string, studentId: string): void;
  /** Add a course if missing, remove if present. The single-click UX
   *  the prereq map uses for "toggle on/off this term". */
  toggleCourseInActiveTerm(termId: string, studentId: string, courseCode: string): void;

  /** Last error from an import (cleared on the next import). */
  lastError: string | null;


  // --- Schedule ---
  importSchedule(file: File): Promise<void>;
  clearSchedule(): void;
  /** Get all ClassSessions for a course code in the loaded schedule. */
  getSessionsForCourse(courseCode: string, term?: string): ClassSession[];
  /** Returns array of new sessions that overlap with already planned ones. */
  getConflictingSessions(
    newCourseCode: string,
    plannedCourseCodes: string[]
  ): ClassSession[];

  // --- Schedule CRUD ---
  addClassSession(session: ClassSession): boolean;
  updateClassSession(id: string, patch: Partial<ClassSession>): void;
  deleteClassSessions(ids: string[]): void;
  setMasterSchedule(schedule: MasterSchedule | null): void;

  /**
   * Reads a `classNumbers.json` file (the output of the Playwright
   * `fetchClassNumbers.ts` scraper) and updates `sisClassNumber` across
   * the current schedule. Exact day+time matches are updated in place;
   * sections whose time changed on SIS get a new corrected session while
   * the old one is kept and marked `outdated`. Surfaces a summary via
   * `lastError`. See `src/data/syncSis.ts` for the full matching rules.
   */
  syncSisClassNumbers(file: File): Promise<{ ok: boolean; summary?: SyncSisSummary; error?: string }>;
  /** The full result of the most recent SIS sync, including per-session
   *  change records. Null if no sync has been performed (or was cleared). */
  sisSyncResult: SyncSisResult | null;
  /** Clear the stored SIS sync result (e.g. after user dismisses the review). */
  clearSisSyncResult(): void;

  // --- Global Schedule State ---
  setEnforceSchedule(enforce: boolean): void;
  setScheduleTerm(term: string): void;
  setStudentGroup(group: string): void;

  // --- Cloud sync (Firebase) ---
  /**
   * Merges data pulled from Firestore into local state: new students /
   * grade rows / term entries are added, and existing ones (matched by
   * studentId, or studentId+course+term for rows) are overwritten with
   * the cloud version — the cloud copy is treated as the source of
   * truth for whatever it contains, since it only ever holds this
   * advisor's own previously-synced students.
   */
  mergeCloudData(data: {
    roster: RosterEntry[];
    rows: GradeRow[];
    terms: Term[];
    catalog: CourseCatalog | null;
  }): void;
  /**
   * Full refresh from cloud — replaces local state with cloud data.
   * Use this when the adviser wants to pull latest cloud state and
   * discard local-only students (e.g. ones deleted/reassigned in cloud).
   */
  refreshFromCloud(data: {
    roster: RosterEntry[];
    rows: GradeRow[];
    terms: Term[];
    catalog: CourseCatalog | null;
  }): void;
}

const DataContext = createContext<DataContextValue | null>(null);

/**
 * Generate a unique id for a new Term. Uses a base-36 timestamp
 * plus a small random suffix — collision-resistant enough for a
 * client-only app where the user creates terms by hand.
 */
function newTermId(): string {
  return `term-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface DataProviderProps {
  children: React.ReactNode;
}

export function DataProvider({ children }: DataProviderProps) {
  const [state, setState] = useState<DataState>(() => {
    const loaded = loadData() ?? emptyState();
    // Seed a default Term so the click-to-plan flow works on first
    // visit. The active picker defaults to it. Shared via Firestore
    // so every signed-in advisor sees the same term.
    if (loaded.terms.length === 0) {
      const id = newTermId();
      loaded.terms = [
        { id, name: 'Summer 2025-2026', createdAt: new Date().toISOString(), entries: [] },
      ];
      loaded.activeTermId = id;
    }
    return loaded;
  });
  const [lastError, setLastError] = useState<string | null>(null);
  const [sisSyncResult, setSisSyncResult] = useState<SyncSisResult | null>(null);

  // ── IndexedDB: load masterSchedule on mount ──────────────────────────────
  // We flag when the IDB load is done so the save effect below never
  // overwrites the stored schedule with null before we've fetched it.
  const [idbScheduleLoaded, setIdbScheduleLoaded] = useState(false);

  useEffect(() => {
    loadMasterScheduleIDB().then((schedule) => {
      if (schedule) {
        setState((prev) => ({ ...prev, masterSchedule: schedule }));
      }
      setIdbScheduleLoaded(true);
    });
  }, []); // runs once on mount

  // ── Persist main state (excluding masterSchedule) to localStorage ────────
  // masterSchedule is stripped inside saveData(); quota is safe.
  useEffect(() => {
    saveData(state);
  }, [state]);

  // ── Persist masterSchedule to IndexedDB ──────────────────────────────────
  // Only after the initial IDB load completes so we don't accidentally
  // overwrite a saved schedule with null during startup.
  useEffect(() => {
    if (idbScheduleLoaded) {
      saveMasterScheduleIDB(state.masterSchedule);
    }
  }, [state.masterSchedule, idbScheduleLoaded]);

  const importGradeBook = useCallback(async (file: File) => {
    setLastError(null);
    try {
      const buffer = await file.arrayBuffer();
      const rows = parseGradeBook(buffer);
      if (rows.length === 0) {
        setLastError(
          'No rows found in the file. Check that the file is a grade-book Excel with a "student_id" / "course" / "grade" header row.'
        );
        return;
      }
      setState((prev) => ({ ...prev, rows }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastError(`Failed to import grade-book: ${msg}`);
    }
  }, []);

  const importCatalog = useCallback(async (file: File) => {
    setLastError(null);
    try {
      const buffer = await file.arrayBuffer();
      const catalog: CourseCatalog = parseCatalog(buffer);
      if (catalog.courses.length === 0) {
        setLastError(
          'No courses found in the file. Check that the file has a "code" / "title" / "credits" header row.'
        );
        return;
      }
      setState((prev) => ({ ...prev, catalog }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastError(`Failed to import catalog: ${msg}`);
    }
  }, []);

  const importRoster = useCallback(async (file: File) => {
    setLastError(null);
    try {
      const buffer = await file.arrayBuffer();
      const roster = parseRoster(buffer);
      if (roster.length === 0) {
        setLastError(
          'No rows found in the file. Check that the file has a "student_id" column.'
        );
        return;
      }
      setState((prev) => ({ ...prev, roster }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastError(`Failed to import roster: ${msg}`);
    }
  }, []);
  const importSchedule = useCallback(async (file: File) => {
    setLastError(null);
    try {
      const buffer = await file.arrayBuffer();
      const schedule = parseScheduleCSV(buffer); // we'll write this parser next
      if (!schedule) {
        setLastError('Could not parse schedule file. No valid sessions found.');
        return;
      }
      setState((prev) => ({ ...prev, masterSchedule: schedule }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastError(`Failed to import schedule: ${msg}`);
    }
  }, []);

  const clearSchedule = useCallback(() => {
    setLastError(null);
    setState((prev) => ({ ...prev, masterSchedule: null }));
  }, []);

  const importScheduleFromXML = useCallback(
    async (file: File, term: string): Promise<{ ok: boolean; sessions: number; error?: string }> => {
      setLastError(null);
      try {
        const schedule = await readAndParseAscXML(file, term);
        if (!schedule) {
          const msg = 'No sessions found — check the XML file and try again.';
          setLastError(msg);
          return { ok: false, sessions: 0, error: msg };
        }
        setState((prev) => ({ ...prev, masterSchedule: schedule }));
        return { ok: true, sessions: schedule.sessions.length };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setLastError(`Failed to import XML schedule: ${msg}`);
        return { ok: false, sessions: 0, error: msg };
      }
    },
    []
  );

  /**
   * Pure helper – uses the current state.masterSchedule.
   * We expose it via context so components don’t need to dig into state.
   */
  const getSessionsForCourse = useCallback(
    (courseCode: string, term?: string): ClassSession[] => {
      if (!state.masterSchedule) return [];
      const needle = normalizeCourseCodeLoose(courseCode);
      let results = state.masterSchedule.sessions.filter(
        s => normalizeCourseCodeLoose(s.courseCode) === needle && !s.outdated
      );
      if (term) {
        results = results.filter(s => s.term === term);
      }
      return results;
    },
    [state.masterSchedule]
  );

  const getConflictingSessions = useCallback(
    (newCode: string, plannedCodes: string[]): ClassSession[] => {
      if (!state.masterSchedule) return [];
      const newSessions = state.masterSchedule.sessions.filter(
        s => s.courseCode === newCode && !s.outdated
      );
      const plannedSessions = plannedCodes.flatMap(code =>
        state.masterSchedule!.sessions.filter(s => s.courseCode === code && !s.outdated)
      );
      return newSessions.filter(ns =>
        plannedSessions.some(ps => doTimeSlotsOverlap(ns.time, ps.time))
      );
    },
    [state.masterSchedule]
  );

  const addClassSession = useCallback((session: ClassSession): boolean => {
    setLastError(null);
    let added = false;
    setState(prev => {
      if (!prev.masterSchedule) return prev;
      // Check for duplicate id
      if (prev.masterSchedule.sessions.some(s => s.id === session.id)) {
        setLastError(`A session with id "${session.id}" already exists.`);
        return prev;
      }
      added = true;
      return {
        ...prev,
        masterSchedule: {
          ...prev.masterSchedule,
          sessions: [...prev.masterSchedule.sessions, session],
        },
      };
    });
    return added;
  }, []);

  const updateClassSession = useCallback((id: string, patch: Partial<ClassSession>) => {
    setLastError(null);
    setState(prev => {
      if (!prev.masterSchedule) return prev;
      const sessions = prev.masterSchedule.sessions.map(s =>
        s.id === id ? { ...s, ...patch } : s
      );
      return {
        ...prev,
        masterSchedule: { ...prev.masterSchedule, sessions },
      };
    });
  }, []);

  const deleteClassSessions = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setLastError(null);
    const idSet = new Set(ids);
    setState(prev => {
      if (!prev.masterSchedule) return prev;
      return {
        ...prev,
        masterSchedule: {
          ...prev.masterSchedule,
          sessions: prev.masterSchedule.sessions.filter(s => !idSet.has(s.id)),
        },
      };
    });
  }, []);

  const setMasterSchedule = useCallback((schedule: MasterSchedule | null) => {
    setLastError(null);
    setState(prev => ({ ...prev, masterSchedule: schedule }));
  }, []);

  const clearSisSyncResult = useCallback(() => {
    setSisSyncResult(null);
  }, []);

  const syncSisClassNumbers = useCallback(
    async (file: File): Promise<{ ok: boolean; summary?: SyncSisSummary; error?: string }> => {
      setLastError(null);
      if (!state.masterSchedule) {
        const msg = 'No schedule loaded — import a schedule before syncing SIS class numbers.';
        setLastError(msg);
        return { ok: false, error: msg };
      }
      try {
        const text = await file.text();
        const sisRows = parseSisClassNumbersJson(text);
        if (sisRows.length === 0) {
          const msg = 'No sections found in that file.';
          setLastError(msg);
          return { ok: false, error: msg };
        }
        const result = applySisSync(state.masterSchedule, sisRows);
        setState(prev => ({ ...prev, masterSchedule: result.schedule }));
        setSisSyncResult(result);
        setLastError(formatSyncSummary(result.summary));
        return { ok: true, summary: result.summary };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setLastError(`Failed to sync SIS class numbers: ${msg}`);
        return { ok: false, error: msg };
      }
    },
    [state.masterSchedule]
  );

  const setEnforceSchedule = useCallback((enforce: boolean) => {
    setState(prev => ({ ...prev, enforceSchedule: enforce }));
  }, []);

  const setScheduleTerm = useCallback((term: string) => {
    setState(prev => ({ ...prev, scheduleTerm: term }));
  }, []);

  const setStudentGroup = useCallback((group: string) => {
    setState(prev => ({ ...prev, studentGroup: group }));
  }, []);

  const mergeCloudData = useCallback(
    (data: { roster: RosterEntry[]; rows: GradeRow[]; terms: Term[]; catalog: CourseCatalog | null }) => {
      setState((prev) => {
        // Roster: cloud entries overwrite/insert by studentId.
        const rosterById = new Map(prev.roster.map((r) => [r.studentId, r]));
        for (const r of data.roster) rosterById.set(r.studentId, r);

        // Rows: cloud rows overwrite/insert by (studentId, course, term).
        const rowKey = (r: GradeRow) => `${r.studentId}\u0000${r.course}\u0000${r.term}`;
        const rowsByKey = new Map(prev.rows.map((r) => [rowKey(r), r]));
        for (const r of data.rows) rowsByKey.set(rowKey(r), r);

        // Terms: merge by term id, then merge entries by studentId
        // within each term (cloud entries win for the students they cover).
        // Also deduplicate same-named terms: if a local term shares a name
        // with a cloud term but has a different id, merge entries into the
        // cloud term and drop the local one.
        const termsById = new Map(prev.terms.map((t) => [t.id, t]));
        const localByName = new Map(prev.terms.map((t) => [t.name, t]));
        for (const cloudTerm of data.terms) {
          const existing = termsById.get(cloudTerm.id);
          if (existing) {
            // Same ID — merge entries normally.
            const entriesByStudent = new Map(existing.entries.map((e) => [e.studentId, e]));
            for (const e of cloudTerm.entries) entriesByStudent.set(e.studentId, e);
            termsById.set(cloudTerm.id, { ...existing, entries: [...entriesByStudent.values()] });
            continue;
          }
          // Different ID — check for same-name collision.
          const sameNameLocal = localByName.get(cloudTerm.name);
          if (sameNameLocal && sameNameLocal.id !== cloudTerm.id) {
            // Migrate entries from the local term into the cloud one,
            // then remove the local term.
            const mergedEntries = new Map(sameNameLocal.entries.map((e) => [e.studentId, e]));
            for (const e of cloudTerm.entries) mergedEntries.set(e.studentId, e);
            termsById.set(cloudTerm.id, { ...cloudTerm, entries: [...mergedEntries.values()] });
            termsById.delete(sameNameLocal.id);
            if (prev.activeTermId === sameNameLocal.id) {
              // We can't easily set activeTermId here, but the caller
              // will have access to the new state.
            }
          } else {
            termsById.set(cloudTerm.id, cloudTerm);
          }
        }

        const mergedTerms = [...termsById.values()];
        // If the previously active term was merged away, switch to the
        // one that replaced it.
        let nextActive = prev.activeTermId;
        if (nextActive && !termsById.has(nextActive)) {
          nextActive = mergedTerms.length > 0 ? mergedTerms[0].id : null;
        }

        return {
          ...prev,
          roster: [...rosterById.values()],
          rows: [...rowsByKey.values()],
          terms: mergedTerms,
          activeTermId: nextActive,
          catalog: data.catalog ?? prev.catalog,
        };
      });
    },
    []
  );

  const refreshFromCloud = useCallback(
    (data: { roster: RosterEntry[]; rows: GradeRow[]; terms: Term[]; catalog: CourseCatalog | null }) => {
      setState({
        rows: data.rows,
        catalog: data.catalog,
        roster: data.roster,
        terms: data.terms,
        activeTermId: data.terms.length > 0 ? data.terms[0].id : null,
        masterSchedule: null,
      });
    },
    []
  );

  const loadDemoRows = useCallback((rows: GradeRow[]) => {
    setLastError(null);
    setState((prev) => ({ ...prev, rows }));
  }, []);

  const loadDemoCatalog = useCallback((catalog: CourseCatalog) => {
    setLastError(null);
    setState((prev) => ({ ...prev, catalog }));
  }, []);

  const exportData = useCallback(() => {
    exportDataFile(state);
  }, [state]);

  /**
   * Restore the entire dataset from a JSON snapshot. We replace the
   * state wholesale (the user explicitly asked for "restore my data")
   * and surface validation failures via `lastError`. The UI shows a
   * confirmation dialog before calling this — see ImportButtons.
   */
  const importData = useCallback(async (file: File) => {
    setLastError(null);
    const result = await importDataFile(file);
    if (!result.ok) {
      setLastError(`Failed to import data: ${(result as any).error}`);
      return;
    }
    setState((prev) => {
      const incoming = result.state;

      // Rows: skip duplicates (same studentId + course + term)
      const rowKey = (r: GradeRow) => `${r.studentId}\u0000${r.course}\u0000${r.term}`;
      const existingRows = new Map(prev.rows.map((r) => [rowKey(r), r]));
      for (const r of incoming.rows) {
        if (!existingRows.has(rowKey(r))) existingRows.set(rowKey(r), r);
      }

      // Roster: skip duplicates (same studentId)
      const existingRoster = new Map(prev.roster.map((r) => [r.studentId, r]));
      for (const r of incoming.roster) {
        if (!existingRoster.has(r.studentId)) existingRoster.set(r.studentId, r);
      }

      // Terms: merge by term id, skip duplicate entries by studentId
      const existingTerms = new Map(prev.terms.map((t) => [t.id, t]));
      for (const t of incoming.terms) {
        const existing = existingTerms.get(t.id);
        if (!existing) {
          existingTerms.set(t.id, t);
          continue;
        }
        const entriesByStudent = new Map(existing.entries.map((e) => [e.studentId, e]));
        for (const e of t.entries) {
          if (!entriesByStudent.has(e.studentId)) entriesByStudent.set(e.studentId, e);
        }
        existingTerms.set(t.id, { ...existing, entries: [...entriesByStudent.values()] });
      }

      // Catalog: incoming replaces if not null
      const mergedCatalog = incoming.catalog ?? prev.catalog;

      // MasterSchedule: incoming replaces if not null
      const mergedSchedule = incoming.masterSchedule ?? prev.masterSchedule;

      return {
        ...prev,
        rows: [...existingRows.values()],
        roster: [...existingRoster.values()],
        terms: [...existingTerms.values()],
        catalog: mergedCatalog,
        masterSchedule: mergedSchedule,
      };
    });
  }, []);

  const deleteData = useCallback(() => {
    setState(emptyState());
  }, []);

  // ---------------------------------------------------------------------
  // Per-entity CRUD (Grade-book / Catalog / Roster)
  // ---------------------------------------------------------------------

  /** Two grade-row keys are equal when all three fields match exactly. */
  const sameGradeKey = (a: GradeRowKey, b: GradeRowKey): boolean =>
    a.studentId === b.studentId && a.course === b.course && a.term === b.term;

  /**
   * Build a Set of normalized-code keys from a catalog array. We
   * normalize via `normalizeCourseCodeLoose` so "MEC 11" and "MEC011"
   * collapse to the same key (matches what `parseCatalog` produces).
   */
  const catalogCodeKeys = (catalog: CourseCatalog | null): Set<string> => {
    const s = new Set<string>();
    if (!catalog) return s;
    for (const c of catalog.courses) s.add(normalizeCourseCodeLoose(c.code));
    return s;
  };

  const addGradeRow = useCallback((row: GradeRow): boolean => {
    setLastError(null);
    let added = false;
    setState((prev) => {
      const key: GradeRowKey = {
        studentId: row.studentId,
        course: row.course,
        term: row.term,
      };
      const exists = prev.rows.some((r) => sameGradeKey(r, key));
      if (exists) {
        setLastError(
          `A grade-book row for ${row.studentId} / ${row.course} / ${row.term || '(no term)'} already exists.`
        );
        return prev;
      }
      added = true;
      return { ...prev, rows: [...prev.rows, row] };
    });
    return added;
  }, []);

  const updateGradeRow = useCallback(
    (key: GradeRowKey, patch: Partial<GradeRow>) => {
      setLastError(null);
      setState((prev) => ({
        ...prev,
        rows: prev.rows.map((r) =>
          sameGradeKey(r, key) ? { ...r, ...patch } : r
        ),
      }));
    },
    []
  );

  const deleteGradeRows = useCallback((keys: GradeRowKey[]) => {
    if (keys.length === 0) return;
    setLastError(null);
    const set = new Set(keys.map((k) => `${k.studentId}${k.course}${k.term}`));
    setState((prev) => ({
      ...prev,
      rows: prev.rows.filter(
        (r) => !set.has(`${r.studentId}${r.course}${r.term}`)
      ),
    }));
  }, []);

  const clearGradeRows = useCallback(() => {
    setLastError(null);
    setState((prev) => ({ ...prev, rows: [] }));
  }, []);

  /**
   * Append rows from a parsed file, skipping any whose key collides
   * with an existing row. Surfaces "added N, skipped M" via
   * `lastError`; if N==0 and M>0, reports a soft notice (not an error).
   */
  const importGradeBookAppend = useCallback(async (file: File) => {
    setLastError(null);
    try {
      const buffer = await file.arrayBuffer();
      const incoming = parseGradeBook(buffer);
      if (incoming.length === 0) {
        setLastError(
          'No rows found in the file. Check that the file is a grade-book Excel with a "student_id" / "course" / "grade" header row.'
        );
        return;
      }
      setState((prev) => {
        const existing = new Set(
          prev.rows.map((r) => `${r.studentId}${r.course}${r.term}`)
        );
        let skipped = 0;
        const additions: GradeRow[] = [];
        for (const r of incoming) {
          const k = `${r.studentId}${r.course}${r.term}`;
          if (existing.has(k)) {
            skipped++;
          } else {
            additions.push(r);
            existing.add(k);
          }
        }
        if (additions.length > 0) {
          setLastError(
            `Appended ${additions.length} grade row(s)${skipped > 0 ? `, skipped ${skipped} duplicate(s)` : ''
            }.`
          );
        } else {
          setLastError(
            `No new rows added — all ${skipped} incoming row(s) already exist.`
          );
        }
        return { ...prev, rows: [...prev.rows, ...additions] };
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastError(`Failed to import grade-book: ${msg}`);
    }
  }, []);

  const addCatalogCourse = useCallback((course: CatalogCourse): boolean => {
    setLastError(null);
    let added = false;
    setState((prev) => {
      const codeKey = normalizeCourseCodeLoose(course.code);
      const existing = catalogCodeKeys(prev.catalog);
      if (existing.has(codeKey)) {
        setLastError(
          `A catalog course with code "${codeKey}" already exists.`
        );
        return prev;
      }
      added = true;
      const next: CourseCatalog = {
        courses: [
          ...(prev.catalog?.courses ?? []),
          { ...course, code: codeKey },
        ],
      };
      return { ...prev, catalog: next };
    });
    return added;
  }, []);

  const updateCatalogCourse = useCallback(
    (code: string, patch: Partial<CatalogCourse>) => {
      setLastError(null);
      const codeKey = normalizeCourseCodeLoose(code);
      setState((prev) => {
        if (!prev.catalog) return prev;
        const courses = prev.catalog.courses.map((c) =>
          normalizeCourseCodeLoose(c.code) === codeKey ? { ...c, ...patch } : c
        );
        return { ...prev, catalog: { courses } };
      });
    },
    []
  );

  const deleteCatalogCourses = useCallback((codes: string[]) => {
    if (codes.length === 0) return;
    setLastError(null);
    const set = new Set(codes.map(normalizeCourseCodeLoose));
    setState((prev) => {
      if (!prev.catalog) return prev;
      return {
        ...prev,
        catalog: {
          courses: prev.catalog.courses.filter(
            (c) => !set.has(normalizeCourseCodeLoose(c.code))
          ),
        },
      };
    });
  }, []);

  const clearCatalog = useCallback(() => {
    setLastError(null);
    setState((prev) => ({ ...prev, catalog: { courses: [] } }));
  }, []);

  const importCatalogAppend = useCallback(async (file: File) => {
    setLastError(null);
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseCatalog(buffer);
      if (parsed.courses.length === 0) {
        setLastError(
          'No courses found in the file. Check that the file has a "code" / "title" / "credits" header row.'
        );
        return;
      }
      setState((prev) => {
        const existing = catalogCodeKeys(prev.catalog);
        let skipped = 0;
        const additions: CatalogCourse[] = [];
        for (const c of parsed.courses) {
          const k = normalizeCourseCodeLoose(c.code);
          if (existing.has(k)) {
            skipped++;
          } else {
            additions.push(c);
            existing.add(k);
          }
        }
        if (additions.length > 0) {
          setLastError(
            `Appended ${additions.length} catalog course(s)${skipped > 0 ? `, skipped ${skipped} duplicate code(s)` : ''
            }.`
          );
        } else {
          setLastError(
            `No new courses added — all ${skipped} incoming code(s) already exist.`
          );
        }
        const baseCourses = prev.catalog?.courses ?? [];
        return {
          ...prev,
          catalog: { courses: [...baseCourses, ...additions] },
        };
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastError(`Failed to import catalog: ${msg}`);
    }
  }, []);

  const addRosterEntry = useCallback((entry: RosterEntry): boolean => {
    setLastError(null);
    let added = false;
    setState((prev) => {
      if (prev.roster.some((r) => r.studentId === entry.studentId)) {
        setLastError(`A roster entry for "${entry.studentId}" already exists.`);
        return prev;
      }
      added = true;
      return { ...prev, roster: [...prev.roster, entry] };
    });
    return added;
  }, []);

  const updateRosterEntry = useCallback(
    (studentId: string, patch: Partial<RosterEntry>) => {
      setLastError(null);
      setState((prev) => ({
        ...prev,
        roster: prev.roster.map((r) =>
          r.studentId === studentId ? { ...r, ...patch } : r
        ),
      }));
    },
    []
  );

  const deleteRosterEntries = useCallback((studentIds: string[]) => {
    if (studentIds.length === 0) return;
    setLastError(null);
    const set = new Set(studentIds);
    setState((prev) => ({
      ...prev,
      roster: prev.roster.filter((r) => !set.has(r.studentId)),
    }));
  }, []);

  const clearRoster = useCallback(() => {
    setLastError(null);
    setState((prev) => ({ ...prev, roster: [] }));
  }, []);

  const importRosterAppend = useCallback(async (file: File) => {
    setLastError(null);
    try {
      const buffer = await file.arrayBuffer();
      const incoming = parseRoster(buffer);
      if (incoming.length === 0) {
        setLastError(
          'No rows found in the file. Check that the file has a "student_id" column.'
        );
        return;
      }
      setState((prev) => {
        const existing = new Set(prev.roster.map((r) => r.studentId));
        let skipped = 0;
        const additions: RosterEntry[] = [];
        for (const r of incoming) {
          if (existing.has(r.studentId)) {
            skipped++;
          } else {
            additions.push(r);
            existing.add(r.studentId);
          }
        }
        if (additions.length > 0) {
          setLastError(
            `Appended ${additions.length} roster entr${additions.length === 1 ? 'y' : 'ies'}${skipped > 0 ? `, skipped ${skipped} duplicate id(s)` : ''
            }.`
          );
        } else {
          setLastError(
            `No new entries added — all ${skipped} incoming id(s) already exist.`
          );
        }
        return { ...prev, roster: [...prev.roster, ...additions] };
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastError(`Failed to import roster: ${msg}`);
    }
  }, []);

  // ---------------------------------------------------------------------
  // Term actions
  // ---------------------------------------------------------------------

  const updateTerm = (
    terms: Term[],
    termId: string,
    updater: (t: Term) => Term
  ): Term[] => terms.map((t) => (t.id === termId ? updater(t) : t));

  const upsertEntry = (term: Term, studentId: string, mutate: (e: TermEntry) => TermEntry): Term => {
    const existing = term.entries.find((e) => e.studentId === studentId);
    if (existing) {
      return {
        ...term,
        entries: term.entries.map((e) => (e.studentId === studentId ? mutate(e) : e)),
      };
    }
    return {
      ...term,
      entries: [...term.entries, mutate({ studentId, courseCodes: [] })],
    };
  };

  const createTerm = useCallback((name?: string): string => {
    const id = newTermId();
    const term: Term = {
      id,
      name: (name?.trim() || `Term ${new Date().toLocaleDateString()}`),
      createdAt: new Date().toISOString(),
      entries: [],
    };
    setLastError(null);
    setState((prev) => ({
      ...prev,
      terms: [...prev.terms, term],
      activeTermId: id,
    }));
    return id;
  }, []);

  const renameTerm = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setLastError(null);
    setState((prev) => ({
      ...prev,
      terms: updateTerm(prev.terms, id, (t) => ({ ...t, name: trimmed })),
    }));
  }, []);

  const deleteTerm = useCallback((id: string) => {
    setLastError(null);
    setState((prev) => {
      const remaining = prev.terms.filter((t) => t.id !== id);
      let nextActive = prev.activeTermId;
      if (prev.activeTermId === id) {
        // Pick the most recently created remaining term, or null.
        nextActive =
          remaining.length > 0
            ? remaining.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0].id
            : null;
      }
      return { ...prev, terms: remaining, activeTermId: nextActive };
    });
  }, []);

  const duplicateTerm = useCallback((id: string, newName: string): string => {
    const dupId = newTermId();
    setLastError(null);
    setState((prev) => {
      const source = prev.terms.find((t) => t.id === id);
      if (!source) return prev;
      const copy: Term = {
        id: dupId,
        name: newName.trim() || `${source.name} (copy)`,
        createdAt: new Date().toISOString(),
        // Deep-ish clone: each entry gets a fresh courseCodes array so
        // toggling in the new term doesn't mutate the source.
        entries: source.entries.map((e) => ({
          studentId: e.studentId,
          courseCodes: [...e.courseCodes],
        })),
      };
      return {
        ...prev,
        terms: [...prev.terms, copy],
        activeTermId: dupId,
      };
    });
    return dupId;
  }, []);

  const setActiveTerm = useCallback((id: string | null) => {
    setState((prev) => {
      if (id !== null && !prev.terms.some((t) => t.id === id)) return prev;
      return { ...prev, activeTermId: id };
    });
  }, []);

  const addCourseToTerm = useCallback(
    (termId: string, studentId: string, courseCode: string) => {
      const code = courseCode.trim().toUpperCase();
      if (!code) return;
      setLastError(null);
      setState((prev) => ({
        ...prev,
        terms: updateTerm(prev.terms, termId, (t) =>
          upsertEntry(t, studentId, (e) =>
            e.courseCodes.includes(code)
              ? e
              : { ...e, courseCodes: [...e.courseCodes, code] }
          )
        ),
      }));
    },
    []
  );

  const removeCourseFromTerm = useCallback(
    (termId: string, studentId: string, courseCode: string) => {
      const code = courseCode.trim().toUpperCase();
      if (!code) return;
      setLastError(null);
      setState((prev) => ({
        ...prev,
        terms: updateTerm(prev.terms, termId, (t) =>
          upsertEntry(t, studentId, (e) => ({
            ...e,
            courseCodes: e.courseCodes.filter((c) => c !== code),
          }))
        ),
      }));
    },
    []
  );

  const clearTermForStudent = useCallback((termId: string, studentId: string) => {
    setLastError(null);
    setState((prev) => ({
      ...prev,
      terms: updateTerm(prev.terms, termId, (t) =>
        upsertEntry(t, studentId, (e) => ({ ...e, courseCodes: [] }))
      ),
    }));
  }, []);

  const toggleCourseInActiveTerm = useCallback(
    (termId: string, studentId: string, courseCode: string) => {
      const code = courseCode.trim().toUpperCase();
      if (!code) return;
      setLastError(null);
      setState((prev) => ({
        ...prev,
        terms: updateTerm(prev.terms, termId, (t) => {
          const entry = t.entries.find((e) => e.studentId === studentId);
          const present = entry?.courseCodes.includes(code) ?? false;
          if (present) {
            return upsertEntry(t, studentId, (e) => ({
              ...e,
              courseCodes: e.courseCodes.filter((c) => c !== code),
            }));
          }
          return upsertEntry(t, studentId, (e) =>
            e.courseCodes.includes(code)
              ? e
              : { ...e, courseCodes: [...e.courseCodes, code] }
          );
        }),
      }));
    },
    []
  );


  // ---------------------------------------------------------------------
  // Derived: roster + metrics
  // ---------------------------------------------------------------------

  const roster = useMemo(
    () => studentRoster(state.rows, state.roster),
    [state.rows, state.roster]
  );



  const metricsByStudent = useMemo<Record<string, StudentMetrics>>(() => {
    const out: Record<string, StudentMetrics> = {};
    // Flatten every (student, courseCode) pair across every term so
    // the planned-conflict metric reflects the full picture.
    const plannedByStudent = new Map<string, Set<string>>();
    for (const term of state.terms) {
      for (const entry of term.entries) {
        let set = plannedByStudent.get(entry.studentId);
        if (!set) {
          set = new Set();
          plannedByStudent.set(entry.studentId, set);
        }
        for (const code of entry.courseCodes) set.add(code.toUpperCase());
      }
    }
    for (const meta of roster) {
      const failed = failedSubjects(state.rows, meta.studentId);
      const status = catalogStatusForStudent(state.rows, meta.studentId, state.catalog, meta.major);
      const failedSet = new Set(failed.map((c) => c.toUpperCase()));
      const plannedSet = plannedByStudent.get(meta.studentId);
      const hasPlannedConflict = plannedSet
        ? Array.from(plannedSet).some((c) => failedSet.has(c))
        : false;
      out[meta.studentId] = {
        studentId: meta.studentId,
        name: meta.name,
        major: meta.major,
        email: meta.email,
        nationalId: meta.nationalId,
        gpa: lastTermGpa(state.rows, meta.studentId),
        totalUnits: totalPassedUnits(state.rows, meta.studentId),
        totalFailedUnits: totalFailedUnits(state.rows, meta.studentId),
        failedCourseCodes: failed,
        missingPrereqsForNextTerm: status
          .filter((s) => s.status !== 'open')
          .flatMap((s) => s.missingPrereqs),
        hasPlannedConflict,
        currentSemester: currentSemesterForStudent(state.rows, meta.studentId),
        level: studentLevel(state.rows, meta.studentId),
      };
    }
    return out;
  }, [state.rows, state.catalog, state.terms, roster]);

  const catalogIndex = useMemo(() => {
    const map = new Map<string, CatalogCourse>();
    if (!state.catalog) return map;
    for (const c of state.catalog.courses) {
      map.set(c.code.trim().toUpperCase(), c);
    }
    return map;
  }, [state.catalog]);

  // ---------------------------------------------------------------------
  // Query dispatcher
  // ---------------------------------------------------------------------

  const query = useCallback(
    (q: AdvisingQuery): AdvisingResultRow[] => {
      switch (q.kind) {
        case 'failed-course': {
          return studentsWhoFailedCourse(
            state.rows,
            {
              courseCode: q.courseCode,
              studentName: q.studentName,
              major: q.major && q.major !== 'all' ? q.major : undefined,
            },
            state.roster,
            state.catalog
          ).map((r) => {
            // Resolve a friendly title for the picked course code so
            // the detail line shows "Failed MAT101 — Calculus I; ..."
            // instead of just the bare code.
            const course = state.catalog?.courses.find(
              (c) => normalizeCourseCodeLoose(c.code) === normalizeCourseCodeLoose(r.courseCode)
            );
            const title = course?.title;
            const detail = title
              ? `Failed ${r.courseCode} — ${title}; ${r.failedCodes.length} failed course(s) total`
              : `Failed ${r.courseCode}; ${r.failedCodes.length} failed course(s) total`;
            return {
              studentId: r.studentId,
              studentName: r.studentName,
              major: r.major,
              detail,
              items: r.failedCodes,
            };
          });
        }
        case 'blocked-next-term': {
          return studentsBlockedFromNextTerm(state.rows, state.catalog, state.roster).map(
            (r) => ({
              studentId: r.studentId,
              studentName: r.studentName,
              major: r.major,
              detail: `${r.blocked.length} course(s) blocked • GPA ${r.gpa.toFixed(2)} • ${r.units} cr`,
              items: r.blocked.flatMap((b) => [
                b.code,
                ...b.missing.map((m) => `  └ missing: ${m}`),
              ]),
            })
          );
        }
        case 'suggest-next-registration': {
          const metric = metricsByStudent[q.studentId];
          const major = metric?.major;
          const rows = suggestNextRegistration(state.rows, state.catalog, q.studentId, major);
          // Per-status count map, attached to the FIRST emitted row so
          // the panel can render badges without re-grouping.
          const groupCounts = {
            open: rows.filter((r) => r.status === 'open').length,
            blocked: rows.filter((r) => r.status === 'blocked').length,
            'failed-prereq': rows.filter((r) => r.status === 'failed-prereq').length,
          };
          return rows.map((s, idx) => ({
            studentId: q.studentId,
            studentName: metric?.name ?? `Student ${q.studentId}`,
            major: metric?.major ?? 'Undeclared',
            // Code + title so the user can scan the list without
            // context-switching to the catalog.
            detail: s.course.title
              ? `${s.course.code} — ${s.course.title} — ${s.status}`
              : `${s.course.code} — ${s.status}`,
            items: s.missing.length > 0 ? [`missing: ${s.missing.join(', ')}`] : undefined,
            groupKey: s.status,
            blockingImpact: s.blockingImpact,
            // Attach the count map on every row (cheap; the panel reads
            // it from the first). Items array is kept clean.
            groupCounts: idx === 0 ? groupCounts : undefined,
          }));
        }
        case 'planned-conflict': {
          return studentsWithPlannedConflict(state.rows, state.terms).map((r) => ({
            studentId: r.studentId,
            studentName: r.studentName,
            major: r.major,
            detail: `${r.conflicts.length} planned-conflict(s)`,
            items: r.conflicts.map((c) => `${c.termName}: ${c.courseCode}`),
          }));
        }
      }
    },
    [state.rows, state.catalog, state.terms, state.roster, metricsByStudent]
  );

  const value = useMemo<DataContextValue>(
    () => ({
      state,
      metricsByStudent,
      catalogIndex,
      studentCount: roster.length,
      importGradeBook,
      importCatalog,
      importRoster,
      addGradeRow,
      updateGradeRow,
      deleteGradeRows,
      clearGradeRows,
      importGradeBookAppend,
      addCatalogCourse,
      updateCatalogCourse,
      deleteCatalogCourses,
      clearCatalog,
      importCatalogAppend,
      addRosterEntry,
      updateRosterEntry,
      deleteRosterEntries,
      clearRoster,
      importRosterAppend,
      loadDemoRows,
      loadDemoCatalog,
      exportData,
      importData,
      deleteData,
      query,
      createTerm,
      renameTerm,
      deleteTerm,
      duplicateTerm,
      setActiveTerm,
      addCourseToTerm,
      removeCourseFromTerm,
      clearTermForStudent,
      toggleCourseInActiveTerm,
      lastError,
      importSchedule,
      clearSchedule,
      getSessionsForCourse,
      getConflictingSessions,
      addClassSession,
      updateClassSession,
      deleteClassSessions,
      setMasterSchedule,
      syncSisClassNumbers,
      sisSyncResult,
      clearSisSyncResult,
      setEnforceSchedule,
      setScheduleTerm,
      setStudentGroup,
      mergeCloudData,
      refreshFromCloud,
      importScheduleFromXML,
    }),
    [
      state,
      metricsByStudent,
      catalogIndex,
      roster.length,
      importGradeBook,
      importCatalog,
      importRoster,
      addGradeRow,
      updateGradeRow,
      deleteGradeRows,
      clearGradeRows,
      importGradeBookAppend,
      addCatalogCourse,
      updateCatalogCourse,
      deleteCatalogCourses,
      clearCatalog,
      importCatalogAppend,
      addRosterEntry,
      updateRosterEntry,
      deleteRosterEntries,
      clearRoster,
      importRosterAppend,
      loadDemoRows,
      loadDemoCatalog,
      exportData,
      importData,
      deleteData,
      query,
      createTerm,
      renameTerm,
      deleteTerm,
      duplicateTerm,
      setActiveTerm,
      addCourseToTerm,
      removeCourseFromTerm,
      clearTermForStudent,
      toggleCourseInActiveTerm,
      lastError,
      importSchedule,
      importScheduleFromXML,
      clearSchedule,
      getSessionsForCourse,
      getConflictingSessions,
      addClassSession,
      updateClassSession,
      deleteClassSessions,
      setMasterSchedule,
      syncSisClassNumbers,
      sisSyncResult,
      clearSisSyncResult,
      setEnforceSchedule,
      setScheduleTerm,
setStudentGroup,
      mergeCloudData,
      refreshFromCloud,
      importScheduleFromXML,
    ]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) {
    throw new Error('useData() must be used inside <DataProvider>.');
  }
  return ctx;
}