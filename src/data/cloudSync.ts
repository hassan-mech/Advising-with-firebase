/**
 * Cloud sync — Firestore.
 *
 * Data model (one document per student, collection "students"):
 *   students/{studentId} = {
 *     advisorId:  string        // owner — set on first sync, never
 *                                // reassigned by a later sync
 *     roster:     RosterEntry   // without the advisorId sub-field
 *     rows:       GradeRow[]    // every grade row for this student
 *     terms:      { termId, termName, courseCodes }[]  // this
 *                                // student's entry in each term
 *     updatedAt:  server timestamp
 *   }
 *
 * Sync is manual and one-way-at-a-time by design (per project spec):
 *   - pushMyDataToCloud(...)  — called when the advisor presses "Sync
 *     to Cloud". Overwrites the cloud copy of *their own* students
 *     with whatever is currently in local state.
 *   - pullMyDataFromCloud(...) — called when the advisor presses
 *     "Load from Cloud" (e.g. first run on a new device). Returns the
 *     rows/roster/terms belonging to that advisor's students, to be
 *     merged into local state by the caller.
 *   - fetchAllStudentsForMaster(...) — read-only, for the master
 *     report screen. Requires the caller's Firestore security rules
 *     to grant role=="master" a full read of the collection.
 *
 * The shared course catalog (not per-student) lives in a single doc,
 * `shared/catalog`, so every signed-in advisor can pull the same
 * reference data instead of re-importing it.
 */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Role } from '../auth/AuthContext';
import type { CourseCatalog, DataState, GradeRow, MasterSchedule, RosterEntry, Term } from './types';

const STUDENTS_COLLECTION = 'students';
const USERS_COLLECTION = 'users';
const SHARED_CATALOG_DOC = 'shared/catalog';
const SHARED_SCHEDULE_DOC = 'shared/schedule';
const SHARED_TERMS_DOC = 'shared/terms';

export class CloudNotConfiguredError extends Error {
  constructor() {
    super('Firebase is not configured — set the VITE_FIREBASE_* env vars first.');
    this.name = 'CloudNotConfiguredError';
  }
}

function requireDb() {
  if (!db) throw new CloudNotConfiguredError();
  return db;
}

/** Builds this student's slice of every term (only entries that exist). */
function termsForStudent(terms: Term[], studentId: string) {
  const out: { termId: string; termName: string; courseCodes: string[] }[] = [];
  for (const t of terms) {
    const entry = t.entries.find((e) => e.studentId === studentId);
    if (entry) out.push({ termId: t.id, termName: t.name, courseCodes: entry.courseCodes });
  }
  return out;
}

export interface SyncResult {
  studentsWritten: number;
}

/**
 * Pushes every roster student that is either unassigned or already
 * owned by `advisorUid` up to Firestore. Students owned by a *different*
 * advisor are skipped (an advisor should not silently overwrite another
 * advisor's copy of a shared studentId).
 */
export async function pushMyDataToCloud(
  state: DataState,
  advisorUid: string
): Promise<SyncResult> {
  const database = requireDb();
  const batch = writeBatch(database);
  let count = 0;

  for (const entry of state.roster) {
    if (entry.advisorId && entry.advisorId !== advisorUid) continue; // owned by someone else

    const rows: GradeRow[] = state.rows.filter((r) => r.studentId === entry.studentId);
    const { advisorId: _drop, ...rosterRest } = entry;
    void _drop;

    const ref = doc(database, STUDENTS_COLLECTION, entry.studentId);
    batch.set(
      ref,
      {
        advisorId: advisorUid,
        roster: rosterRest,
        rows,
        terms: termsForStudent(state.terms, entry.studentId),
        updatedAt: serverTimestamp(),
      },
      { merge: false }
    );
    count += 1;
  }

  if (count > 0) await batch.commit();

  // Shared catalog — last writer wins; harmless since it's reference data.
  if (state.catalog) {
    await setDoc(doc(database, SHARED_CATALOG_DOC), {
      catalog: state.catalog,
      updatedAt: serverTimestamp(),
    });
  }
  if (state.terms.length > 0) {
    await pushTermsToCloud(state.terms);
  }

  return { studentsWritten: count };
}

