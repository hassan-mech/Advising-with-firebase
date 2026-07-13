/**
 * StudentGridPanel — the main advising panel.
 *
 * A responsive grid of student cards (3-4 columns) visible to BOTH
 * advisers and master advisers. Each card shows:
 *   - Student icon + name
 *   - Registered hours on the active-term plan
 *   - "جدول الطالب" button → jumps to the prereq map
 *   - Two side-by-side toggle buttons: سداد (Paid) and تسجيل SIS (Registered)
 *
 * The Master Dashboard is separate and only visible to master advisers
 * (gated in Shell.tsx via the role check).
 */
import { useCallback, useMemo, useState } from 'react';
import {
  Search,
  Map as MapIcon,
  CheckCircle2,
  XCircle,
  Clock,
  CreditCard,
  UserCircle2,
  Upload,
  Check,
  Loader2,
} from 'lucide-react';
import { useData } from '../data/DataContext';
import { useAuth } from '../auth/AuthContext';
import { updateStudentSisStatusInCloud, pushMyDataToCloud, pushMasterDataToCloud } from '../data/cloudSync';
import { buildCreditByCode } from './shared/planStats';
import { normalizeCourseCodeLoose } from '../data/normalize';
import type { StudentMetrics } from '../data/types';

interface StudentGridPanelProps {
  onOpenPrereqMap: (studentId: string) => void;
}

