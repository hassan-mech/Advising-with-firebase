import { useState, useMemo, useRef, ChangeEvent, FormEvent, KeyboardEvent } from 'react';
import {
  Search,
  Plus,
  Pencil,
  Save,
  Trash2,
  CheckSquare,
  Square,
  X,
  Upload,
  Database,
  Calendar,
  AlertTriangle,
  RefreshCw,
  Eye,
} from 'lucide-react';
import { useData } from '../data/DataContext';
import { getSectionStatus } from '../data/types';
import type { ClassSession, SessionType, TimeSlot, MasterSchedule } from '../data/types';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
function keyOfSession(s: ClassSession): string {
  return s.id;
}

function newEmptySession(): ClassSession {
  return {
    id: '',
    term: '',
    targetGroups: [],
    courseCode: '',
    courseName: '',
    sessionType: 'LEC',
    instructorName: '',
    roomCode: '',
    sisClassNumber: '',
    time: { dayOfWeek: 'Monday', startTime: '09:00', endTime: '10:00' },
    capacity: undefined,
    enrolled: undefined,
    statusOverride: undefined,
  };
}

function validateSession(s: ClassSession): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!s.id.trim()) errors.id = 'ID is required';
  if (!s.courseCode.trim()) errors.courseCode = 'Course code is required';
  if (!s.sisClassNumber.trim()) errors.sisClassNumber = 'SIS class number is required';
  if (!s.time.dayOfWeek) errors.dayOfWeek = 'Day is required';
  if (!s.time.startTime.trim()) errors.startTime = 'Start time is required';
  if (!s.time.endTime.trim()) errors.endTime = 'End time is required';
  if (s.time.startTime >= s.time.endTime) errors.timeOrder = 'Start must be before end';
  return errors;
}

