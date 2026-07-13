/**
 * MyStudentsPage — v1.
 *
 * The advisor's home base: every student assigned to the signed-in
 * advisor (or, for offline/unassigned use, every student in the
 * local dataset), with their active-term registered hours and the
 * two SIS checkboxes:
 *   - "تم التسجيل على SIS" — registered on SIS
 *   - "تم الدفع على SIS"   — paid on SIS
 *
 * Search narrows the list by name or student id. Clicking "Map" on a
 * row jumps to that student's prereq map, where the same two
 * checkboxes also live (PrereqMapScreen's "SIS status" card) so an
 * advisor can toggle them from either screen and stay in sync.
 */
import { useMemo, useState } from 'react';
import { Search, Map as MapIcon, ArrowLeft, X } from 'lucide-react';
import { useData } from '../data/DataContext';
import { useAuth } from '../auth/AuthContext';
import { updateStudentSisStatusInCloud } from '../data/cloudSync';
import { buildCreditByCode } from './shared/planStats';
import { normalizeCourseCodeLoose } from '../data/normalize';

interface MyStudentsPageProps {
  onOpenPrereqMap: (studentId: string) => void;
  onBack: () => void;
}

export default function MyStudentsPage({ onOpenPrereqMap, onBack }: MyStudentsPageProps) {
  const { state, metricsByStudent, setStudentSisStatus } = useData();
  const { cloudEnabled, user, profile } = useAuth();
  const [search, setSearch] = useState('');

  const isAdvisor = cloudEnabled && !!user && profile?.role === 'advisor';

  const rosterById = useMemo(
    () => new Map(state.roster.map((r) => [r.studentId, r])),
    [state.roster]
  );

  // Sum of active-term credits per student — same lookup chain
  // RosterTable uses for its "Plan CH" column, kept local here since
  // this screen only needs a plain id → hours map.
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
    // A signed-in advisor only sees their own students (or students
    // nobody has claimed yet). Everyone else (master, or an offline/
    // unsigned-in user) sees the whole local dataset — unchanged
    // behaviour from before this page existed.
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
    setStudentSisStatus(studentId, patch);
    if (isAdvisor) {
      updateStudentSisStatusInCloud(studentId, user!.uid, patch).catch((err) => {
        console.warn('[sis] Cloud patch failed — local change kept; use "Sync to cloud" to retry.', err);
      });
    }
  };

  return (
    <main className="flex-1 flex flex-col min-h-0 bg-slate-950">
      <header className="px-6 py-4 border-b border-white/10 flex items-center gap-4 bg-slate-950/80 backdrop-blur-md sticky top-0 z-20 flex-wrap">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-slate-300 hover:text-white px-2 py-1.5 rounded-lg hover:bg-white/5 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-xs font-bold uppercase tracking-wider">Back</span>
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-extrabold text-slate-100">My students</h1>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">
            {students.length} student{students.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or ID…"
            className="w-full bg-black/30 border border-white/10 rounded-lg pl-9 pr-8 py-2 text-sm text-slate-100 placeholder:text-slate-600"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 cursor-pointer"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-auto custom-scrollbar px-6 py-4">
        {students.length === 0 ? (
          <p className="text-slate-500 text-sm">
            {search ? 'No students match your search.' : 'No students assigned to you yet.'}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur-sm text-slate-400 text-[10px] uppercase tracking-wider border-b border-white/10">
                <tr>
                  <th className="text-left px-3 py-2.5">Student ID</th>
                  <th className="text-left px-3 py-2.5">Name</th>
                  <th className="text-left px-3 py-2.5">Major</th>
                  <th className="text-right px-3 py-2.5" title="Sum of credits for the courses planned on the active term">
                    Registered hours
                  </th>
                  <th className="text-center px-3 py-2.5">تم التسجيل على SIS</th>
                  <th className="text-center px-3 py-2.5">تم الدفع على SIS</th>
                  <th className="text-right px-3 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {students.map((m) => {
                  const rosterEntry = rosterById.get(m.studentId);
                  return (
                    <tr key={m.studentId} className="text-slate-200 hover:bg-white/5">
                      <td className="px-3 py-2.5 font-mono text-xs">{m.studentId}</td>
                      <td className="px-3 py-2.5">{m.name}</td>
                      <td className="px-3 py-2.5 text-slate-400">{m.major}</td>
                      <td className="px-3 py-2.5 text-right font-mono">
                        {hoursByStudent[m.studentId] ?? 0}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <input
                          type="checkbox"
                          checked={rosterEntry?.sisRegistered ?? false}
                          onChange={(e) =>
                            handleSisChange(m.studentId, { sisRegistered: e.target.checked })
                          }
                          className="w-4 h-4 rounded border-white/20 bg-black/30 accent-emerald-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <input
                          type="checkbox"
                          checked={rosterEntry?.sisPaid ?? false}
                          onChange={(e) => handleSisChange(m.studentId, { sisPaid: e.target.checked })}
                          className="w-4 h-4 rounded border-white/20 bg-black/30 accent-emerald-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          onClick={() => onOpenPrereqMap(m.studentId)}
                          title="Open in prereq map"
                          className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider bg-blue-500/15 hover:bg-blue-500/25 text-blue-200 px-2.5 py-1 rounded border border-blue-500/30 cursor-pointer"
                        >
                          <MapIcon className="w-3 h-3" />
                          Map
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
