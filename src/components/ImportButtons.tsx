/**
 * ImportButtons — v3.
 *
 * Top-right cluster of buttons: Import grade-book, Import roster,
 * Import catalog, Export (JSON snapshot), Export plans (Excel — one
 * sheet per registration term), Manage data, Delete data. Each
 * `<input type=file>` is hidden; the label is the visible button.
 * The "Delete" button asks for confirmation so a stray click doesn't
 * wipe the dataset.
 *
 * "Manage data" no longer opens a modal — it calls onManageData,
 * which App.tsx wires to switch the top-level view to the
 * DataManagerPage (same navigation pattern as the prereq-map screen).
 */

import { useMemo, useRef, useState } from 'react';
import {
  ClipboardList,
  Upload,
  FileSpreadsheet,
  Download,
  Trash2,
  Users,
  FileUp,
  Database,
  Calendar,
  CloudUpload,
  CloudDownload,
  Loader2,
} from 'lucide-react';
import { useData } from '../data/DataContext';
import { useAuth } from '../auth/AuthContext';
import { pushScheduleToCloud, pullScheduleFromCloud } from '../data/cloudSync';
import { exportPlansFile } from '../data/exportPlans';

interface ImportButtonsProps {
  onManageData: () => void;
  onManageSchedule: () => void;   // new
}

