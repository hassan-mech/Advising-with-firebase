/**
 * localStorage + IndexedDB persistence for the v2 data layer.
 *
 * Student plans / roster / catalog → localStorage  (small, sync)
 * masterSchedule                   → IndexedDB     (large, async, no quota issues)
 *
 * This split prevents the ~5 MB localStorage quota from being hit by a
 * large master schedule, which would silently drop every subsequent
 * write (including planned-course toggles) until the next reload.
 */

import type { DataState, Term, MasterSchedule } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// IndexedDB helpers  (for masterSchedule)
// ─────────────────────────────────────────────────────────────────────────────

const IDB_DB_NAME   = 'academic-planner-idb';
const IDB_VERSION   = 1;
const IDB_STORE     = 'large-data';
const IDB_SCHED_KEY = 'masterSchedule';

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror   = (e) => reject((e.target as IDBOpenDBRequest).error);
  });
}

/** Persist the master schedule to IndexedDB (async, large-data safe). */
export async function saveMasterScheduleIDB(schedule: MasterSchedule | null): Promise<void> {
  try {
    const db = await openIDB();
    await new Promise<void>((resolve, reject) => {
      const tx    = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      
      if (schedule === null) {
        store.delete(IDB_SCHED_KEY);
      } else {
        store.put(schedule, IDB_SCHED_KEY);
      }
      
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = () => { db.close(); reject(tx.error); };
    });
  } catch (err) {
    console.warn('[storage/idb] Failed to save masterSchedule:', err);
  }
}

/** Load the master schedule from IndexedDB. Returns null if not found. */
export async function loadMasterScheduleIDB(): Promise<MasterSchedule | null> {
  try {
    const db = await openIDB();
    return await new Promise<MasterSchedule | null>((resolve) => {
      const tx    = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req   = store.get(IDB_SCHED_KEY);
      req.onsuccess = () => { db.close(); resolve((req.result as MasterSchedule) ?? null); };
      req.onerror   = () => { db.close(); resolve(null); };
    });
  } catch (err) {
    console.warn('[storage/idb] Failed to load masterSchedule:', err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// localStorage  (for everything else)
// ─────────────────────────────────────────────────────────────────────────────

export const STORAGE_KEY     = 'ap.v1.data';
/**
 * Bumped to 3 when the planner Term model replaced the per-student
 * PlannedTerm shape. Older payloads still load — `loadData` migrates
 * v1 (no plans field) and v2 (plans[]) into a v3 (terms[]) state so
 * existing users don't lose their data.
 */
export const STORAGE_VERSION = 3;

interface PersistedShape {
  version: number;
  state: DataState;
}

/**
 * Loads the non-schedule state from localStorage.
 * masterSchedule is always null here — it is patched in async from
 * IndexedDB by DataContext after mount.
 */
export function loadData(): DataState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw as string) as PersistedShape | DataState;
    if (!parsed) return null;

    const state: DataState =
      'state' in parsed && parsed.state && Array.isArray((parsed as PersistedShape).state.rows)
        ? (parsed as PersistedShape).state
        : (parsed as DataState);

    if (!state || !Array.isArray(state.rows)) return null;

    // v3: terms[]. Migration from v2 (plans[]).
    let terms = Array.isArray(state.terms) ? state.terms : [];
    let activeTermId: string | null =
      typeof state.activeTermId === 'string' ? state.activeTermId : null;

    if (terms.length === 0 && Array.isArray(state.plans) && state.plans.length > 0) {
      terms = state.plans.map((p) => ({
        id: `term-imported-${p.termId}`,
        name: p.termName || 'Imported plan',
        createdAt: new Date(0).toISOString(),
        entries: [{ studentId: p.studentId, courseCodes: [...p.courseCodes] }],
      }));
      activeTermId = terms[0]?.id ?? null;
    }

    return {
      rows:           state.rows,
      catalog:        state.catalog ?? null,
      roster:         Array.isArray(state.roster) ? state.roster : [],
      plans:          Array.isArray(state.plans)  ? state.plans  : [],
      terms,
      activeTermId,
      masterSchedule: null,  // ← always null; DataContext loads from IDB separately
    };
  } catch (err) {
    console.warn('[storage] Failed to load data:', err);
    return null;
  }
}

