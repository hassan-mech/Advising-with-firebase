import { useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Upload,
  FileSpreadsheet,
  Download,
  Trash2,
  FileUp,
  Database,
  Calendar,
  ClipboardList,
  RefreshCw as XmlIcon,
  Users,
  ShieldCheck,
  CloudUpload,
  CloudDownload,
  Loader2,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useData } from '../data/DataContext';
import { pushScheduleToCloud, pullScheduleFromCloud } from '../data/cloudSync';
import { exportPlansFile } from '../data/exportPlans';

interface MasterSideNavProps {
  visible: boolean;
  onClose: () => void;
  onManageData: () => void;
  onManageSchedule: () => void;
}

interface SidebarButtonProps {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  color: 'blue' | 'emerald' | 'indigo' | 'amber' | 'orange' | 'slate' | 'fuchsia' | 'rose';
  collapsed: boolean;
  disabled?: boolean;
}

const colorMap: Record<SidebarButtonProps['color'], { text: string; hover: string }> = {
  blue: { text: 'text-blue-300', hover: 'hover:bg-blue-500/10' },
  emerald: { text: 'text-emerald-300', hover: 'hover:bg-emerald-500/10' },
  indigo: { text: 'text-indigo-300', hover: 'hover:bg-indigo-500/10' },
  amber: { text: 'text-amber-300', hover: 'hover:bg-amber-500/10' },
  orange: { text: 'text-orange-300', hover: 'hover:bg-orange-500/10' },
  slate: { text: 'text-slate-300', hover: 'hover:bg-white/10' },
  fuchsia: { text: 'text-fuchsia-300', hover: 'hover:bg-fuchsia-500/10' },
  rose: { text: 'text-rose-300', hover: 'hover:bg-rose-500/10' },
  teal: { text: 'text-teal-300', hover: 'hover:bg-teal-500/10' },
};

