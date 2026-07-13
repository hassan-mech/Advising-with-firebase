import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RefreshCw, Loader2, Pencil, Trash2, ShieldCheck, ShieldOff, Users, CloudUpload, CloudDownload, LayoutDashboard, BarChart3, Send, Search, CheckCircle2, XCircle, ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle, Printer } from 'lucide-react';
import MasterSideNav from './MasterSideNav';
import {
  fetchAllStudentsForMaster,
  fetchAllAdvisors,
  reassignStudent,
  massReassignStudents,
  updateStudentRosterAsMaster,
  deleteStudentAsMaster,
  setUserRole,
  pushMasterDataToCloud,
  type PulledData,
  type AdvisorAccount,
} from '../data/cloudSync';
import { studentRoster, lastTermGpa, totalPassedUnits, totalFailedUnits } from '../data/metrics';
import { useAuth } from '../auth/AuthContext';
import { useData } from '../data/DataContext';
import { usePrint, triggerPrint } from './PrintContext';
import { buildCreditByCode } from './shared/planStats';
import { normalizeCourseCodeLoose } from '../data/normalize';
import type { ColorToken } from './shared/colorTokens';
import { SCREEN_COLOR_CLASS } from './shared/colorTokens';

interface MasterDashboardScreenProps {
  onBack: () => void;
}

type Tab = 'overview' | 'students' | 'advisors' | 'advisor-stats';

/** Small inline form for editing a student's roster fields (name/major/etc). */
function EditStudentRow({
  studentId,
  initialName,
  initialMajor,
  onDone,
}: {
  studentId: string;
  initialName: string;
  initialMajor: string;
  onDone: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [major, setMajor] = useState(initialMajor);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateStudentRosterAsMaster(studentId, { studentName: name, major });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save.');
      setSaving(false);
    }
  };

  return (
    <tr className="bg-white/5">
      <td className="px-3 py-2 font-mono text-xs text-slate-400">{studentId}</td>
      <td className="px-3 py-2" colSpan={2}>
        <div className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-slate-100 w-full"
          />
          <input
            value={major}
            onChange={(e) => setMajor(e.target.value)}
            placeholder="Major"
            className="bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-slate-100 w-full"
          />
        </div>
        {error && <p className="text-red-400 text-[10px] mt-1">{error}</p>}
      </td>
      <td className="px-3 py-2 text-right" colSpan={3}>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 px-2.5 py-1 rounded border border-emerald-500/30 cursor-pointer disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={onDone}
            disabled={saving}
            className="text-[10px] font-bold uppercase tracking-wider bg-white/5 hover:bg-white/10 text-slate-300 px-2.5 py-1 rounded border border-white/10 cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );
}

/** One big centered number tile for the Overview tab — mirrors the
 *  "count card" style of the reference stats dashboard the user
 *  shared (big number, small label underneath). */
function BigStat({ label, value, accent }: { label: string; value: number | string; accent: ColorToken }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col items-center justify-center text-center gap-1.5">
      <span className={`text-3xl font-mono font-extrabold ${SCREEN_COLOR_CLASS[accent]}`}>{value}</span>
      <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400 leading-tight">
        {label}
      </span>
    </div>
  );
}

/** Horizontal bar list of "how many students registered this course"
 *  — the per-course statistic the user asked for, sorted busiest
 *  first. Plain CSS bars (no charting dependency) so it costs nothing
 *  extra to build. */