export default function StudentGridPanel({ onOpenPrereqMap }: StudentGridPanelProps) {
  const { state, metricsByStudent, updateRosterEntry } = useData();
  const { cloudEnabled, user, profile } = useAuth();
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle');

  const isAdvisor = cloudEnabled && !!user && profile?.role === 'advisor';

  const rosterById = useMemo(
    () => new Map(state.roster.map((r) => [r.studentId, r])),
    [state.roster]
  );

  const creditByCode = useMemo(() => buildCreditByCode(state.catalog), [state.catalog]);
  const activeTerm = useMemo(
    () => state.terms.find((t) => t.id === state.activeTermId) ?? null,
    [state.terms, state.activeTermId]
  );

  const hoursByStudent = useMemo(() => {
    const out: Record<string, number> = {};
    if (!activeTerm) return out;
    for (const entry of activeTerm.entries) {
      let sum = 0;
      for (const code of entry.courseCodes) {
        sum += creditByCode.get(normalizeCourseCodeLoose(code)) ?? 0;
      }
      out[entry.studentId] = sum;
    }
    return out;
  }, [activeTerm, creditByCode]);

  const students = useMemo(() => {
    const all = Object.values(metricsByStudent);
    const scoped = isAdvisor
      ? all.filter((m) => {
          const advisorId = rosterById.get(m.studentId)?.advisorId;
          return !advisorId || advisorId === user!.uid;
        })
      : all;
    const term = search.trim().toLowerCase();
    const filtered = term
      ? scoped.filter(
          (m) =>
            m.studentId.toLowerCase().includes(term) ||
            m.name.toLowerCase().includes(term)
        )
      : scoped;
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  }, [metricsByStudent, rosterById, isAdvisor, user, search]);

  const handleSisChange = (
    studentId: string,
    patch: { sisRegistered?: boolean; sisPaid?: boolean }
  ) => {
    updateRosterEntry(studentId, patch);
    if (isAdvisor) {
      updateStudentSisStatusInCloud(studentId, user!.uid, patch).catch((err) => {
        console.warn('[sis] Cloud patch failed — local change kept.', err);
      });
    }
  };

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

  return (
    <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header with search */}
      <header className="px-6 py-4 border-b border-white/10 flex items-center gap-4 bg-slate-950/80 backdrop-blur-md sticky top-0 z-20 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-lg font-extrabold text-slate-100">Students</h1>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">
            {students.length} student{students.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or ID..."
            className="w-full bg-black/30 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {cloudEnabled && user && (
          <button
            onClick={handleSave}
            disabled={saving !== 'idle'}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 transition-all cursor-pointer disabled:opacity-60 active:scale-95"
          >
            {saving === 'saving' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : saving === 'saved' ? (
              <Check className="w-4 h-4" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            حفظ التسجيل
          </button>
        )}
      </header>

      {/* Student grid */}
      <div className="flex-1 overflow-auto p-6">
        {students.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-12">
            {search ? 'No students match your search.' : 'No students found.'}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {students.map((m) => (
              <StudentCard
                key={m.studentId}
                student={m}
                registeredHours={hoursByStudent[m.studentId] ?? 0}
                sisRegistered={rosterById.get(m.studentId)?.sisRegistered ?? false}
                sisPaid={rosterById.get(m.studentId)?.sisPaid ?? false}
                onOpenMap={() => onOpenPrereqMap(m.studentId)}
                onToggleSis={(patch) => handleSisChange(m.studentId, patch)}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function StudentCard({
  student,
  registeredHours,
  sisRegistered,
  sisPaid,
  onOpenMap,
  onToggleSis,
}: {
  student: StudentMetrics;
  registeredHours: number;
  sisRegistered: boolean;
  sisPaid: boolean;
  onOpenMap: () => void;
  onToggleSis: (patch: { sisRegistered?: boolean; sisPaid?: boolean }) => void;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-3 hover:border-white/20 transition-all">
      {/* Top: Icon + Name */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-blue-500/15 border border-blue-500/30 flex items-center justify-center shrink-0">
          <UserCircle2 className="w-6 h-6 text-blue-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-slate-100 truncate">{student.name}</h3>
          <p className="text-[10px] text-slate-500 font-mono">{student.studentId}</p>
        </div>
      </div>

      {/* GPA + Total hours (passed + failed) */}
      <div className="flex items-center gap-3 text-xs">
        <span className="flex items-center gap-1">
          <span className="text-slate-500">GPA</span>
          <span className={`font-bold ${student.gpa > 0 ? 'text-amber-300' : 'text-slate-500'}`}>
            {student.gpa > 0 ? student.gpa.toFixed(2) : '—'}
          </span>
        </span>
        <span className="text-slate-600">·</span>
        <span className="flex items-center gap-1">
          <span className="text-slate-500">Total</span>
          <span className="font-bold text-slate-200">
            {student.totalUnits + student.totalFailedUnits} hrs
          </span>
        </span>
        <span className="text-slate-500 text-[10px]">
          ({student.totalUnits} passed
          {student.totalFailedUnits > 0 && (
            <span className="text-rose-400"> +{student.totalFailedUnits} failed</span>
          )}
          )
        </span>
      </div>

      {/* Student status: registered hours */}
      <div className="flex items-center gap-2 text-xs">
        <Clock className="w-3.5 h-3.5 text-slate-500" />
        <span className="text-slate-400">Registered:</span>
        <span className={`font-bold ${registeredHours > 0 ? 'text-fuchsia-300' : 'text-slate-500'}`}>
          {registeredHours} cr
        </span>
        {student.failedCourseCodes.length > 0 && (
          <span className="ml-auto text-[10px] text-rose-400 font-bold">
            {student.failedCourseCodes.length} failed
          </span>
        )}
      </div>

      {/* جدول الطالب button */}
      <button
        onClick={onOpenMap}
        className="flex items-center justify-center gap-2 bg-blue-500/15 hover:bg-blue-500/25 text-blue-200 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border border-blue-500/30 transition-all cursor-pointer active:scale-95"
      >
        <MapIcon className="w-3.5 h-3.5" />
        جدول الطالب
      </button>

      {/* Two side-by-side toggle buttons: سداد + تسجيل SIS */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => onToggleSis({ sisPaid: !sisPaid })}
          className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border transition-all cursor-pointer active:scale-95 ${
            sisPaid
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
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

        <button
          onClick={() => onToggleSis({ sisRegistered: !sisRegistered })}
          className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border transition-all cursor-pointer active:scale-95 ${
            sisRegistered
              ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
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
    </div>
  );
}
