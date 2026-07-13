/**
 * Shell — v2.
 *
 * Page chrome: dark slate background, header with title + nav tabs,
 * optional master sidebar, main area = roster + advising panel.
 *
 * Print architecture lives here too — see PrintContext for the design
 * rationale. In short: only ONE print tree is in the DOM at any time,
 * driven by `activeTree` state. Print buttons call
 * `triggerPrint(setActiveTree, kind, payload)`, which:
 *   1. Sets the active tree (and a fresh `payload.version`).
 *   2. Waits microtask + 2 RAF so React commits and the browser lays
 *      out the new tree.
 *   3. Calls `window.print()`.
 *   4. Unmounts the tree on `afterprint` (with a 2.5s fallback
 *      timeout for Firefox where `afterprint` fires before the
 *      dialog closes).
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  GraduationCap,
  Map,
  Moon,
  Printer,
  Sun,
  X,
  Calendar,
  Menu,
  Cloud,
  ShieldCheck,
  Loader2,
  CloudUpload,
  CloudDownload,
  LogOut,
  Users,
  Upload,
  Download,
  FileSpreadsheet,
  FileUp,
  Database,
  ClipboardList,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { pushMasterDataToCloud, fetchAllStudentsForMaster, pullMyDataFromCloud, pushMyDataToCloud } from '../data/cloudSync';
import { exportPlansFile } from '../data/exportPlans';
import MasterSideNav from './MasterSideNav';
import PrereqMapPrint from './PrereqMapPrint';
import FailureReportPrint from './FailureReportPrint';
import RegistrationFormPrint from './RegistrationFormPrint';
import PlanTablePrint from './PlanTablePrint';
import AdviserStatsPrint from './AdviserStatsPrint';
import {
  PrintProvider,
  triggerPrint,
  type PrintPayload,
  type PrintTreeKind,
} from './PrintContext';
import { useTheme } from './ThemeContext';
import { useData } from '../data/DataContext';
import type { DataState } from '../data/types';
import { useAuth } from '../auth/AuthContext';

interface ShellProps {
  children: React.ReactNode;
  view: 'roster' | 'map' | 'manage' | 'schedule' | 'timetable' | 'master' | 'auth' | 'students' | 'sis-review';
  onChangeView: (view: 'roster' | 'map' | 'manage' | 'schedule' | 'timetable' | 'master' | 'auth' | 'students' | 'sis-review') => void;
  /** Opens the full-screen sign-in view. */
  onOpenAuth: () => void;
}

const EMPTY_PAYLOAD: PrintPayload = { version: 0 };

/**
 * Snapshot the active term's entries as `studentId -> courseCodes[]`.
 * The prereq-map print tree consumes this so each page can render its
 * planned courses through the New/Enhancing/Repeated palette (matching
 * what the user saw on screen).
 *
 * Only the currently-active term is included — the on-screen
 * `Print form` and `Print this map` buttons both target the active
 * term, and showing planned courses from a non-active term would be
 * misleading.
 */
function buildPlanByStudent(state: DataState): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const term = state.terms.find((t) => t.id === state.activeTermId);
  if (!term) return out;
  for (const entry of term.entries) {
    out[entry.studentId] = entry.courseCodes ?? [];
  }
  return out;
}