export default function ImportButtons({ onManageData, onManageSchedule }: ImportButtonsProps) {
  const {
    state,
    importGradeBook,
    importCatalog,
    importRoster,
    exportData,
    importData,
    deleteData,
    studentCount,
    importSchedule,
    importScheduleFromXML,
    setMasterSchedule,
    setScheduleTerm,
  } = useData();
  const { cloudEnabled, user } = useAuth();
  const gradeInput = useRef<HTMLInputElement>(null);
  const catalogInput = useRef<HTMLInputElement>(null);
  const rosterInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);
  const scheduleInput = useRef<HTMLInputElement>(null);
  const xmlScheduleInput = useRef<HTMLInputElement>(null);
  const [xmlStatus, setXmlStatus] = useState<string | null>(null);
  const [scheduleSyncing, setScheduleSyncing] = useState<'push' | 'pull' | null>(null);
  const [scheduleSyncStatus, setScheduleSyncStatus] = useState<string | null>(null);

  // Only enable the Export-plans button when at least one student has
  // at least one course on some term — otherwise the download would
  // be empty.
  const hasPlanContent = useMemo(
    () => state.terms.some((t) => t.entries.some((e) => e.courseCodes.length > 0)),
    [state.terms]
  );

  const handleGradeClick = () => gradeInput.current?.click();
  const handleCatalogClick = () => catalogInput.current?.click();
  const handleRosterClick = () => rosterInput.current?.click();
  const handleJsonClick = () => jsonInput.current?.click();
  const handleScheduleClick = () => scheduleInput.current?.click();
  const handleXmlScheduleClick = () => {
    const term = window.prompt(
      'Enter the term label for this schedule (e.g. "Summer 2025-2026"):',
      'Summer 2025-2026'
    );
    if (term === null) return;
    if (!term.trim()) { alert('Please enter a term name.'); return; }
    (xmlScheduleInput.current as any).__pendingTerm = term.trim();
    xmlScheduleInput.current?.click();
  };

  const handlePushSchedule = async () => {
    if (!state.masterSchedule) return;
    setScheduleSyncing('push');
    setScheduleSyncStatus(null);
    try {
      await pushScheduleToCloud(state.masterSchedule, state.scheduleTerm);
      setScheduleSyncStatus(`✓ Synced ${state.masterSchedule.sessions.length} sessions to the cloud.`);
    } catch (err) {
      setScheduleSyncStatus(`✗ ${err instanceof Error ? err.message : 'Sync failed.'}`);
    } finally {
      setScheduleSyncing(null);
      setTimeout(() => setScheduleSyncStatus(null), 5000);
    }
  };

  const handlePullSchedule = async () => {
    if (state.masterSchedule) {
      const ok = window.confirm('Replace the current local schedule with the one synced to the cloud?');
      if (!ok) return;
    }
    setScheduleSyncing('pull');
    setScheduleSyncStatus(null);
    try {
      const schedule = await pullScheduleFromCloud();
      if (!schedule) {
        setScheduleSyncStatus('No schedule has been synced to the cloud yet.');
      } else {
        setMasterSchedule(schedule);
        if (schedule.termId) setScheduleTerm(schedule.termId);
        setScheduleSyncStatus(`✓ Loaded ${schedule.sessions.length} sessions from the cloud.`);
      }
    } catch (err) {
      setScheduleSyncStatus(`✗ ${err instanceof Error ? err.message : 'Load failed.'}`);
    } finally {
      setScheduleSyncing(null);
      setTimeout(() => setScheduleSyncStatus(null), 5000);
    }
  };

  /**
   * Restore-from-JSON asks for confirmation when there's existing data
   * so a stray click doesn't wipe the dataset. Without any data we
   * skip the prompt — there's nothing to lose.
   */
  const handleJsonConfirm = (file: File) => {
    if (studentCount > 0 || state.catalog || state.terms.length > 0) {
      const ok = window.confirm(
        `Restore from "${file.name}"? This replaces the current dataset (${studentCount} student(s), ${state.terms.length} term(s)).`
      );
      if (!ok) return;
    }
    importData(file);
  };

  const handleDelete = () => {
    if (studentCount === 0) return;
    const ok = window.confirm(
      `Delete all imported data? This clears ${studentCount} student(s) from localStorage.`
    );
    if (ok) deleteData();
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={gradeInput}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) importGradeBook(file);
          e.target.value = '';
        }}
      />
      <input
        ref={rosterInput}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) importRoster(file);
          e.target.value = '';
        }}
      />
      <input
        ref={catalogInput}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) importCatalog(file);
          e.target.value = '';
        }}
      />
      <input
        ref={jsonInput}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleJsonConfirm(file);
          e.target.value = '';
        }}
      />

      <button
        onClick={handleGradeClick}
        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg font-bold text-xs uppercase tracking-wide shadow-lg shadow-blue-500/20 transition-all cursor-pointer active:scale-95"
      >
        <Upload className="w-4 h-4" />
        <span>Grade-book</span>
      </button>
      <button
        onClick={handleRosterClick}
        title="Import a student roster (id + name + major)"
        className="flex items-center gap-2 bg-emerald-600/80 hover:bg-emerald-500 text-white px-3 py-2 rounded-lg font-bold text-xs uppercase tracking-wide border border-emerald-500/30 transition-all cursor-pointer active:scale-95"
      >
        <Users className="w-4 h-4" />
        <span>Roster</span>
      </button>
      <button
        onClick={handleCatalogClick}
        className="flex items-center gap-2 bg-indigo-600/80 hover:bg-indigo-500 text-white px-3 py-2 rounded-lg font-bold text-xs uppercase tracking-wide border border-indigo-500/30 transition-all cursor-pointer active:scale-95"
      >
        <FileSpreadsheet className="w-4 h-4" />
        <span>Catalog</span>
      </button>
      <input
        ref={scheduleInput}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) importSchedule(file);
          e.target.value = '';
        }}
      />

      <button
        onClick={handleScheduleClick}
        title="Import a class schedule (timetable) CSV/Excel file"
        className="flex items-center gap-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 px-3 py-2 rounded-lg font-bold text-xs uppercase tracking-wide border border-amber-500/30 transition-all cursor-pointer active:scale-95"
      >
        <Calendar className="w-4 h-4" />
        <span>Schedule</span>
      </button>

      <input
        ref={xmlScheduleInput}
        type="file"
        accept=".xml,text/xml,application/xml"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          const term = (e.target as any).__pendingTerm as string | undefined;
          if (file && term) {
            setXmlStatus('Parsing XML…');
            const result = await importScheduleFromXML(file, term);
            setXmlStatus(result.ok
              ? `✓ Loaded ${result.sessions} sessions — ${term}`
              : `✗ ${result.error ?? 'Parse failed'}`);
            setTimeout(() => setXmlStatus(null), 5000);
          }
          e.target.value = '';
        }}
      />

      <button
        onClick={handleXmlScheduleClick}
        title="Import aSc Timetables XML export as the master schedule"
        className="flex items-center gap-2 bg-orange-500/10 hover:bg-orange-500/20 text-orange-200 px-3 py-2 rounded-lg font-bold text-xs uppercase tracking-wide border border-orange-500/30 transition-all cursor-pointer active:scale-95"
      >
        <Calendar className="w-4 h-4" />
        <span>XML Schedule</span>
      </button>

      {xmlStatus && (
        <span className={`text-[10px] font-medium ${xmlStatus.startsWith('✓') ? 'text-emerald-400' : xmlStatus.startsWith('✗') ? 'text-red-400' : 'text-slate-400'}`}>
          {xmlStatus}
        </span>
      )}

      {cloudEnabled && user && (
        <>
          <button
            onClick={handlePushSchedule}
            disabled={!state.masterSchedule || scheduleSyncing !== null}
            title="Push the current master schedule up to the shared cloud copy"
            className="flex items-center gap-2 bg-teal-500/10 hover:bg-teal-500/20 text-teal-200 px-3 py-2 rounded-lg font-bold text-xs uppercase tracking-wide border border-teal-500/30 transition-all cursor-pointer active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {scheduleSyncing === 'push' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudUpload className="w-4 h-4" />}
            <span>Sync schedule</span>
          </button>
          <button
            onClick={handlePullSchedule}
            disabled={scheduleSyncing !== null}
            title="Load the shared master schedule down from the cloud"
            className="flex items-center gap-2 bg-teal-500/10 hover:bg-teal-500/20 text-teal-200 px-3 py-2 rounded-lg font-bold text-xs uppercase tracking-wide border border-teal-500/30 transition-all cursor-pointer active:scale-95 disabled:opacity-40"
          >
            {scheduleSyncing === 'pull' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudDownload className="w-4 h-4" />}
            <span>Load schedule</span>
          </button>
          {scheduleSyncStatus && (
            <span className={`text-[10px] font-medium ${scheduleSyncStatus.startsWith('✓') ? 'text-emerald-400' : scheduleSyncStatus.startsWith('✗') ? 'text-red-400' : 'text-slate-400'}`}>
              {scheduleSyncStatus}
            </span>
          )}
        </>
      )}











      <button
        onClick={handleJsonClick}
        title="Restore the dataset from a previously exported JSON file"
        className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-slate-200 px-3 py-2 rounded-lg font-bold text-xs uppercase tracking-wide border border-white/10 transition-all cursor-pointer active:scale-95"
      >
        <FileUp className="w-4 h-4" />
        <span>Import</span>
      </button>
      <button
        onClick={exportData}
        title="Download the saved dataset as JSON"
        className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-slate-200 px-3 py-2 rounded-lg font-bold text-xs uppercase tracking-wide border border-white/10 transition-all cursor-pointer active:scale-95"
      >
        <Download className="w-4 h-4" />
        <span>Export</span>
      </button>
      <button
        onClick={() => exportPlansFile(state)}
        disabled={!hasPlanContent}
        title={
          hasPlanContent
            ? 'Download the registration plans as Excel (one sheet per term)'
            : 'Add at least one course to a term first'
        }
        className="flex items-center gap-2 bg-fuchsia-500/10 hover:bg-fuchsia-500/20 text-fuchsia-200 px-3 py-2 rounded-lg font-bold text-xs uppercase tracking-wide border border-fuchsia-500/30 transition-all cursor-pointer active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-fuchsia-500/10"
      >
        <ClipboardList className="w-4 h-4" />
        <span>Export plans</span>
      </button>
      <button
        onClick={onManageData}
        title="Add / edit / delete rows, courses, and students"
        className="flex items-center gap-2 bg-blue-500/15 hover:bg-blue-500/25 text-blue-100 px-3 py-2 rounded-lg font-bold text-xs uppercase tracking-wide border border-blue-500/30 transition-all cursor-pointer active:scale-95"
      >
        <Database className="w-4 h-4" />
        <span>Manage data</span>
      </button>
      <button
        onClick={handleDelete}
        title="Delete the saved dataset"
        className="flex items-center gap-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 px-3 py-2 rounded-lg font-bold text-xs uppercase tracking-wide border border-rose-500/20 transition-all cursor-pointer active:scale-95"
      >
        <Trash2 className="w-4 h-4" />
        <span>Delete</span>
      </button>

    </div>
  );
}