function CourseRegistrationChart({ 
  data, 
  catalog 
}: { 
  data: { code: string; count: number }[];
  catalog: Map<string, { code: string; title: string; credits: number }> | null;
}) {
  const top = data.slice(0, 20);
  const max = Math.max(1, ...top.map((d) => d.count));
  
  const getCourseTitle = (code: string): string => {
    if (!catalog) return '';
    const course = catalog.get(code);
    return course?.title || '';
  };
  
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3 flex items-center gap-1.5">
        <BarChart3 className="w-3.5 h-3.5" />
        Registrations by course (number of students)
      </h3>
      {top.length === 0 ? (
        <p className="text-slate-500 text-xs">No course registrations for this term yet.</p>
      ) : (
        <div className="space-y-3">
          {top.map((d) => {
            const title = getCourseTitle(d.code);
            return (
              <div 
                key={d.code} 
                className="flex items-center gap-3 p-2.5 rounded-lg bg-white/5 border border-white/5 hover:border-white/10 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-blue-300 font-bold">{d.code}</span>
                    <span className="text-[10px] text-slate-500">{d.count} students</span>
                  </div>
                  {title && (
                    <p className="text-[11px] text-slate-300 truncate mt-0.5" title={title}>
                      {title}
                    </p>
                  )}
                </div>
                <div className="w-32 shrink-0">
                  <div className="h-2 bg-black/30 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500/60 to-cyan-500/60 rounded-full transition-all"
                      style={{ width: `${(d.count / max) * 100}%` }}
                    />
                  </div>
                </div>
                <span className="w-8 shrink-0 text-right font-mono text-sm text-slate-200 font-bold">
                  {d.count}
                </span>
              </div>
            );
          })}
          {data.length > top.length && (
            <p className="text-[10px] text-slate-500 pt-1 text-center">
              +{data.length - top.length} more course(s) not shown.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Quick-assign form: master types a student id + an advisor's email,
 * and the app looks that email up among the already-loaded advisor
 * accounts and reassigns the student to them in one step. The advisor
 * must have signed in at least once (which creates their `users/{uid}`
 * profile) for their email to be found here.
 */
function MassAssignUpload({
  advisors,
  busy,
  onAssign,
}: {
  advisors: AdvisorAccount[];
  busy: boolean;
  onAssign: () => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const { user } = useAuth();

  const submit = async () => {
    setLocalError(null);
    if (!text.trim()) return;

    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    const assignments: { studentId: string, newAdvisorId: string }[] = [];
    const masterUid = user?.uid || '';

    for (const line of lines) {
      const parts = line.split(/[,\t]+/).map(p => p.trim());
      if (parts.length === 0) continue;
      
      const studentId = parts[0];
      const email = parts[1]?.toLowerCase();
      let advisorUid = masterUid;

      if (email) {
        const found = advisors.find(a => a.email.toLowerCase() === email);
        if (found) {
          advisorUid = found.uid;
        }
      }

      if (studentId && advisorUid) {
        assignments.push({ studentId, newAdvisorId: advisorUid });
      }
    }

    if (assignments.length === 0) {
      setLocalError('No valid assignments found in input.');
      return;
    }

    try {
      await massReassignStudents(assignments);
      setText('');
      await onAssign(); // Refresh the list
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Mass assignment failed.');
    }
  };

  return (
    <div className="bg-slate-900 border border-amber-500/30 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2 text-amber-300 font-bold uppercase tracking-wider text-[10px]">
        <CloudUpload className="w-3.5 h-3.5" />
        Mass Assign Students (ID, Email)
      </div>
      <p className="text-[10px] text-slate-400">
        Paste CSV/TSV format: <code>StudentID, AdvisorEmail</code>. If email is missing or not found, it defaults to the master.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="20201234, advisor@example.com&#10;20205678, "
        className="bg-slate-950 border border-white/10 rounded-md px-3 py-2 text-xs text-white outline-none focus:ring-1 focus:ring-amber-500 h-24 font-mono"
        disabled={busy}
      />
      <div className="flex items-center justify-between">
        <span className="text-rose-400 text-[10px]">{localError}</span>
        <button
          onClick={submit}
          disabled={busy || !text.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-amber-500/20 text-amber-200 text-[10px] uppercase font-bold tracking-wider hover:bg-amber-500/30 disabled:opacity-50 cursor-pointer"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          Assign
        </button>
      </div>
    </div>
  );
}

function QuickAssignByEmail({
  advisors,
  students,
  busy,
  onAssign,
}: {
  advisors: AdvisorAccount[];
  students: { studentId: string; name: string }[];
  busy: boolean;
  onAssign: (studentId: string, advisorUid: string) => Promise<void>;
}) {
  const [studentId, setStudentId] = useState('');
  const [email, setEmail] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = async () => {
    const sid = studentId.trim();
    const mail = email.trim().toLowerCase();
    if (!sid || !mail) {
      setLocalError('Enter both a student ID and an advisor email.');
      return;
    }
    const match = advisors.find((a) => a.email?.toLowerCase() === mail);
    if (!match) {
      setLocalError(`No account found for "${email}". The advisor needs to sign in at least once first.`);
      return;
    }
    if (!students.some((s) => s.studentId === sid)) {
      setLocalError(`No student with ID "${sid}".`);
      return;
    }
    setLocalError(null);
    await onAssign(sid, match.uid);
    setStudentId('');
    setEmail('');
  };

  return (
    <div className="mb-6 rounded-lg border border-white/10 bg-white/5 p-4">
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3">
        Assign a student to an advisor by email
      </h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-slate-500 uppercase tracking-wider">Student ID</label>
          <input
            list="master-student-ids"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            placeholder="e.g. 20210123"
            className="bg-black/30 border border-white/10 rounded px-2 py-1.5 text-xs text-slate-100 w-40"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-slate-500 uppercase tracking-wider">Advisor email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="advisor@school.edu"
            className="bg-black/30 border border-white/10 rounded px-2 py-1.5 text-xs text-slate-100 w-56"
          />
        </div>
        <button
          onClick={submit}
          disabled={busy}
          className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider bg-blue-500/15 hover:bg-blue-500/25 text-blue-200 px-3 py-1.5 rounded border border-blue-500/30 cursor-pointer disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          Assign
        </button>
      </div>
      {localError && <p className="text-red-400 text-[10px] mt-2">{localError}</p>}
      <datalist id="master-student-ids">
        {students.map((s) => (
          <option key={s.studentId} value={s.studentId}>
            {s.name}
          </option>
        ))}
      </datalist>
    </div>
  );
}

/**
 * Master dashboard: three tabs.
 *  - "Overview" — headline statistics (registered / SIS-confirmed /
 *    paid counts, total hours, total course registrations) for a
 *    chosen term, plus a per-course "how many students registered"
 *    chart.
 *  - "Students" — every advisor's roster, grouped by advisor, with
 *    per-student reassign / edit / delete actions, and a quick
 *    "assign by advisor email" shortcut.
 *  - "Advisors" — every registered account, with a promote/demote
 *    toggle between "advisor" and "master".
 * Everything here writes straight to Firestore (see cloudSync.ts) and
 * relies on the master-role rules in firestore.rules.
 */
export default function MasterDashboardScreen({ onBack }: MasterDashboardScreenProps) {
  const { user } = useAuth();
  const { state, mergeCloudData, catalogIndex } = useData();
  const [tab, setTab] = useState<Tab>('overview');

  const [data, setData] = useState<PulledData | null>(null);
  const [advisors, setAdvisors] = useState<AdvisorAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedTermName, setSelectedTermName] = useState<string>('');
  const [studentSearch, setStudentSearch] = useState<string>('');

  const [syncing, setSyncing] = useState<'push' | 'pull' | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  const syncToCloud = async () => {
    setSyncing('push');
    setSyncStatus(null);
    setError(null);
    try {
      const result = await pushMasterDataToCloud(state);
      setSyncStatus(`Synced ${result.studentsWritten} student(s) to the cloud.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync to cloud failed.');
    } finally {
      setSyncing(null);
    }
  };

  const loadFromCloud = async () => {
    setSyncing('pull');
    setSyncStatus(null);
    setError(null);
    try {
      const pulled = await fetchAllStudentsForMaster();
      mergeCloudData(pulled);
      setSyncStatus(`Loaded ${pulled.roster.length} student(s) from the cloud.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load from cloud failed.');
    } finally {
      setSyncing(null);
    }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [students, people] = await Promise.all([fetchAllStudentsForMaster(), fetchAllAdvisors()]);
      setData(students);
      setAdvisors(people);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const advisorName = (uid: string) => {
    const a = advisors.find((x) => x.uid === uid);
    return a?.displayName || a?.email || uid;
  };

  // Canonical distinct-student list (roster + grade-book, deduped),
  // shared by the grouped-by-advisor table, the Overview stats, and
  // the quick-assign datalist.
  const metas = useMemo(() => (data ? studentRoster(data.rows, data.roster) : []), [data]);

  // Every distinct term *name* across every advisor's pushed terms.
  // Term ids are generated locally per-advisor, so two advisors'
  // "Fall 2026" terms have different ids — we merge by name instead
  // so the Overview reflects the whole cohort, not just one advisor's
  // term doc. (There's no reliable "created at" once data is
  // reassembled from many advisors' docs, so this is just a stable
  // alphabetical list — the master picks the one they want.)
  const termOptions = useMemo(() => {
    if (!data) return [];
    const latestByName = new Map<string, string>();
    for (const t of data.terms) {
      const cur = latestByName.get(t.name);
      if (!cur || t.createdAt > cur) latestByName.set(t.name, t.createdAt);
    }
    return [...latestByName.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([name]) => name);
  }, [data]);

  useEffect(() => {
    if (termOptions.length > 0 && !termOptions.includes(selectedTermName)) {
      setSelectedTermName(termOptions[0]);
    }
  }, [termOptions, selectedTermName]);

  // Per-student planned course codes for the selected term, merged
  // across every advisor's term doc that shares that name.
  const mergedPlanByStudent = useMemo(() => {
    const map = new Map<string, Set<string>>();
    if (!data || !selectedTermName) return map;
    for (const t of data.terms) {
      if (t.name !== selectedTermName) continue;
      for (const e of t.entries) {
        let set = map.get(e.studentId);
        if (!set) {
          set = new Set();
          map.set(e.studentId, set);
        }
        for (const c of e.courseCodes) set.add(normalizeCourseCodeLoose(c));
      }
    }
    return map;
  }, [data, selectedTermName]);

  const creditByCode = useMemo(() => buildCreditByCode(data?.catalog ?? null), [data]);

  const overview = useMemo(() => {
    if (!data) return null;
    const rosterById = new Map(data.roster.map((r) => [r.studentId, r]));
    let registeredCount = 0;
    let sisRegisteredCount = 0;
    let sisPaidCount = 0;
    let totalHours = 0;
    let totalCourseRegistrations = 0;
    const perCourseCount = new Map<string, number>();

    for (const meta of metas) {
      const codes = mergedPlanByStudent.get(meta.studentId);
      if (!codes || codes.size === 0) continue;
      registeredCount += 1;
      const r = rosterById.get(meta.studentId);
      if (r?.sisRegistered) sisRegisteredCount += 1;
      if (r?.sisPaid) sisPaidCount += 1;
      totalCourseRegistrations += codes.size;
      for (const code of codes) {
        totalHours += creditByCode.get(code) ?? 0;
        perCourseCount.set(code, (perCourseCount.get(code) ?? 0) + 1);
      }
    }

    const perCourse = [...perCourseCount.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count);

    return {
      totalStudents: metas.length,
      registeredCount,
      sisRegisteredCount,
      sisNotRegisteredCount: registeredCount - sisRegisteredCount,
      sisPaidCount,
      sisNotPaidCount: registeredCount - sisPaidCount,
      totalHours,
      totalCourseRegistrations,
      perCourse,
    };
  }, [data, metas, mergedPlanByStudent, creditByCode]);

  const grouped = useMemo(() => {
    if (!data) return [];
    const rosterById = new Map(data.roster.map((r) => [r.studentId, r]));
    const byAdvisor = new Map<string, typeof metas>();
    for (const m of metas) {
      const advisorId = rosterById.get(m.studentId)?.advisorId ?? 'unassigned';
      const list = byAdvisor.get(advisorId) ?? [];
      list.push(m);
      byAdvisor.set(advisorId, list);
    }
    return [...byAdvisor.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data, metas]);

  const reassign = async (studentId: string, newAdvisorId: string) => {
    if (!newAdvisorId) return;
    setBusyId(studentId);
    setError(null);
    try {
      await reassignStudent(studentId, newAdvisorId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reassign.');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (studentId: string) => {
    if (!confirm(`Permanently delete student ${studentId} from the cloud? This can't be undone.`)) return;
    setBusyId(studentId);
    setError(null);
    try {
      await deleteStudentAsMaster(studentId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete.');
    } finally {
      setBusyId(null);
    }
  };

  const toggleRole = async (account: AdvisorAccount) => {
    if (!user) return;
    const nextRole = account.role === 'master' ? 'advisor' : 'master';
    const verb = nextRole === 'master' ? 'Promote' : 'Demote';
    if (!confirm(`${verb} ${account.displayName || account.email || account.uid} to "${nextRole}"?`)) return;
    setBusyId(account.uid);
    setError(null);
    try {
      await setUserRole(account.uid, nextRole, user.uid);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className="flex-1 flex flex-col min-h-0 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-slate-300 px-3 py-1.5 rounded-md text-xs font-bold border border-white/10 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>
          <h1 className="text-lg font-extrabold text-slate-100">Master dashboard</h1>
        </div>
        {syncStatus && <span className="text-[10px] text-slate-400 max-w-[200px] truncate">{syncStatus}</span>}
      </div>

      <div className="flex items-center gap-2 mb-6 border-b border-white/10 pb-2">
        <button
          onClick={() => setTab('overview')}
          className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-md cursor-pointer ${
            tab === 'overview' ? 'bg-amber-500/15 text-amber-200 border border-amber-500/30' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <LayoutDashboard className="w-3.5 h-3.5" />
          Overview
        </button>
        <button
          onClick={() => setTab('students')}
          className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-md cursor-pointer ${
            tab === 'students' ? 'bg-amber-500/15 text-amber-200 border border-amber-500/30' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          Students
        </button>
        <button
          onClick={() => setTab('advisors')}
          className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-md cursor-pointer ${
            tab === 'advisors' ? 'bg-amber-500/15 text-amber-200 border border-amber-500/30' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          Advisors
        </button>
        <button
          onClick={() => setTab('advisor-stats')}
          className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-md cursor-pointer ${
            tab === 'advisor-stats' ? 'bg-cyan-500/15 text-cyan-200 border border-cyan-500/30' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <BarChart3 className="w-3.5 h-3.5" />
          Advisor Stats
        </button>
        {/* Refresh button */}
        <button
          onClick={loadFromCloud}
          disabled={loading}
          className="ml-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10 transition-all cursor-pointer disabled:opacity-40 active:scale-95"
          title="Reload data from cloud"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm rounded-lg p-4 mb-4">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="flex-1 flex items-center justify-center text-slate-500 text-sm gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : tab === 'overview' ? (
        !overview || !data || data.roster.length === 0 ? (
          <p className="text-slate-500 text-sm">No students have been synced to the cloud yet.</p>
        ) : (
          <div className="space-y-6">
            {termOptions.length > 0 && (
              <div className="flex items-center gap-3">
                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Term</label>
                <select
                  value={selectedTermName}
                  onChange={(e) => setSelectedTermName(e.target.value)}
                  className="bg-black/30 border border-white/10 rounded px-2 py-1.5 text-xs text-slate-200"
                >
                  {termOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <BigStat label="Total students" value={overview.totalStudents} accent="blue" />
              <BigStat label="Registered this term" value={overview.registeredCount} accent="violet" />
              <BigStat label="Registered, not on SIS" value={overview.sisNotRegisteredCount} accent="amber" />
              <BigStat label="Confirmed on SIS" value={overview.sisRegisteredCount} accent="emerald" />
              <BigStat label="Registered, not paid" value={overview.sisNotPaidCount} accent="orange" />
              <BigStat label="Paid fees" value={overview.sisPaidCount} accent="emerald" />
              <BigStat label="Total hours" value={overview.totalHours} accent="cyan" />
              <BigStat label="Total course registrations" value={overview.totalCourseRegistrations} accent="fuchsia" />
            </div>
            <CourseRegistrationChart data={overview.perCourse} catalog={catalogIndex} />
          </div>
        )
      ) : tab === 'students' ? (
        grouped.length === 0 ? (
          <p className="text-slate-500 text-sm">No students have been synced to the cloud yet.</p>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  placeholder="Search by ID, name, or major..."
                  className="w-full pl-9 pr-3 py-2 bg-black/30 border border-white/10 rounded-lg text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                />
              </div>
              <span className="text-xs text-slate-500">
                {studentSearch ? `${metas.filter((s) => {
                  const q = studentSearch.toLowerCase();
                  return s.studentId.toLowerCase().includes(q) ||
                    s.name.toLowerCase().includes(q) ||
                    s.major.toLowerCase().includes(q);
                }).length} result(s)` : `${metas.length} student(s)`}
              </span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <MassAssignUpload
                advisors={advisors}
                busy={busyId !== null}
                onAssign={loadFromCloud}
              />
              <QuickAssignByEmail
                advisors={advisors}
                students={metas}
                busy={busyId !== null}
                onAssign={reassign}
              />
            </div>
            <div className="overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full text-sm">
                <thead className="bg-white/5 text-slate-400 text-[10px] uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-3 py-2">Student ID</th>
                    <th className="text-left px-3 py-2">Name</th>
                    <th className="text-left px-3 py-2">Major</th>
                    <th className="text-right px-3 py-2">GPA</th>
                    <th className="text-center px-3 py-2">SIS</th>
                    <th className="text-center px-3 py-2">Paid</th>
                    <th className="text-right px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {metas.filter((s) => {
                    if (!studentSearch) return true;
                    const q = studentSearch.toLowerCase();
                    return s.studentId.toLowerCase().includes(q) ||
                      s.name.toLowerCase().includes(q) ||
                      s.major.toLowerCase().includes(q);
                  }).map((s) => {
                    const rosterEntry = data?.roster.find((r) => r.studentId === s.studentId);
                    const sisRegistered = rosterEntry?.sisRegistered ?? false;
                    const sisPaid = rosterEntry?.sisPaid ?? false;
                    return editingId === s.studentId ? (
                      <EditStudentRow
                        key={s.studentId}
                        studentId={s.studentId}
                        initialName={s.name}
                        initialMajor={s.major}
                        onDone={() => {
                          setEditingId(null);
                          load();
                        }}
                      />
                    ) : (
                      <tr key={s.studentId} className="text-slate-200 hover:bg-white/5">
                        <td className="px-3 py-2 font-mono text-xs">{s.studentId}</td>
                        <td className="px-3 py-2">{s.name}</td>
                        <td className="px-3 py-2 text-slate-400">{s.major}</td>
                        <td className="px-3 py-2 text-right font-mono">{lastTermGpa(data!.rows, s.studentId).toFixed(2)}</td>
                        <td className="px-3 py-2 text-center">
                          {sisRegistered ? (
                            <span className="inline-flex items-center gap-1 text-emerald-400">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span className="text-[10px]">Yes</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-slate-500">
                              <XCircle className="w-3.5 h-3.5" />
                              <span className="text-[10px]">No</span>
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {sisPaid ? (
                            <span className="inline-flex items-center gap-1 text-emerald-400">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span className="text-[10px]">Yes</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-400">
                              <XCircle className="w-3.5 h-3.5" />
                              <span className="text-[10px]">No</span>
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1.5">
                            <select
                              defaultValue=""
                              disabled={busyId === s.studentId}
                              onChange={(e) => reassign(s.studentId, e.target.value)}
                              className="bg-black/30 border border-white/10 rounded px-1.5 py-1 text-[10px] text-slate-300 cursor-pointer disabled:opacity-50"
                              title="Reassign to a different advisor"
                            >
                              <option value="" disabled>
                                Reassign…
                              </option>
                              {advisors.map((a) => (
                                <option key={a.uid} value={a.uid}>
                                  {a.displayName || a.email || a.uid}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => setEditingId(s.studentId)}
                              disabled={busyId === s.studentId}
                              title="Edit name/major"
                              className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 cursor-pointer disabled:opacity-50"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => remove(s.studentId)}
                              disabled={busyId === s.studentId}
                              title="Delete student"
                              className="p-1.5 rounded bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/30 cursor-pointer disabled:opacity-50"
                            >
                              {busyId === s.studentId ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Trash2 className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : advisors.length === 0 ? (
        <p className="text-slate-500 text-sm">No accounts found.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-slate-400 text-[10px] uppercase tracking-wider">
              <tr>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Email</th>
                <th className="text-left px-3 py-2">Role</th>
                <th className="text-right px-3 py-2">Students managed</th>
                <th className="text-right px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {advisors.map((a) => {
                const count = grouped.find(([id]) => id === a.uid)?.[1].length ?? 0;
                const isSelf = a.uid === user?.uid;
                return (
                  <tr key={a.uid} className="text-slate-200">
                    <td className="px-3 py-2">{a.displayName || '—'}</td>
                    <td className="px-3 py-2 text-slate-400">{a.email || '—'}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${
                          a.role === 'master'
                            ? 'bg-amber-500/15 text-amber-200 border-amber-500/30'
                            : 'bg-white/5 text-slate-300 border-white/10'
                        }`}
                      >
                        {a.role}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">{count}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => toggleRole(a)}
                        disabled={isSelf || busyId === a.uid}
                        title={isSelf ? "You can't change your own role here" : `${a.role === 'master' ? 'Demote' : 'Promote'} this account`}
                        className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider bg-white/5 hover:bg-white/10 text-slate-300 px-2.5 py-1 rounded border border-white/10 cursor-pointer disabled:opacity-40"
                      >
                        {busyId === a.uid ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : a.role === 'master' ? (
                          <ShieldOff className="w-3 h-3" />
                        ) : (
                          <ShieldCheck className="w-3 h-3" />
                        )}
                         {a.role === 'master' ? 'Demote' : 'Promote'}
                       </button>
                     </td>
                   </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'advisor-stats' && (
        <AdvisorStatsTab data={data} metas={metas} advisors={advisors} />
      )}

    </main>
  );
}

/**
 * Advisor Statistics Tab — tabular, sortable, filterable view
 * showing each advisor's students with: ID, Name, GPA, Total Hours,
 * SIS Registered, SIS Paid. Supports column sorting and search/filter.
 */
function AdvisorStatsTab({
  data,
  metas,
  advisors,
}: {
  data: PulledData | null;
  metas: ReturnType<typeof studentRoster>;
  advisors: AdvisorAccount[];
}) {
  const { setActiveTree } = usePrint();
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [search, setSearch] = useState('');
  const [advisorFilter, setAdvisorFilter] = useState<string>('all');

  // Print handlers
  const handlePrintAdvisor = (advisorId: string) => {
    if (advisorId === 'all') return;
    const advisor = advisors.find((a) => a.uid === advisorId);
    const adviserName = advisor?.displayName || advisor?.email || advisorId;
    triggerPrint(setActiveTree, 'adviser-stats', {
      adviserId: advisorId,
      adviserName,
      search,
      sortConfig,
    });
  };

  const handlePrintAll = () => {
    triggerPrint(setActiveTree, 'adviser-stats', {
      adviserId: 'all',
      adviserName: 'All Advisers',
      search,
      sortConfig,
    });
  };

  const rosterById = useMemo(() => new Map(data?.roster.map((r) => [r.studentId, r]) ?? []), [data?.roster]);
  const creditByCode = useMemo(() => buildCreditByCode(data?.catalog ?? null), [data?.catalog]);

  // Build rows: each student with their advisor's name and SIS status
  const allRows = useMemo(() => {
    if (!data) return [];
    return metas.map((m) => {
      const rosterEntry = rosterById.get(m.studentId);
      const advisorId = rosterEntry?.advisorId ?? 'unassigned';
      const advisor = advisors.find((a) => a.uid === advisorId);
      const advisorName = advisor?.displayName || advisor?.email || advisorId;

      // Compute GPA from grade rows
      const gpa = lastTermGpa(data.rows, m.studentId);

      // Compute total hours from active term plan
      const plannedCodes = new Set<string>();
      if (data.terms.length > 0) {
        for (const t of data.terms) {
          const entry = t.entries.find((e) => e.studentId === m.studentId);
          if (entry) for (const c of entry.courseCodes) plannedCodes.add(normalizeCourseCodeLoose(c));
        }
      }
      let totalHours = 0;
      for (const code of plannedCodes) {
        totalHours += creditByCode.get(code) ?? 0;
      }

      return {
        studentId: m.studentId,
        name: m.name,
        major: m.major,
        gpa: gpa > 0 ? gpa.toFixed(2) : '—',
        totalHours,
        advisorName,
        advisorId,
        sisRegistered: rosterEntry?.sisRegistered ?? false,
        sisPaid: rosterEntry?.sisPaid ?? false,
      };
    });
  }, [data, metas, rosterById, advisors, creditByCode]);

  // Filter rows
  const filteredRows = useMemo(() => {
    let rows = allRows;
    if (advisorFilter !== 'all') {
      rows = rows.filter((r) => r.advisorId === advisorFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) =>
        r.studentId.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.advisorName.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [allRows, advisorFilter, search]);

  // Sort rows
  const sortedRows = useMemo(() => {
    if (!sortConfig) return filteredRows;
    return [...filteredRows].sort((a, b) => {
      const aVal = a[sortConfig.key as keyof typeof a];
      const bVal = b[sortConfig.key as keyof typeof b];
      if (aVal === bVal) return 0;
      const dir = sortConfig.direction === 'asc' ? 1 : -1;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return (aVal - bVal) * dir;
      }
      return String(aVal).localeCompare(String(bVal)) * dir;
    });
  }, [filteredRows, sortConfig]);

  // Adviser stats for the currently filtered selection
  const adviserStats = useMemo(() => {
    const rows = advisorFilter === 'all' ? filteredRows : filteredRows.filter(r => r.advisorId === advisorFilter);
    const totalStudents = rows.length;
    const totalHours = rows.reduce((sum, r) => sum + r.totalHours, 0);
    const avgGpa = rows.reduce((sum, r) => sum + (r.gpa !== '—' ? parseFloat(r.gpa) : 0), 0) / (rows.filter(r => r.gpa !== '—').length || 1);
    const sisRegistered = rows.filter(r => r.sisRegistered).length;
    const sisPaid = rows.filter(r => r.sisPaid).length;
    return { totalStudents, totalHours, avgGpa, sisRegistered, sisPaid };
  }, [filteredRows, advisorFilter]);

  const handleSort = (key: string) => {
    setSortConfig((prev) => ({
      key,
      direction: prev?.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const getSortIcon = (key: string) => {
    if (sortConfig?.key !== key) return <ArrowUpDown className="w-3.5 h-3.5 text-slate-500" />;
    return sortConfig.direction === 'asc'
      ? <ArrowUp className="w-3.5 h-3.5 text-amber-300" />
      : <ArrowDown className="w-3.5 h-3.5 text-amber-300" />;
  };

return (
    <div className="space-y-4">
      {/* Adviser Selector & Stats */}
      <div className="bg-white/5 border border-white/10 rounded-lg p-4">
        <div className="flex flex-wrap items-center gap-4 mb-4">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search students by ID, Name, Advisor..."
              className="w-full pl-9 pr-3 py-2 bg-black/30 border border-white/10 rounded-lg text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>
          <select
            value={advisorFilter}
            onChange={(e) => setAdvisorFilter(e.target.value)}
            className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-amber-500 min-w-[200px]"
          >
            <option value="all">All Advisors</option>
            {advisors.map((a) => (
              <option key={a.uid} value={a.uid}>
                {a.displayName || a.email || a.uid}
              </option>
            ))}
          </select>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-center">
          <StatCard label="Students" value={adviserStats.totalStudents} accent="blue" />
          <StatCard label="Total Hours" value={adviserStats.totalHours} accent="cyan" />
          <StatCard label="Avg GPA" value={adviserStats.avgGpa > 0 ? adviserStats.avgGpa.toFixed(2) : '—'} accent="amber" />
          <StatCard label="SIS Registered" value={adviserStats.sisRegistered} accent="emerald" />
          <StatCard label="SIS Paid" value={adviserStats.sisPaid} accent="emerald" />
        </div>
      </div>

      {/* Print Buttons */}
      <div className="flex justify-end gap-2">
        <button
          onClick={() => handlePrintAdvisor(advisorFilter)}
          disabled={advisorFilter === 'all' || sortedRows.length === 0}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider bg-violet-500/15 text-violet-200 border border-violet-500/30 hover:bg-violet-500/25 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Printer className="w-3.5 h-3.5" />
          Print This Adviser
        </button>
        <button
          onClick={handlePrintAll}
          disabled={sortedRows.length === 0}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider bg-blue-500/15 text-blue-200 border border-blue-500/30 hover:bg-blue-500/25 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Printer className="w-3.5 h-3.5" />
          Print All Advisers
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-slate-400 text-[10px] uppercase tracking-wider">
            <tr>
              {[
                { key: 'studentId', label: 'ID' },
                { key: 'name', label: 'Name' },
                { key: 'gpa', label: 'GPA', numeric: true },
                { key: 'totalHours', label: 'Total Hours', numeric: true },
                { key: 'sisRegistered', label: 'SIS Registered' },
                { key: 'sisPaid', label: 'SIS Paid' },
                { key: 'notPaid', label: 'Not Paid' },
                { key: 'regNotPaid', label: 'Reg. Not Paid' },
                { key: 'paidNotReg', label: 'Paid Not SIS' },
                { key: 'notReg', label: 'Not SIS' },
                { key: 'paid', label: 'Paid' },
                { key: 'notRegistered', label: 'Not Reg.' },
                { key: 'advisorName', label: 'Advisor' },
              ].map((col) => (
                <th
                  key={col.key}
                  className={`px-3 py-2 cursor-pointer select-none hover:text-amber-200 ${col.numeric ? 'text-right' : 'text-left'}`}
                  onClick={() => handleSort(col.key)}
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    {getSortIcon(col.key)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-3 py-8 text-center text-slate-500">
                  {search || advisorFilter !== 'all' ? 'No matching students.' : 'No students synced yet.'}
                </td>
              </tr>
            ) : (
              sortedRows.map((r) => (
                <tr key={r.studentId} className="text-slate-200 hover:bg-white/5">
                  <td className="px-3 py-2 font-mono text-xs">{r.studentId}</td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.gpa}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.totalHours}</td>
                  <td className="px-3 py-2 text-center">
                    {r.sisRegistered ? (
                      <span className="inline-flex items-center gap-1 text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span className="text-[10px]">Yes</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-slate-500">
                        <XCircle className="w-3.5 h-3.5" />
                        <span className="text-[10px]">No</span>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {r.sisPaid ? (
                      <span className="inline-flex items-center gap-1 text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span className="text-[10px]">Yes</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-slate-500">
                        <XCircle className="w-3.5 h-3.5" />
                        <span className="text-[10px]">No</span>
                      </span>
                    )}
                  </td>
                  {/* Not Paid */}
                  <td className="px-3 py-2 text-center">
                    {!r.sisPaid ? (
                      <span className="inline-flex items-center gap-1 text-rose-400">
                        <XCircle className="w-3.5 h-3.5" />
                        <span className="text-[10px]">Not Paid</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-slate-500">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span className="text-[10px]">Paid</span>
                      </span>
                    )}
                  </td>
                  {/* Registered, Not Paid */}
                  <td className="px-3 py-2 text-center">
                    {r.sisRegistered && !r.sisPaid ? (
                      <span className="inline-flex items-center gap-1 text-amber-400">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span className="text-[10px]">Reg. Not Paid</span>
                      </span>
                    ) : (
                      <span className="text-slate-500 text-[10px]">—</span>
                    )}
                  </td>
                  {/* Paid, Not Registered */}
                  <td className="px-3 py-2 text-center">
                    {!r.sisRegistered && r.sisPaid ? (
                      <span className="inline-flex items-center gap-1 text-blue-400">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span className="text-[10px]">Paid Not SIS</span>
                      </span>
                    ) : (
                      <span className="text-slate-500 text-[10px]">—</span>
                    )}
                  </td>
                  {/* Not Registered */}
                  <td className="px-3 py-2 text-center">
                    {!r.sisRegistered ? (
                      <span className="inline-flex items-center gap-1 text-rose-400">
                        <XCircle className="w-3.5 h-3.5" />
                        <span className="text-[10px]">Not SIS</span>
                      </span>
                    ) : (
                      <span className="text-slate-500 text-[10px]">—</span>
                    )}
                  </td>
                  {/* Paid */}
                  <td className="px-3 py-2 text-center">
                    {r.sisPaid ? (
                      <span className="inline-flex items-center gap-1 text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span className="text-[10px]">Paid</span>
                      </span>
                    ) : (
                      <span className="text-slate-500 text-[10px]">—</span>
                    )}
                  </td>
                  {/* Not Registered (alias) */}
                  <td className="px-3 py-2 text-center">
                    {!r.sisRegistered ? (
                      <span className="inline-flex items-center gap-1 text-rose-400">
                        <XCircle className="w-3.5 h-3.5" />
                        <span className="text-[10px]">Not Reg.</span>
                      </span>
                    ) : (
                      <span className="text-slate-500 text-[10px]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-400">{r.advisorName}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Small stat card for adviser stats */
function StatCard({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  const accentMap: Record<string, string> = {
    blue: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
    cyan: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
    amber: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
    emerald: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
    fuchsia: 'bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30',
  };
  return (
    <div className={`rounded-lg p-3 border ${accentMap[accent]}`}>
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-xl font-bold mt-0.5">{value}</p>
    </div>
  );
}