function SidebarButton({ onClick, icon, label, color, collapsed, disabled }: SidebarButtonProps) {
  const { text, hover } = colorMap[color];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${text} ${hover}`}
      title={label}
    >
      <span className="shrink-0">{icon}</span>
      {!collapsed && <span>{label}</span>}
    </button>
  );
}

export default function MasterSideNav({
  visible,
  onClose,
  onManageData,
  onManageSchedule,
}: MasterSideNavProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { profile } = useAuth();
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

  const [scheduleSyncing, setScheduleSyncing] = useState<'push' | 'pull' | null>(null);
  const [scheduleSyncStatus, setScheduleSyncStatus] = useState<string | null>(null);

  const gradeInput = useRef<HTMLInputElement>(null);
  const catalogInput = useRef<HTMLInputElement>(null);
  const rosterInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);
  const scheduleInput = useRef<HTMLInputElement>(null);
  const xmlScheduleInput = useRef<HTMLInputElement>(null);
  const [xmlStatus, setXmlStatus] = useState<string | null>(null);

  if (profile?.role !== 'master') return null;

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

  const handleJsonConfirm = (file: File) => {
    importData(file);
  };

  const handleDelete = () => {
    if (studentCount === 0) return;
    const ok = window.confirm(
      `Delete all imported data? This clears ${studentCount} student(s) from localStorage.`
    );
    if (ok) deleteData();
  };

  const handlePushSchedule = async () => {
    if (!state.masterSchedule) return;
    setScheduleSyncing('push');
    setScheduleSyncStatus(null);
    try {
      await pushScheduleToCloud(state.masterSchedule, state.scheduleTerm);
      setScheduleSyncStatus(`✓ Synced ${state.masterSchedule.sessions.length} sessions`);
    } catch (err) {
      setScheduleSyncStatus(`✗ ${err instanceof Error ? err.message : 'Sync failed'}`);
    } finally {
      setScheduleSyncing(null);
      setTimeout(() => setScheduleSyncStatus(null), 5000);
    }
  };

  const handlePullSchedule = async () => {
    if (state.masterSchedule) {
      const ok = window.confirm('Replace the current local schedule with the cloud version?');
      if (!ok) return;
    }
    setScheduleSyncing('pull');
    setScheduleSyncStatus(null);
    try {
      const schedule = await pullScheduleFromCloud();
      if (!schedule) {
        setScheduleSyncStatus('No schedule in cloud yet');
      } else {
        setMasterSchedule(schedule);
        if (schedule.termId) setScheduleTerm(schedule.termId);
        setScheduleSyncStatus(`✓ Loaded ${schedule.sessions.length} sessions`);
      }
    } catch (err) {
      setScheduleSyncStatus(`✗ ${err instanceof Error ? err.message : 'Load failed'}`);
    } finally {
      setScheduleSyncing(null);
      setTimeout(() => setScheduleSyncStatus(null), 5000);
    }
  };

  const hasPlanContent = state.terms.some((t) => t.entries.some((e) => e.courseCodes.length > 0));

  return (
    <>
      {/* Backdrop on mobile/tablet when sidebar is open */}
      {visible && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar - uses theme-aware CSS variables */}
      <aside
        className={`fixed lg:static left-0 top-0 h-full flex flex-col transition-all duration-300 overflow-y-auto z-50 ${
          visible ? 'translate-x-0' : '-translate-x-full lg:translate-x-1 lg:hidden'
        } ${collapsed ? 'w-16' : 'w-64'}`}
        style={{
          backgroundColor: 'var(--theme-surface)',
          borderRight: '1px solid var(--theme-border)',
        }}
      >
        {/* Hidden file inputs */}
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
        <input
          ref={xmlScheduleInput}
          type="file"
          accept=".xml,text/xml,application/xml"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            const term = (e.target as any).__pendingTerm as string | undefined;
            if (file && term) {
              setXmlStatus('Parsing...');
              const result = await importScheduleFromXML(file, term);
              setXmlStatus(result.ok
                ? `Done: ${result.sessions} sessions`
                : `Error: ${result.error ?? 'Parse failed'}`);
              setTimeout(() => setXmlStatus(null), 5000);
            }
            e.target.value = '';
          }}
        />

        {/* Header */}
        <div
          className="flex items-center justify-between p-3"
          style={{ borderBottom: '1px solid var(--theme-border)' }}
        >
          {!collapsed && (
            <span className="text-xs font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              Master Panel
            </span>
          )}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="p-1.5 rounded hover:bg-white/10 text-slate-400 hover:text-white cursor-pointer"
              title={collapsed ? 'Expand' : 'Collapse'}
            >
              {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
            <button
              onClick={onClose}
              className="lg:hidden p-1.5 rounded hover:bg-white/10 text-slate-400 hover:text-white cursor-pointer"
              title="Close"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Import Section */}
        <div className="p-2" style={{ borderBottom: '1px solid var(--theme-border)' }}>
          {!collapsed && (
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold px-3 py-1.5">Import</div>
          )}
          <div className="space-y-1">
            <SidebarButton onClick={handleGradeClick} icon={<Upload className="w-4 h-4" />} label="Grade-book" color="blue" collapsed={collapsed} />
            <SidebarButton onClick={handleRosterClick} icon={<Users className="w-4 h-4" />} label="Roster" color="emerald" collapsed={collapsed} />
            <SidebarButton onClick={handleCatalogClick} icon={<FileSpreadsheet className="w-4 h-4" />} label="Catalog" color="indigo" collapsed={collapsed} />
            <SidebarButton onClick={handleScheduleClick} icon={<Calendar className="w-4 h-4" />} label="Schedule" color="amber" collapsed={collapsed} />
            <SidebarButton onClick={handleXmlScheduleClick} icon={<XmlIcon className="w-4 h-4" />} label="XML Schedule" color="orange" collapsed={collapsed} />
          </div>
          {xmlStatus && !collapsed && (
            <div className="text-[10px] text-slate-400 px-3 py-1 truncate">{xmlStatus}</div>
          )}
        </div>

        {/* Export Section */}
        <div className="p-2" style={{ borderBottom: '1px solid var(--theme-border)' }}>
          {!collapsed && (
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold px-3 py-1.5">Export</div>
          )}
          <div className="space-y-1">
            <SidebarButton onClick={handleJsonClick} icon={<FileUp className="w-4 h-4" />} label="Import JSON" color="slate" collapsed={collapsed} />
            <SidebarButton onClick={exportData} icon={<Download className="w-4 h-4" />} label="Export JSON" color="slate" collapsed={collapsed} />
            <SidebarButton onClick={() => exportPlansFile(state)} icon={<ClipboardList className="w-4 h-4" />} label="Export Plans" color="fuchsia" collapsed={collapsed} disabled={!hasPlanContent} />
          </div>
        </div>

        {/* Data Management */}
        <div className="p-2" style={{ borderBottom: '1px solid var(--theme-border)' }}>
          {!collapsed && (
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold px-3 py-1.5">Data</div>
          )}
          <div className="space-y-1">
            <SidebarButton onClick={onManageData} icon={<Database className="w-4 h-4" />} label="Manage Data" color="blue" collapsed={collapsed} />
            <SidebarButton onClick={onManageSchedule} icon={<Calendar className="w-4 h-4" />} label="Manage Schedule" color="amber" collapsed={collapsed} />
            <SidebarButton onClick={handleDelete} icon={<Trash2 className="w-4 h-4" />} label="Delete All" color="rose" collapsed={collapsed} disabled={studentCount === 0} />
          </div>
        </div>

        {/* Cloud Sync */}
        <div className="p-2">
          {!collapsed && (
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold px-3 py-1.5">Cloud</div>
          )}
          <div className="space-y-1">
            <SidebarButton
              onClick={handlePushSchedule}
              icon={scheduleSyncing === 'push' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudUpload className="w-4 h-4" />}
              label="Sync schedule"
              color="teal"
              collapsed={collapsed}
              disabled={!state.masterSchedule || scheduleSyncing !== null}
            />
            <SidebarButton
              onClick={handlePullSchedule}
              icon={scheduleSyncing === 'pull' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudDownload className="w-4 h-4" />}
              label="Load schedule"
              color="teal"
              collapsed={collapsed}
              disabled={scheduleSyncing !== null}
            />
          </div>
          {scheduleSyncStatus && !collapsed && (
            <div className={`text-[10px] px-3 py-1 truncate ${scheduleSyncStatus.startsWith('✓') ? 'text-emerald-400' : scheduleSyncStatus.startsWith('✗') ? 'text-red-400' : 'text-slate-400'}`}>
              {scheduleSyncStatus}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