/**
 * Pushes ONLY students whose Firestore document does NOT yet exist
 * (checked per studentId). This is the "auto-sync on first login" path:
 * local data is uploaded for brand new studentIds while existing cloud
 * data is left completely untouched.
 *
 * The catalog is always written (last-writer-wins for reference data).
 * Batches are split into chunks of 400 to stay under Firestore's 500 limit.
 */
export async function pushMyDataToCloudSkipExisting(
  state: DataState,
  advisorUid: string
): Promise<SyncResult> {
  const database = requireDb();
  const BATCH_LIMIT = 400;
  let count = 0;
  const pending: Array<{ ref: ReturnType<typeof doc>; data: object }> = [];

  for (const entry of state.roster) {
    if (entry.advisorId && entry.advisorId !== advisorUid) continue;

    const ref = doc(database, STUDENTS_COLLECTION, entry.studentId);
    const snap = await getDoc(ref);
    if (snap.exists()) continue;

    const rows: GradeRow[] = state.rows.filter((r) => r.studentId === entry.studentId);
    const { advisorId: _drop, ...rosterRest } = entry;
    void _drop;

    pending.push({
      ref,
      data: {
        advisorId: advisorUid,
        roster: rosterRest,
        rows,
        terms: termsForStudent(state.terms, entry.studentId),
        updatedAt: serverTimestamp(),
      },
    });
    count += 1;
  }

  // Commit in chunks
  for (let i = 0; i < pending.length; i += BATCH_LIMIT) {
    const chunk = pending.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(database);
    for (const { ref, data } of chunk) batch.set(ref, data);
    await batch.commit();
  }

  if (state.catalog) {
    await setDoc(doc(database, SHARED_CATALOG_DOC), {
      catalog: state.catalog,
      updatedAt: serverTimestamp(),
    });
  }
  if (state.terms.length > 0) {
    await pushTermsToCloud(state.terms);
  }

  return { studentsWritten: count };
}

/**
 * Pushes every single local roster student up to Firestore, overriding
 * the cloud copy. Keeps each student's currently assigned advisorId,
 * or defaults to 'unassigned' if they don't have one.
 * Batches are split into chunks of 400 to stay under Firestore's 500 limit.
 */
export async function pushMasterDataToCloud(
  state: DataState
): Promise<SyncResult> {
  const database = requireDb();
  const BATCH_LIMIT = 400;
  let count = 0;
  const pending: Array<{ ref: ReturnType<typeof doc>; data: object }> = [];

  for (const entry of state.roster) {
    const rows: GradeRow[] = state.rows.filter((r) => r.studentId === entry.studentId);
    const { advisorId, ...rosterRest } = entry;

    pending.push({
      ref: doc(database, STUDENTS_COLLECTION, entry.studentId),
      data: {
        advisorId: advisorId || 'unassigned',
        roster: rosterRest,
        rows,
        terms: termsForStudent(state.terms, entry.studentId),
        updatedAt: serverTimestamp(),
      },
    });
    count += 1;
  }

  // Commit in chunks
  for (let i = 0; i < pending.length; i += BATCH_LIMIT) {
    const chunk = pending.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(database);
    for (const { ref, data } of chunk) batch.set(ref, data);
    await batch.commit();
  }

  if (state.catalog) {
    await setDoc(doc(database, SHARED_CATALOG_DOC), {
      catalog: state.catalog,
      updatedAt: serverTimestamp(),
    });
  }
  if (state.terms.length > 0) {
    await pushTermsToCloud(state.terms);
  }

  return { studentsWritten: count };
}

export interface PulledData {
  roster: RosterEntry[];
  rows: GradeRow[];
  terms: Term[];
  catalog: CourseCatalog | null;
}