/**
 * Persists the non-schedule state to localStorage.
 * masterSchedule is intentionally stripped here — it lives in IndexedDB.
 * Returns true on success, false on quota error.
 */
export function saveData(state: DataState): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { masterSchedule: _ms, ...rest } = state;
    const payload: PersistedShape = {
      version: STORAGE_VERSION,
      state:   { ...rest, masterSchedule: null },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch (err) {
    console.warn('[storage] Failed to save data:', err);
    return false;
  }
}

/** Removes the persisted state. Used by the "Delete data" button. */
export function clearData(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn('[storage] Failed to clear data:', err);
  }
}

/**
 * Triggers a browser download of the full state as JSON, including
 * the masterSchedule (which is passed in from the caller who already
 * has it in React state). This ensures the exported backup is complete.
 */
export function exportDataFile(state: DataState): void {
  const payload: PersistedShape = { version: STORAGE_VERSION, state };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = `academic-advisor-data-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Result of an import attempt — either the restored state or an error. */
export type ImportResult =
  | { ok: true; state: DataState }
  | { ok: false; error: string };

/**
 * Reads a JSON file previously produced by `exportDataFile` and returns
 * the validated `DataState` inside it (including masterSchedule if present).
 */
export async function importDataFile(file: File): Promise<ImportResult> {
  try {
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: 'File is not valid JSON.' };
    }
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: 'File root must be an object or a DataState.' };
    }
    const candidate =
      'state' in (parsed as Record<string, unknown>) &&
      (parsed as { state?: unknown }).state &&
      typeof (parsed as { state?: unknown }).state === 'object'
        ? (parsed as PersistedShape).state
        : (parsed as DataState);
    const validated = validateDataState(candidate);
    if (!validated.ok) return validated;
    return { ok: true, state: validated.state };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not read the file: ${msg}` };
  }
}

function validateDataState(candidate: unknown): ImportResult {
  if (!candidate || typeof candidate !== 'object') {
    return { ok: false, error: 'Data must be a JSON object.' };
  }
  const c = candidate as Record<string, unknown>;
  if (!Array.isArray(c.rows)) {
    return { ok: false, error: 'Missing "rows" array in the file.' };
  }
  if (c.catalog !== null && typeof c.catalog !== 'object') {
    return { ok: false, error: '"catalog" must be an object or null.' };
  }
  if (!Array.isArray(c.roster)) {
    return { ok: false, error: 'Missing "roster" array in the file.' };
  }
  if (!Array.isArray(c.terms)) {
    return { ok: false, error: 'Missing "terms" array in the file.' };
  }
  for (const t of c.terms) {
    if (
      !t ||
      typeof t !== 'object' ||
      typeof (t as Term).id !== 'string' ||
      typeof (t as Term).name !== 'string' ||
      !Array.isArray((t as Term).entries)
    ) {
      return { ok: false, error: 'Each term must have id, name, and entries[].' };
    }
  }
  if (c.activeTermId !== null && typeof c.activeTermId !== 'string') {
    return { ok: false, error: '"activeTermId" must be a string or null.' };
  }
  return {
    ok: true,
    state: {
      rows:           c.rows as DataState['rows'],
      catalog:        (c.catalog ?? null) as DataState['catalog'],
      roster:         c.roster as DataState['roster'],
      terms:          c.terms as DataState['terms'],
      activeTermId:   (c.activeTermId ?? null) as DataState['activeTermId'],
      plans:          Array.isArray(c.plans) ? (c.plans as DataState['plans']) : [],
      masterSchedule: (c.masterSchedule ?? null) as DataState['masterSchedule'],
    },
  };
}

/** Returns an empty initial state. */
export function emptyState(): DataState {
  return {
    rows:           [],
    catalog:        null,
    roster:         [],
    terms:          [],
    activeTermId:   null,
    masterSchedule: null,
  };
}