// ──────────────────────────────────────────────
// Page Component
// ──────────────────────────────────────────────
export default function ScheduleManagerPage({
  onBack,
  onChangeView,
}: {
  onBack: () => void;
  onChangeView?: (view: string) => void;
}) {
  const {
    state,
    addClassSession,
    updateClassSession,
    deleteClassSessions,
    importSchedule,
    clearSchedule,
    syncSisClassNumbers,
    sisSyncResult,
  } = useData();

  const schedule = state.masterSchedule;
  const sessions = schedule?.sessions ?? [];

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [draft, setDraft] = useState<ClassSession | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSyncing, setIsSyncing] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const sisFileInputRef = useRef<HTMLInputElement>(null);

  // Filter by search
  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return sessions;
    return sessions.filter(s =>
      JSON.stringify(s).toLowerCase().includes(q)
    );
  }, [sessions, searchQuery]);

  const allSelected = filtered.length > 0 && filtered.every(s => selectedIds.has(s.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        filtered.forEach(s => next.delete(s.id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        filtered.forEach(s => next.add(s.id));
        return next;
      });
    }
  };

  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const startAdd = () => {
    setAddingNew(true);
    setEditingId('__new__');
    const empty = newEmptySession();
    setDraft(empty);
    setErrors(validateSession(empty));
  };

  const startEdit = (session: ClassSession) => {
    setAddingNew(false);
    setEditingId(session.id);
    const copy = { ...session, time: { ...session.time } };
    setDraft(copy);
    setErrors(validateSession(copy));
  };

  const cancelEdit = () => {
    setAddingNew(false);
    setEditingId(null);
    setDraft(null);
    setErrors({});
  };

  const handleSave = (e?: FormEvent) => {
    e?.preventDefault();
    if (!draft) return;
    const errs = validateSession(draft);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    if (addingNew) {
      addClassSession(draft);
      cancelEdit();
    } else {
      updateClassSession(draft.id, draft);
      cancelEdit();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    if (window.confirm(`Delete ${selectedIds.size} session(s)?`)) {
      deleteClassSessions(Array.from(selectedIds));
      setSelectedIds(new Set());
    }
  };

  const handleClearAll = () => {
    if (sessions.length === 0) return;
    if (window.confirm(`Delete all ${sessions.length} sessions?`)) {
      clearSchedule();
    }
  };

  const handleImport = (file: File) => {
    importSchedule(file);
  };

  const handleSyncSis = async (file: File) => {
    setIsSyncing(true);
    try {
      await syncSisClassNumbers(file);
    } finally {
      setIsSyncing(false);
    }
  };

  // If no schedule at all, show empty state with import button
  if (!schedule) {
    return (
      <main className="flex-1 flex flex-col min-h-0 bg-slate-950">
        <Header onBack={onBack} title="Schedule Manager" />
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8">
          <Calendar className="w-16 h-16 mb-4 opacity-30" />
          <p className="text-lg font-bold mb-2">No schedule imported</p>
          <p className="text-sm mb-4">Import a schedule file to start managing sessions.</p>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            Import Schedule
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) handleImport(file);
              e.target.value = '';
            }}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col min-h-0 bg-slate-950">
      <Header onBack={onBack} title="Schedule Manager" />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-white/10 bg-slate-950/60">
        {/* Search */}
        <div className="flex items-center gap-1.5 flex-1 min-w-[14rem] bg-slate-950 border border-white/10 rounded-lg px-3 py-1.5">
          <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search sessions…"
            className="flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-slate-500 hover:text-slate-300">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <button onClick={startAdd} className="flex items-center gap-1.5 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/40 text-blue-100 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer">
          <Plus className="w-3.5 h-3.5" /> Add Session
        </button>

        <button onClick={handleDeleteSelected} disabled={selectedIds.size === 0} className="flex items-center gap-1.5 bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-200 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
          <Trash2 className="w-3.5 h-3.5" /> Delete Selected
        </button>

        <button onClick={handleClearAll} className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer">
          <Trash2 className="w-3.5 h-3.5" /> Clear All
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) handleImport(file);
            e.target.value = '';
          }}
        />
        <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer">
          <Upload className="w-3.5 h-3.5" /> Import
        </button>

        <input
          ref={sisFileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) handleSyncSis(file);
            e.target.value = '';
          }}
        />
        <button
          onClick={() => sisFileInputRef.current?.click()}
          disabled={isSyncing}
          title="Update sisClassNumber from a classNumbers.json file scraped from SIS"
          className="flex items-center gap-1.5 bg-teal-500/15 hover:bg-teal-500/25 border border-teal-500/30 text-teal-200 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? 'Syncing…' : 'Sync SIS #'}
        </button>

        {sisSyncResult && onChangeView && (
          <button
            onClick={() => onChangeView('sis-review')}
            className="flex items-center gap-1.5 bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 text-violet-200 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5" />
            Review Changes
          </button>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        <table className="w-full text-sm text-slate-200">
          <thead className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur-sm border-b border-white/10">
            <tr>
              <th className="px-3 py-2 w-8">
                <button onClick={toggleSelectAll} className="text-slate-400 hover:text-white">
                  {allSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 opacity-50" />}
                </button>
              </th>
              <Th>ID</Th>
              <Th>Course</Th>
              <Th>Type</Th>
              <Th>Groups</Th>
              <Th>Day</Th>
              <Th>Start</Th>
              <Th>End</Th>
              <Th>Room</Th>
              <Th>Instructor</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {/* Add new row */}
            {addingNew && draft && (
              <EditRow
                draft={draft}
                setDraft={setDraft}
                errors={errors}
                onSave={handleSave}
                onCancel={cancelEdit}
                isNew
              />
            )}
            {filtered.map(s => {
              if (editingId === s.id && draft) {
                return (
                  <EditRow
                    key={s.id}
                    draft={draft}
                    setDraft={setDraft}
                    errors={errors}
                    onSave={handleSave}
                    onCancel={cancelEdit}
                  />
                );
              }
              const checked = selectedIds.has(s.id);
              return (
                <tr key={s.id} className={`border-b border-white/5 hover:bg-white/5 ${s.outdated ? 'opacity-40' : ''}`}>
                  <td className="px-3 py-2">
                    <button onClick={() => toggleOne(s.id, !checked)} className="text-slate-400 hover:text-white">
                      {checked ? <CheckSquare className="w-4 h-4 text-blue-300" /> : <Square className="w-4 h-4 opacity-50" />}
                    </button>
                  </td>
                  <Td className="font-mono text-xs">{s.id}</Td>
                  <Td className="font-mono text-xs font-bold">
                    {s.courseCode}
                    {s.outdated && (
                      <span className="ml-1.5 inline-block px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded border bg-slate-600/30 text-slate-400 border-slate-600/40" title="Superseded by a corrected SIS entry">
                        Outdated
                      </span>
                    )}
                  </Td>
                  <Td className="uppercase text-[10px] font-bold">{s.sessionType}</Td>
                  <Td className="text-xs">{s.targetGroups.join(', ')}</Td>
                  <Td className={s.outdated ? 'line-through' : ''}>{s.time.dayOfWeek}</Td>
                  <Td className={`font-mono text-xs ${s.outdated ? 'line-through' : ''}`}>{s.time.startTime}</Td>
                  <Td className={`font-mono text-xs ${s.outdated ? 'line-through' : ''}`}>{s.time.endTime}</Td>
                  <Td>{s.roomCode || '—'}</Td>
                  <Td>{s.instructorName || '—'}</Td>
                  <Td>{s.outdated ? '—' : <StatusBadge session={s} />}</Td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => startEdit(s)} className="p-1.5 rounded-md hover:bg-white/10 text-slate-300" title="Edit">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => { if (window.confirm(`Delete session ${s.id}?`)) deleteClassSessions([s.id]); }} className="p-1.5 rounded-md hover:bg-rose-500/15 text-rose-300" title="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer counts */}
      <div className="px-4 py-2 border-t border-white/10 text-[10px] uppercase tracking-wider font-bold text-slate-500">
        {sessions.length} session(s) · {schedule.term}
      </div>
    </main>
  );
}

// ──────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────

function Header({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <header className="px-6 py-4 border-b border-white/10 flex items-center gap-3 bg-slate-950/80 backdrop-blur-md">
      <button onClick={onBack} className="text-slate-300 hover:text-white px-2 py-1 rounded-lg hover:bg-white/5">
        ← Back
      </button>
      <div className="flex-1">
        <h1 className="text-lg font-extrabold tracking-tight flex items-center gap-2">
          <Database className="w-5 h-5 text-amber-400" />
          {title}
        </h1>
        <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Edit, add, or remove class sessions</p>
      </div>
    </header>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider text-slate-400 ${className}`}>{children}</th>;
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 align-top ${className}`}>{children}</td>;
}

function StatusBadge({ session }: { session: ClassSession }) {
  const status = getSectionStatus(session);
  const colors: Record<string, string> = {
    Open: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    Closed: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    Waitlist: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    Unknown: 'bg-slate-500/20 text-slate-400 border-slate-500/40',
  };
  return (
    <span className={`inline-block px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded border ${colors[status] || colors.Unknown}`}>
      {status}
    </span>
  );
}

function EditRow({
  draft,
  setDraft,
  errors,
  onSave,
  onCancel,
  isNew,
}: {
  draft: ClassSession;
  setDraft: (s: ClassSession) => void;
  errors: Record<string, string>;
  onSave: (e?: FormEvent) => void;
  onCancel: () => void;
  isNew?: boolean;
}) {
  const handleChange = (field: string, value: any) => {
    setDraft({ ...draft, [field]: value });
  };

  const handleTimeChange = (field: keyof TimeSlot, value: string) => {
    setDraft({ ...draft, time: { ...draft.time, [field]: value } });
  };

  return (
    <tr className="border-b border-amber-500/40 bg-amber-500/5">
      <td className="px-3 py-2">{isNew ? <Plus className="w-4 h-4 text-blue-300" /> : <Pencil className="w-4 h-4 text-amber-300" />}</td>
      <td className="px-3 py-2" colSpan={11}>
        <form onSubmit={onSave} onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }} className="flex flex-wrap gap-2 items-end">
          <Field label="ID" value={draft.id} onChange={v => handleChange('id', v)} error={errors.id} disabled={!isNew} />
          <Field label="Course Code" value={draft.courseCode} onChange={v => handleChange('courseCode', v)} error={errors.courseCode} />
          <Field label="Title" value={draft.courseName} onChange={v => handleChange('courseName', v)} />
          <Field label="Type" value={draft.sessionType} onChange={v => handleChange('sessionType', v as SessionType)} type="select" options={['LEC','LAB','TUT']} />
          <Field label="Groups (comma)" value={draft.targetGroups.join(', ')} onChange={v => handleChange('targetGroups', v.split(',').map(g => g.trim()).filter(Boolean))} />
          <Field label="Day" value={draft.time.dayOfWeek} onChange={v => handleTimeChange('dayOfWeek', v)} type="select" options={['Saturday','Sunday','Monday','Tuesday','Wednesday','Thursday','Friday']} />
          <Field label="Start" value={draft.time.startTime} onChange={v => handleTimeChange('startTime', v)} error={errors.startTime} placeholder="HH:MM" />
          <Field label="End" value={draft.time.endTime} onChange={v => handleTimeChange('endTime', v)} error={errors.endTime} placeholder="HH:MM" />
          <Field label="Room" value={draft.roomCode} onChange={v => handleChange('roomCode', v)} />
          <Field label="Instructor" value={draft.instructorName} onChange={v => handleChange('instructorName', v)} />
          <Field label="SIS #" value={draft.sisClassNumber} onChange={v => handleChange('sisClassNumber', v)} error={errors.sisClassNumber} />
          <Field label="Capacity" value={draft.capacity?.toString() ?? ''} onChange={v => handleChange('capacity', v === '' ? undefined : Number(v))} type="number" />
          <Field label="Enrolled" value={draft.enrolled?.toString() ?? ''} onChange={v => handleChange('enrolled', v === '' ? undefined : Number(v))} type="number" />
          <div className="flex gap-2 items-end ml-2">
            <button type="submit" className="bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-100 px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider cursor-pointer">Save</button>
            <button type="button" onClick={onCancel} className="bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider cursor-pointer">Cancel</button>
            {Object.keys(errors).length > 0 && <span className="text-[10px] text-rose-300"><AlertTriangle className="w-3 h-3 inline mr-1" />{Object.values(errors)[0]}</span>}
          </div>
        </form>
      </td>
    </tr>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  error,
  disabled,
  placeholder,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  error?: string;
  disabled?: boolean;
  placeholder?: string;
  options?: string[];
}) {
  return (
    <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider font-bold text-slate-400">
      <span>{label}</span>
      {type === 'select' && options ? (
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          className={`bg-slate-950 border rounded-md px-2 py-1.5 text-sm text-white outline-none focus:ring-1 ${
            error ? 'border-rose-500/50 focus:ring-rose-500' : 'border-white/10 focus:ring-blue-500'
          }`}
        >
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          className={`bg-slate-950 border rounded-md px-2 py-1.5 text-sm text-white outline-none focus:ring-1 ${
            error ? 'border-rose-500/50 focus:ring-rose-500' : 'border-white/10 focus:ring-blue-500'
          }`}
        />
      )}
      {error && <span className="text-rose-300 normal-case font-normal tracking-normal">{error}</span>}
    </label>
  );
}