/** Fetches every student document owned by `advisorUid`. */
export async function pullMyDataFromCloud(advisorUid: string): Promise<PulledData> {
  const database = requireDb();
  const q = query(collection(database, STUDENTS_COLLECTION), where('advisorId', '==', advisorUid));
  const snap = await getDocs(q);
  const data = assembleFromDocs(snap.docs.map((d) => d.data()), await fetchSharedCatalog());
  const sharedTerms = await pullTermsFromCloud();
  return { ...data, terms: mergeSharedTerms(data.terms, sharedTerms) };
}

/** Read-only fetch of every student, for the master role's report view. */
export async function fetchAllStudentsForMaster(): Promise<PulledData> {
  const database = requireDb();
  const snap = await getDocs(collection(database, STUDENTS_COLLECTION));
  const data = assembleFromDocs(snap.docs.map((d) => d.data()), await fetchSharedCatalog());
  const sharedTerms = await pullTermsFromCloud();
  return { ...data, terms: mergeSharedTerms(data.terms, sharedTerms) };
}

async function fetchSharedCatalog(): Promise<CourseCatalog | null> {
  const database = requireDb();
  const snap = await getDoc(doc(database, SHARED_CATALOG_DOC));
  if (!snap.exists()) return null;
  return (snap.data().catalog as CourseCatalog) ?? null;
}

/**
 * Merges term definitions from the shared cloud doc into the local
 * terms assembled from per-student data. Shared terms that don't exist
 * yet locally are appended; existing ones keep their per-student entries.
 */
function mergeSharedTerms(
  localTerms: Term[],
  sharedDefs: { id: string; name: string; createdAt: string }[]
): Term[] {
  if (sharedDefs.length === 0) return localTerms;
  const byId = new Map(localTerms.map(t => [t.id, t]));
  for (const def of sharedDefs) {
    if (!byId.has(def.id)) {
      byId.set(def.id, { id: def.id, name: def.name, createdAt: def.createdAt, entries: [] });
    }
  }
  return [...byId.values()];
}

/**
 * The master schedule (parsed from the aSc XML export, or the CSV/Excel
 * importer) is shared reference data, not per-advisor — so like the
 * catalog it lives in one doc, `shared/schedule`, that any signed-in
 * advisor can push/pull. Last writer wins, same as the catalog.
 */
function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export async function pushScheduleToCloud(schedule: MasterSchedule, termId?: string): Promise<void> {
  const database = requireDb();
  const toStore = termId ? { ...schedule, termId } : schedule;
  await setDoc(doc(database, SHARED_SCHEDULE_DOC), {
    schedule: stripUndefined(toStore),
    updatedAt: serverTimestamp(),
  });
}


export async function updateStudentSisStatusInCloud(
  studentId: string,
  advisorUid: string,
  updates: Partial<Pick<RosterEntry, 'sisRegistered' | 'sisPaid'>>
): Promise<void> {
  const database = requireDb();
  const ref = doc(database, STUDENTS_COLLECTION, studentId);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = snap.data() as { advisorId?: string; roster?: RosterEntry };
    if (data.advisorId && data.advisorId !== advisorUid) {
      throw new Error('This student belongs to a different advisor.');
    }
    await setDoc(ref, { roster: { ...data.roster, ...updates } }, { merge: true });
  } else {
    await setDoc(ref, {
      advisorId: advisorUid,
      roster: { studentId, ...updates },
      rows: [],
      terms: [],
      updatedAt: serverTimestamp(),
    });
  }
}

/** Returns null if nothing has been pushed to the cloud yet. */
export async function pullScheduleFromCloud(): Promise<MasterSchedule | null> {
  const database = requireDb();
  const snap = await getDoc(doc(database, SHARED_SCHEDULE_DOC));
  if (!snap.exists()) return null;
  return (snap.data().schedule as MasterSchedule) ?? null;
}

/**
 * Shared term definitions (id, name, createdAt only — no per-student
 * entries). Pushed by the master so every signed-in advisor sees the
 * same set of terms without re-creating them locally.
 */
export async function pushTermsToCloud(terms: Term[]): Promise<void> {
  const database = requireDb();
  const defs = terms.map(t => ({ id: t.id, name: t.name, createdAt: t.createdAt }));
  await setDoc(doc(database, SHARED_TERMS_DOC), {
    terms: defs,
    updatedAt: serverTimestamp(),
  });
}