export default function Shell({ children, view, onChangeView, onOpenAuth }: ShellProps) {
  const {
    studentCount, lastError, state, metricsByStudent, catalogIndex,
    importGradeBook, importCatalog, importRoster, exportData, importData,
    importSchedule, importScheduleFromXML, deleteData,
    mergeCloudData, refreshFromCloud,
  } = useData();
  const { theme, toggleTheme } = useTheme();
  const { profile, user, cloudEnabled, signOut } = useAuth();
  const showMapButton = studentCount > 0;

  const [sidebarOpen, setSidebarOpen] = useState(false);

  // File input refs for the unsigned toolbar
  const gradeInput = useRef<HTMLInputElement>(null);
  const catalogInput = useRef<HTMLInputElement>(null);
  const rosterInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);
  const scheduleInput = useRef<HTMLInputElement>(null);
  const xmlScheduleInput = useRef<HTMLInputElement>(null);

  // Single source of truth for which print tree is mounted. Initially
  // nothing — the print trees only appear when the user clicks a Print
  // button. See PrintContext for why we don't use html-class toggling.
  const [activeTree, setActiveTreeState] = useState<PrintTreeKind>(null);
  const [payload, setPayloadState] = useState<PrintPayload>(EMPTY_PAYLOAD);
  // Bumped on every trigger so identical re-prints (e.g. the user
  // clicks Print twice in a row) always remount the tree fresh.
  const versionRef = useRef(0);

  const setActiveTree = useCallback(
    (
      kind: PrintTreeKind,
      partial?: Omit<PrintPayload, 'version'>
    ) => {
      if (kind === null) {
        setActiveTreeState(null);
        return;
      }
      versionRef.current += 1;
      setActiveTreeState(kind);
      setPayloadState({
        studentId: partial?.studentId,
        majorPick: partial?.majorPick,
        theme: partial?.theme,
        version: versionRef.current,
      });
    },
    []
  );

  // Helper for the "Print all forms" button below — keeps the call
  // site concise and gives us a single place to update the policy.
  const printAllForms = useCallback(() => {
    triggerPrint(setActiveTree, 'reg-form-bulk');
  }, [setActiveTree]);

  // Bulk "Print all forms" only makes sense when at least one student
  // has at least one course on the currently-active term. We mirror
  // the same gate ImportButtons uses for the "Export plans" button.
  const activeTerm = state.terms.find((t) => t.id === state.activeTermId);
  const hasAnyForm =
    !!activeTerm &&
    activeTerm.entries.some((e) => e.courseCodes.length > 0);

  // Snapshot the active term's entries — memoized so the prereq-map
  // print tree doesn't recompute on every unrelated state change.
  const planByStudent = useMemo(() => buildPlanByStudent(state), [state]);

  const isMaster = profile?.role === 'master';
  const [cloudSyncing, setCloudSyncing] = useState<'push' | 'pull' | null>(null);

  const syncToCloud = async () => {
    setCloudSyncing('push');
    try {
      if (isMaster) {
        await pushMasterDataToCloud(state);
      } else if (user) {
        await pushMyDataToCloud(state, user.uid);
      }
    } finally {
      setCloudSyncing(null);
    }
  };

  const loadFromCloud = async () => {
    setCloudSyncing('pull');
    try {
      if (isMaster) {
        const pulled = await fetchAllStudentsForMaster();
        mergeCloudData(pulled);
      } else if (user) {
        const pulled = await pullMyDataFromCloud(user.uid);
        refreshFromCloud(pulled);
      }
    } finally {
      setCloudSyncing(null);
    }
  };

  const hasPlanContent = state.terms.some((t) => t.entries.some((e) => e.courseCodes.length > 0));

  const isUnsigned = !user || !cloudEnabled;

  return (
    <PrintProvider value={{ activeTree, payload, setActiveTree }}>
      <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex overflow-hidden">

        {/* Hidden file inputs for the unsigned toolbar */}
        <input ref={gradeInput} type="file" accept=".xlsx,.xls,.csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importGradeBook(f); e.target.value = ''; }} />
        <input ref={rosterInput} type="file" accept=".xlsx,.xls,.csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importRoster(f); e.target.value = ''; }} />
        <input ref={catalogInput} type="file" accept=".xlsx,.xls,.csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importCatalog(f); e.target.value = ''; }} />
        <input ref={jsonInput} type="file" accept=".json,application/json" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) { importData(f); } e.target.value = ''; }} />
        <input ref={scheduleInput} type="file" accept=".xlsx,.xls,.csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importSchedule(f); e.target.value = ''; }} />
        <input ref={xmlScheduleInput} type="file" accept=".xml,text/xml,application/xml" className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) { await importScheduleFromXML(f, 'Imported'); }
            e.target.value = '';
          }} />
        {/* Master Side Nav - only for master advisers */}
        {isMaster && (
          <MasterSideNav
            visible={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            onManageData={() => {
              setSidebarOpen(false);
              onChangeView('manage');
            }}
            onManageSchedule={() => {
              setSidebarOpen(false);
              onChangeView('schedule');
            }}
          />
        )}

        <div className="flex-1 flex flex-col min-h-1 min-w-1">
          <header className="sticky top-0 z-30 bg-slate-950/95 backdrop-blur-md border-b border-white/10 px-4 lg:px-6 py-3 lg:py-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-1">
              {isMaster && (
                <button
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  className="flex items-center justify-center w-9 h-9 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-200 transition-all cursor-pointer active:scale-95"
                  title={sidebarOpen ? 'Hide master panel' : 'Show master panel'}
                >
                  <Menu className="w-4 h-4" />
                </button>
              )}
              <div className="p-2 bg-blue-500/15 rounded-lg ring-1 ring-blue-500/30">
                <GraduationCap className="w-5 h-5 text-blue-400" />
              </div>
              <div className="min-w-0 hidden sm:block">
                <h1 className="text-lg font-extrabold tracking-tight truncate">Academic Advisor</h1>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">
                  {studentCount === 0 ? 'No data' : `${studentCount} student(s) loaded`}
                </p>
              </div>
              {showMapButton && (
                <div className="ml-2 lg:ml-4 inline-flex rounded-lg bg-white/5 border border-white/10 p-0.5">
                  <button
                    onClick={() => onChangeView('students')}
                    className={`px-2.5 lg:px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-colors flex items-center gap-1.5 ${view === 'students'
                      ? 'bg-blue-500/20 text-blue-200'
                      : 'text-slate-400 hover:text-slate-200'
                      }`}
                  >
                    <Users className="w-3 h-3" />
                    <span className="hidden md:inline">Students</span>
                  </button>
                  <button
                    onClick={() => onChangeView('roster')}
                    className={`px-2.5 lg:px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-colors ${view === 'roster'
                      ? 'bg-blue-500/20 text-blue-200'
                      : 'text-slate-400 hover:text-slate-200'
                      }`}
                  >
                    Roster
                  </button>
                  <button
                    onClick={() => onChangeView('map')}
                    className={`px-2.5 lg:px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-colors flex items-center gap-1.5 ${view === 'map'
                      ? 'bg-blue-500/20 text-blue-200'
                      : 'text-slate-400 hover:text-slate-200'
                      }`}
                  >
                    <Map className="w-3 h-3" />
                    <span className="hidden md:inline">Prereq Map</span>
                  </button>
                  <button
                    onClick={() => onChangeView('schedule')}
                    className={`px-2.5 lg:px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-colors flex items-center gap-1.5 ${view === 'schedule'
                      ? 'bg-amber-500/20 text-amber-200'
                      : 'text-slate-400 hover:text-slate-200'
                      }`}
                  >
                    <Calendar className="w-3 h-3" />
                    <span className="hidden md:inline">Schedule</span>
                  </button>
                </div>
              )}
              {/* Bulk "Print all forms" — one page per student that has
                  any planned course on the active term. Available from
                  both views so the user can trigger it from the roster
                  or from the prereq map. */}
              {showMapButton && (
                <button
                  onClick={printAllForms}
                  disabled={!hasAnyForm}
                  title={
                    hasAnyForm
                      ? `Print registration form for every student on ${activeTerm?.name}`
                      : 'Add at least one course to a term first'
                  }
                  className="ml-2 hidden sm:flex items-center gap-2 bg-white/5 hover:bg-white/10 text-slate-200 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider border border-white/10 transition-all cursor-pointer active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white/5"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print all forms</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* Master dashboard button */}
              {isMaster && (
                <button
                  onClick={() => onChangeView('master')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider border transition-all cursor-pointer active:scale-95 ${
                    view === 'master'
                      ? 'bg-amber-500/20 text-amber-200 border-amber-500/30'
                      : 'bg-white/5 text-slate-200 border-white/10 hover:bg-white/10'
                  }`}
                  title="Master dashboard"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Master</span>
                </button>
              )}

              {/* Export plans — visible to signed-in advisers and masters */}
              {user && cloudEnabled && (
                <button
                  onClick={() => exportPlansFile(state)}
                  disabled={!hasPlanContent}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider border border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200 hover:bg-fuchsia-500/20 transition-all cursor-pointer active:scale-95 disabled:opacity-40"
                  title="Export plans as Excel"
                >
                  <ClipboardList className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Plans</span>
                </button>
              )}

              {/* Cloud sync buttons - visible to all signed-in users */}
              {cloudEnabled && user && (
                <>
                  <button
                    onClick={syncToCloud}
                    disabled={cloudSyncing !== null}
                    className="hidden lg:flex items-center gap-2 bg-white/5 hover:bg-white/10 text-slate-200 px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider border border-white/10 transition-all cursor-pointer disabled:opacity-40 active:scale-95"
                    title={isMaster ? 'Sync all data to cloud' : 'Sync your data to cloud'}
                  >
                    {cloudSyncing === 'push' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudUpload className="w-3.5 h-3.5" />}
                    Sync
                  </button>
                  <button
                    onClick={loadFromCloud}
                    disabled={cloudSyncing !== null}
                    className="hidden lg:flex items-center gap-2 bg-white/5 hover:bg-white/10 text-slate-200 px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider border border-white/10 transition-all cursor-pointer disabled:opacity-40 active:scale-95"
                    title="Refresh data from cloud (gets latest from server)"
                  >
                    {cloudSyncing === 'pull' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    {isMaster ? 'Load' : 'Refresh'}
                  </button>
                </>
              )}

              {/* Data management toolbar — visible when NOT signed in (no-role mode) */}
              {isUnsigned && (
                <div className="flex items-center gap-1 mr-2 border-r border-white/10 pr-2">
                  <button onClick={() => gradeInput.current?.click()} className="flex items-center gap-1 px-2 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-200 hover:bg-blue-500/20 transition-all cursor-pointer active:scale-95" title="Import grade-book (Excel)">
                    <Upload className="w-3 h-3" /><span className="hidden lg:inline">Grade</span>
                  </button>
                  <button onClick={() => rosterInput.current?.click()} className="flex items-center gap-1 px-2 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 transition-all cursor-pointer active:scale-95" title="Import roster (Excel)">
                    <Users className="w-3 h-3" /><span className="hidden lg:inline">Roster</span>
                  </button>
                  <button onClick={() => catalogInput.current?.click()} className="flex items-center gap-1 px-2 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/20 transition-all cursor-pointer active:scale-95" title="Import catalog (Excel)">
                    <FileSpreadsheet className="w-3 h-3" /><span className="hidden lg:inline">Catalog</span>
                  </button>
                  <button onClick={exportData} className="flex items-center gap-1 px-2 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-white/5 text-slate-200 hover:bg-white/10 transition-all cursor-pointer active:scale-95" title="Export all data as JSON">
                    <Download className="w-3 h-3" /><span className="hidden lg:inline">Export</span>
                  </button>
                  <button onClick={() => jsonInput.current?.click()} className="flex items-center gap-1 px-2 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-white/5 text-slate-200 hover:bg-white/10 transition-all cursor-pointer active:scale-95" title="Import JSON data (appends)">
                    <FileUp className="w-3 h-3" /><span className="hidden lg:inline">JSON</span>
                  </button>
                  <button onClick={() => exportPlansFile(state)} disabled={!hasPlanContent} className="flex items-center gap-1 px-2 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-fuchsia-500/10 text-fuchsia-200 hover:bg-fuchsia-500/20 transition-all cursor-pointer active:scale-95 disabled:opacity-40" title="Export plans as Excel">
                    <ClipboardList className="w-3 h-3" /><span className="hidden lg:inline">Plans</span>
                  </button>
                  <button onClick={() => { if (studentCount > 0 && window.confirm('Delete all data?')) deleteData(); }} disabled={studentCount === 0} className="flex items-center gap-1 px-2 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-rose-500/10 text-rose-200 hover:bg-rose-500/20 transition-all cursor-pointer active:scale-95 disabled:opacity-40" title="Delete all data">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              )}

              {/* Cloud / Sign-in controls */}
              {cloudEnabled && user ? (
                <div className="flex items-center gap-2">
                  <span className="hidden lg:inline text-[10px] text-slate-400 max-w-[120px] truncate">
                    {profile?.displayName || user.email || 'User'}
                  </span>
                  <button
                    onClick={signOut}
                    className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition-all cursor-pointer active:scale-95"
                    title="Sign out"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              ) : cloudEnabled ? (
                <button
                  onClick={onOpenAuth}
                  className="flex items-center gap-2 bg-blue-500/15 hover:bg-blue-500/25 text-blue-100 px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider border border-blue-500/30 transition-all cursor-pointer active:scale-95"
                >
                  <Cloud className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Sign in</span>
                </button>
              ) : null}

              {/* Theme toggle */}
              <button
                onClick={toggleTheme}
                title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition-all cursor-pointer active:scale-95"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            </div>
          </header>

          {/* App-level error banner */}
          <ErrorBanner />

          <div className="flex-1 flex min-h-0 overflow-auto">{children}</div>

          {/* Active print tree */}
          {activeTree === 'prereq-maps' && (
            <PrereqMapPrint
              key={payload.version}
              rows={state.rows}
              catalog={state.catalog}
              roster={state.roster}
              metricsByStudent={metricsByStudent}
              studentId={payload.studentId}
              planByStudent={planByStudent}
              theme={payload.theme ?? 'dark'}
            />
          )}
          {activeTree === 'failure-report' && (
            <FailureReportPrint
              key={payload.version}
              rows={state.rows}
              catalog={state.catalog}
              roster={state.roster}
              metricsByStudent={metricsByStudent}
              majorPick={payload.majorPick ?? state.rows[0]?.major ?? ''}
            />
          )}
          {activeTree === 'reg-form-bulk' && (
            <RegistrationFormPrint
              key={payload.version}
              state={state}
              catalogIndex={catalogIndex}
              roster={state.roster}
              metricsByStudent={metricsByStudent}
              termId={state.activeTermId ?? undefined}
            />
          )}
          {activeTree === 'reg-form-single' && payload.studentId && (
            <RegistrationFormPrint
              key={payload.version}
              state={state}
              catalogIndex={catalogIndex}
              roster={state.roster}
              metricsByStudent={metricsByStudent}
              studentId={payload.studentId}
              termId={state.activeTermId ?? undefined}
            />
          )}
          {activeTree === 'plan-table' && (
            <PlanTablePrint
              key={payload.version}
              state={state}
              catalog={state.catalog}
              roster={state.roster}
              metricsByStudent={metricsByStudent}
            />
          )}
          {activeTree === 'adviser-stats' && (
            <AdviserStatsPrint
              key={payload.version}
              activeTree={activeTree}
              payload={{
                adviserId: payload.adviserId,
                adviserName: payload.adviserName,
                search: payload.search,
                sortConfig: payload.sortConfig,
                advisers: payload.advisers,
              }}
            />
          )}
        </div>
      </div>
    </PrintProvider>
  );
}

/** Dismissible error banner hooked to DataContext.lastError. */
function ErrorBanner() {
  const { lastError } = useData();
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!lastError || dismissed === lastError) return null;
  return (
    <div className="bg-rose-500/10 border-b border-rose-500/20 px-6 py-2 text-xs text-rose-200 flex items-center justify-between gap-3">
      <span className="truncate">{lastError}</span>
      <button
        onClick={() => setDismissed(lastError)}
        className="text-rose-300 hover:text-white shrink-0"
        title="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