export async function pullTermsFromCloud(): Promise<{ id: string; name: string; createdAt: string }[]> {
  const database = requireDb();
  const snap = await getDoc(doc(database, SHARED_TERMS_DOC));
  if (!snap.exists()) return [];
  const data = snap.data();
  return Array.isArray(data?.terms) ? data.terms : [];
}

export interface AdvisorAccount {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: Role;
}

/** Master-only: every registered account, for the Advisors tab and the
 *  reassign-student dropdown. */
export async function fetchAllAdvisors(): Promise<AdvisorAccount[]> {
  const database = requireDb();
  const snap = await getDocs(collection(database, USERS_COLLECTION));
  return snap.docs.map((d) => {
    const data = d.data() as { email?: string; displayName?: string; role?: Role };
    return {
      uid: d.id,
      email: data.email ?? null,
      displayName: data.displayName ?? null,
      role: data.role === 'master' ? 'master' : 'advisor',
    };
  });
}

/** Master-only: promote/demote another account. Refuses to touch the
 *  caller's own doc (the rules block it too, but failing fast here
 *  avoids a confusing permission-denied round trip). */
export async function setUserRole(uid: string, role: Role, callerUid: string): Promise<void> {
  if (uid === callerUid) {
    throw new Error("You can't change your own role from the dashboard.");
  }
  const database = requireDb();
  await setDoc(doc(database, USERS_COLLECTION, uid), { role }, { merge: true });
}

/** Master-only: move a student to a different advisor. */
export async function reassignStudent(studentId: string, newAdvisorId: string): Promise<void> {
  const database = requireDb();
  await setDoc(doc(database, STUDENTS_COLLECTION, studentId), { advisorId: newAdvisorId }, { merge: true });
}

export async function massReassignStudents(assignments: { studentId: string, newAdvisorId: string }[]): Promise<void> {
  const database = requireDb();
  const batch = writeBatch(database);
  for (const { studentId, newAdvisorId } of assignments) {
    batch.set(doc(database, STUDENTS_COLLECTION, studentId), { advisorId: newAdvisorId }, { merge: true });
  }
  await batch.commit();
}

/** Master-only: edit another advisor's student roster fields (name, major, etc). */
export async function updateStudentRosterAsMaster(
  studentId: string,
  updates: Partial<Pick<RosterEntry, 'studentName' | 'major' | 'email' | 'nationalId' | 'phone'>>
): Promise<void> {
  const database = requireDb();
  const ref = doc(database, STUDENTS_COLLECTION, studentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Student not found in the cloud.');
  const data = snap.data() as { roster?: RosterEntry };
  await setDoc(ref, { roster: { ...data.roster, ...updates } }, { merge: true });
}

/** Master-only: permanently remove a student document. */
export async function deleteStudentAsMaster(studentId: string): Promise<void> {
  const database = requireDb();
  await deleteDoc(doc(database, STUDENTS_COLLECTION, studentId));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function assembleFromDocs(docsData: any[], catalog: CourseCatalog | null): PulledData {
  const roster: RosterEntry[] = [];
  const rows: GradeRow[] = [];
  const termsById = new Map<string, Term>();

  for (const data of docsData) {
    const studentId: string = data.roster?.studentId;
    if (!studentId) continue;
    roster.push({ ...data.roster, advisorId: data.advisorId });
    if (Array.isArray(data.rows)) rows.push(...(data.rows as GradeRow[]));

    for (const t of (data.terms ?? []) as { termId: string; termName: string; courseCodes: string[] }[]) {
      let term = termsById.get(t.termId);
      if (!term) {
        term = { id: t.termId, name: t.termName, createdAt: new Date(0).toISOString(), entries: [] };
        termsById.set(t.termId, term);
      }
      term.entries.push({ studentId, courseCodes: t.courseCodes });
    }
  }

  return { roster, rows, terms: [...termsById.values()], catalog };
}
