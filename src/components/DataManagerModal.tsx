/**
 * DataManagerModal — v2.
 *
 * Single modal launched from the header button "Manage data". Three
 * tabs (Grade-book / Catalog / Roster) each expose:
 *
 *   - Search box that filters the visible list in-place
 *   - Checkbox column with a "select all (filtered)" header toggle
 *   - Per-row Edit (inline form) + Delete
 *   - Toolbar: Add row · Delete selected · Clear all · Append from file
 *   - Sticky footer with counts ("N row(s)")
 *
 * Editing pattern: each tab's `renderRow` returns body cells; the
 * header cells come from a sibling `renderHeader`. The edit-row form
 * spans every column so it reads the same on any tab regardless of
 * how wide the table is.
 *
 * The four file-import buttons in the header stay as REPLACE
 * (wholesale restore). The "Append from file" inside this modal is the
 * bulk-tweak path — it merges by the same key the CRUD uses.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckSquare,
  Database,
  FileSpreadsheet,
  Pencil,
  Plus,
  Save,
  Search,
  Square,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { useData } from '../data/DataContext';
import type {
  CatalogCourse,
  CourseCatalog,
  GradeRow,
  GradeRowKey,
  RosterEntry,
} from '../data/types';
import Modal from './shared/Modal';

type Tab = 'grade' | 'catalog' | 'roster';

interface DataManagerModalProps {
  open: boolean;
  onClose: () => void;
}

// =========================================================================
// Shared key helpers
// =========================================================================

function gradeKeyOf(r: GradeRow): GradeRowKey {
  return { studentId: r.studentId, course: r.course, term: r.term };
}

function gradeKeyString(k: GradeRowKey): string {
  return `${k.studentId} ${k.course} ${k.term}`;
}

function courseKeyOf(c: CatalogCourse): string {
  return c.code.trim().toUpperCase().replace(/\s+/g, '');
}

function studentKeyOf(r: RosterEntry): string {
  return r.studentId;
}

// =========================================================================
// Generic editor (used by all three tabs)
// =========================================================================

interface EditableListProps<T> {
  rows: T[];
  query: string;
  setQuery: (s: string) => void;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  editingKey: string | null;
  setEditingKey: (k: string | null) => void;
  addingNew: boolean;
  setAddingNew: (b: boolean) => void;
  draft: T | null;
  setDraft: (t: T | null) => void;
  /** Header cells (column titles). */
  renderHeader: () => ReactNode;
  /** Body cells for a single row in view mode. */
  renderRow: (row: T, beginEdit: (row: T) => void) => ReactNode;
  /** Inputs for the draft row in edit/add mode. */
  renderEdit: (
    draft: T,
    setDraft: (t: T) => void,
    errors: Record<string, string>
  ) => ReactNode;
  validate: (draft: T) => Record<string, string>;
  newRow: () => T;
  /** Save the draft. Returns true on success. */
  onSave: (draft: T, isNew: boolean) => boolean;
  /** Delete a single row by key. */
  onDeleteOne: (key: string) => void;
  /** Delete the given list of keys (bulk). */
  onDeleteMany: (keys: string[]) => void;
  Icon: typeof BookOpen;
  accent: string;
  entityName: string;
  totalCount: number;
  keyOf: (row: T) => string;
  onAppendFile: (file: File) => void;
  onClearAll: () => void;
  emptyHint: string;
  /** Custom confirm for the per-row delete (entity-specific wording). */
  confirmDeleteOne: (row: T) => boolean;
  /** Add-button label. */
  addLabel?: string;
}

function EditableList<T>({
  rows,
  query,
  setQuery,
  selected,
  setSelected,
  editingKey,
  setEditingKey,
  addingNew,
  setAddingNew,
  draft,
  setDraft,
  renderHeader,
  renderRow,
  renderEdit,
  validate,
  newRow,
  onSave,
  onDeleteOne,
  onDeleteMany,
  Icon,
  accent,
  entityName,
  totalCount,
  keyOf,
  onAppendFile,
  onClearAll,
  emptyHint,
  confirmDeleteOne,
  addLabel = 'Add row',
}: EditableListProps<T>) {
  const fileInput = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
  }, [rows, query]);

  const filteredKeys = useMemo(
    () => filtered.map((r) => keyOf(r)),
    [filtered, keyOf]
  );

  const allFilteredSelected =
    filteredKeys.length > 0 &&
    filteredKeys.every((k) => selected.has(k));

  const toggleSelectAllFiltered = () => {
    const next = new Set(selected);
    if (allFilteredSelected) {
      for (const k of filteredKeys) next.delete(k);
    } else {
      for (const k of filteredKeys) next.add(k);
    }
    setSelected(next);
  };

  const toggleOne = (k: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(k);
    else next.delete(k);
    setSelected(next);
  };

  const beginAdd = () => {
    setAddingNew(true);
    setEditingKey('__new__');
    setDraft(newRow());
  };

  const beginEdit = (row: T) => {
    setAddingNew(false);
    setEditingKey(keyOf(row));
    setDraft({ ...row });
  };

  const cancelEdit = () => {
    setAddingNew(false);
    setEditingKey(null);
    setDraft(null);
  };

  const draftErrors = draft ? validate(draft) : {};

  const submitEdit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    if (Object.keys(validate(draft)).length > 0) return;
    const ok = onSave(draft, addingNew);
    if (ok) cancelEdit();
  };

  const onEditKey = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-white/10 bg-slate-950/40">
        <div className="flex items-center gap-1.5 flex-1 min-w-[14rem] bg-slate-950 border border-white/10 rounded-lg px-3 py-1.5">
          <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <input
            value={query}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              setQuery(e.target.value)
            }
            placeholder={`Search ${entityName}…`}
            className="flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              title="Clear search"
              className="text-slate-500 hover:text-slate-300 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={beginAdd}
          className={`flex items-center gap-1.5 ${accent} px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer transition-colors`}
        >
          <Plus className="w-3.5 h-3.5" />
          {addLabel}
        </button>
        <button
          type="button"
          disabled={selected.size === 0}
          onClick={() => {
            if (selected.size === 0) return;
            if (
              window.confirm(
                `Delete ${selected.size} ${entityName} row(s)? This cannot be undone (use "Export" first if you want a backup).`
              )
            ) {
              onDeleteMany(Array.from(selected));
              setSelected(new Set());
            }
          }}
          className="flex items-center gap-1.5 bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-200 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete selected
        </button>
        <button
          type="button"
          disabled={totalCount === 0}
          onClick={() => {
            if (
              window.confirm(
                `Clear ALL ${totalCount} ${entityName} row(s) from this dataset? Other tabs are not affected.`
              )
            ) {
              onClearAll();
            }
          }}
          className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Clear all
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (file) onAppendFile(file);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer transition-colors"
        >
          <Upload className="w-3.5 h-3.5" />
          Append from file
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-auto custom-scrollbar">
        {filtered.length === 0 && !addingNew ? (
          <div className="px-6 py-16 text-center text-slate-500">
            <Icon className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <div className="text-sm font-bold">
              {totalCount === 0
                ? `No ${entityName} rows yet.`
                : 'No rows match your search.'}
            </div>
            {totalCount === 0 && (
              <div className="mt-2 text-xs max-w-md mx-auto">
                {emptyHint}
              </div>
            )}
          </div>
        ) : (
          <table className="w-full text-sm text-slate-200">
            <thead className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur-sm border-b border-white/10">
              <tr>
                <th className="px-3 py-2 w-8">
                  <button
                    type="button"
                    onClick={toggleSelectAllFiltered}
                    title={
                      allFilteredSelected
                        ? 'Deselect all (filtered)'
                        : 'Select all (filtered)'
                    }
                    className="text-slate-400 hover:text-white cursor-pointer"
                  >
                    {allFilteredSelected ? (
                      <CheckSquare className="w-4 h-4" />
                    ) : (
                      <Square className="w-4 h-4 opacity-50" />
                    )}
                  </button>
                </th>
                {renderHeader()}
              </tr>
            </thead>
            <tbody>
              {addingNew && draft && (
                <tr className="border-b border-blue-500/40 bg-blue-500/5">
                  <td className="px-3 py-2 w-8 align-top">
                    <Plus className="w-4 h-4 text-blue-300" />
                  </td>
                  <td className="px-3 py-2" colSpan={100}>
                    <form
                      onSubmit={submitEdit}
                      onKeyDown={onEditKey}
                      className="flex flex-col gap-2"
                    >
                      {renderEdit(draft, (t: T) => setDraft(t), draftErrors)}
                      <div className="flex items-center gap-2">
                        <button
                          type="submit"
                          disabled={Object.keys(draftErrors).length > 0}
                          className={`flex items-center gap-1.5 ${accent} px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed`}
                        >
                          <Save className="w-3.5 h-3.5" />
                          Add
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                          Cancel
                        </button>
                        {Object.keys(draftErrors).length > 0 && (
                          <span className="text-[10px] text-rose-300 font-bold uppercase tracking-wider inline-flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            {Object.values(draftErrors)[0]}
                          </span>
                        )}
                      </div>
                    </form>
                  </td>
                </tr>
              )}
              {filtered.map((row) => {
                const k = keyOf(row);
                const isEditing = editingKey === k;
                const isChecked = selected.has(k);
                if (isEditing && draft) {
                  return (
                    <tr
                      key={k}
                      className="border-b border-amber-500/40 bg-amber-500/5"
                    >
                      <td className="px-3 py-2 w-8 align-top">
                        <Pencil className="w-4 h-4 text-amber-300" />
                      </td>
                      <td className="px-3 py-2" colSpan={100}>
                        <form
                          onSubmit={submitEdit}
                          onKeyDown={onEditKey}
                          className="flex flex-col gap-2"
                        >
                          {renderEdit(
                            draft,
                            (t: T) => setDraft(t),
                            draftErrors
                          )}
                          <div className="flex items-center gap-2">
                            <button
                              type="submit"
                              disabled={Object.keys(draftErrors).length > 0}
                              className="flex items-center gap-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-100 px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <Save className="w-3.5 h-3.5" />
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                              Cancel
                            </button>
                            {Object.keys(draftErrors).length > 0 && (
                              <span className="text-[10px] text-rose-300 font-bold uppercase tracking-wider inline-flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                {Object.values(draftErrors)[0]}
                              </span>
                            )}
                          </div>
                        </form>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr
                    key={k}
                    className="border-b border-white/5 hover:bg-white/5 transition-colors"
                  >
                    <td className="px-3 py-2 w-8 align-top">
                      <button
                        type="button"
                        onClick={() => toggleOne(k, !isChecked)}
                        title={isChecked ? 'Deselect' : 'Select'}
                        className="text-slate-400 hover:text-white cursor-pointer"
                      >
                        {isChecked ? (
                          <CheckSquare className="w-4 h-4 text-blue-300" />
                        ) : (
                          <Square className="w-4 h-4 opacity-50" />
                        )}
                      </button>
                    </td>
                    {renderRow(row, beginEdit)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// =========================================================================
// Generic form fields
// =========================================================================

interface FieldProps {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: 'text' | 'number';
  required?: boolean;
  error?: string;
  className?: string;
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required,
  error,
  className = '',
}: FieldProps) {
  return (
    <label
      className={`flex flex-col gap-1 text-[10px] uppercase tracking-wider font-bold text-slate-400 ${className}`}
    >
      <span>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className={`bg-slate-950 border rounded-md px-2 py-1.5 text-sm text-white outline-none focus:ring-1 ${
          error
            ? 'border-rose-500/50 focus:ring-rose-500'
            : 'border-white/10 focus:ring-blue-500'
        }`}
      />
      {error && (
        <span className="text-rose-300 normal-case font-normal tracking-normal">
          {error}
        </span>
      )}
    </label>
  );
}

function Th({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider text-slate-400 ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2 align-top ${className}`}>{children}</td>;
}

function IconAction({
  children,
  title,
  tone,
  onClick,
}: {
  children: ReactNode;
  title: string;
  tone?: 'rose' | 'slate';
  onClick: () => void;
}) {
  const cls =
    tone === 'rose'
      ? 'hover:bg-rose-500/15 text-rose-300'
      : 'hover:bg-white/10 text-slate-300';
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded-md transition-colors cursor-pointer ${cls}`}
    >
      {children}
    </button>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md uppercase tracking-wider transition-colors cursor-pointer ${
        active
          ? 'bg-blue-500/20 text-blue-100'
          : 'text-slate-400 hover:text-white'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

// =========================================================================
// Modal entry
// =========================================================================

export default function DataManagerModal({
  open,
  onClose,
}: DataManagerModalProps) {
  const {
    state,
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
  } = useData();

  const [tab, setTab] = useState<Tab>('grade');

  // Clear edits when the modal closes so a stale draft doesn't carry
  // over to the next open. Cheap and avoids "phantom rows in edit
  // mode after closing".
  useEffect(() => {
    if (!open) {
      setTab('grade');
    }
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth="max-w-6xl"
      footer={
        <div className="flex items-center gap-3">
          <div className="flex-1 text-[10px] uppercase tracking-wider font-bold text-slate-500">
            {tab === 'grade'
              ? `${state.rows.length} grade row(s)`
              : tab === 'catalog'
                ? `${state.catalog?.courses.length ?? 0} catalog course(s)`
                : `${state.roster.length} roster entr${state.roster.length === 1 ? 'y' : 'ies'}`}
          </div>
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-lg border border-white/10 text-xs font-bold uppercase tracking-wider text-slate-300 hover:bg-white/5 cursor-pointer"
          >
            Close
          </button>
        </div>
      }
    >
      <div className="flex flex-col h-[80vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center gap-3">
          <Database className="w-5 h-5 text-blue-400" />
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-extrabold tracking-tight">
              Manage data
            </h2>
            <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
              Edit / delete / add rows without re-uploading the Excel
            </p>
          </div>
          <div className="flex items-center bg-slate-950 border border-white/10 rounded-lg p-1 text-xs font-bold">
            <TabButton
              active={tab === 'grade'}
              onClick={() => setTab('grade')}
              icon={<BookOpen className="w-3.5 h-3.5" />}
            >
              Grade-book
            </TabButton>
            <TabButton
              active={tab === 'catalog'}
              onClick={() => setTab('catalog')}
              icon={<FileSpreadsheet className="w-3.5 h-3.5" />}
            >
              Catalog
            </TabButton>
            <TabButton
              active={tab === 'roster'}
              onClick={() => setTab('roster')}
              icon={<Users className="w-3.5 h-3.5" />}
            >
              Roster
            </TabButton>
          </div>
        </div>

        {/* Tab body */}
        <div className="flex-1 min-h-0">
          {tab === 'grade' && (
            <GradeRowsTab
              rows={state.rows}
              onAdd={addGradeRow}
              onUpdate={updateGradeRow}
              onDeleteMany={(keys) => {
                const ks: GradeRowKey[] = keys.map((k) => {
                  const [studentId, course, ...rest] = k.split(' ');
                  return { studentId, course, term: rest.join(' ') };
                });
                deleteGradeRows(ks);
              }}
              onImport={importGradeBookAppend}
              onClearAll={clearGradeRows}
            />
          )}
          {tab === 'catalog' && (
            <CatalogTab
              catalog={state.catalog}
              onAdd={addCatalogCourse}
              onUpdate={updateCatalogCourse}
              onDeleteMany={deleteCatalogCourses}
              onImport={importCatalogAppend}
              onClearAll={clearCatalog}
            />
          )}
          {tab === 'roster' && (
            <RosterTab
              roster={state.roster}
              onAdd={addRosterEntry}
              onUpdate={updateRosterEntry}
              onDeleteMany={deleteRosterEntries}
              onImport={importRosterAppend}
              onClearAll={clearRoster}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}

// =========================================================================
// Grade-book tab
// =========================================================================

function GradeRowsTab({
  rows,
  onAdd,
  onUpdate,
  onDeleteMany,
  onImport,
  onClearAll,
}: {
  rows: GradeRow[];
  onAdd: (r: GradeRow) => boolean;
  onUpdate: (k: GradeRowKey, patch: Partial<GradeRow>) => void;
  onDeleteMany: (keys: string[]) => void;
  onImport: (f: File) => Promise<void>;
  onClearAll: () => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [draft, setDraft] = useState<GradeRow | null>(null);

  const keyOf = (r: GradeRow) => gradeKeyString(gradeKeyOf(r));

  const newRow = (): GradeRow => ({
    studentId: '',
    studentName: '',
    major: '',
    course: '',
    units: 3,
    grade: '',
    term: '',
    cumulativeGpa: undefined,
  });

  const validate = (d: GradeRow): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!d.studentId.trim()) e.studentId = 'Required';
    if (!d.course.trim()) e.course = 'Required';
    if (!d.grade.trim()) e.grade = 'Required';
    if (typeof d.units !== 'number' || !Number.isFinite(d.units) || d.units < 0)
      e.units = 'Number ≥ 0';
    return e;
  };

  const onSave = (d: GradeRow, isNew: boolean): boolean => {
    const cleaned: GradeRow = {
      ...d,
      studentId: d.studentId.trim(),
      course: d.course.trim(),
      grade: d.grade.trim().toUpperCase(),
      term: d.term.trim(),
      studentName: d.studentName?.trim() || undefined,
      major: d.major?.trim() || undefined,
    };
    if (isNew) return onAdd(cleaned);
    onUpdate(
      { studentId: cleaned.studentId, course: cleaned.course, term: cleaned.term },
      cleaned
    );
    return true;
  };

  const renderHeader = (): ReactNode => (
    <>
      <Th>ID</Th>
      <Th>Name</Th>
      <Th>Major</Th>
      <Th>Course</Th>
      <Th>Units</Th>
      <Th>Grade</Th>
      <Th>Term</Th>
      <Th>GPA</Th>
      <Th className="text-right">Actions</Th>
    </>
  );

  const renderRow = (r: GradeRow, beginEdit: (r: GradeRow) => void): ReactNode => (
    <>
      <Td className="font-mono text-xs">{r.studentId}</Td>
      <Td>{r.studentName || <span className="text-slate-500">—</span>}</Td>
      <Td>{r.major || <span className="text-slate-500">—</span>}</Td>
      <Td className="font-mono text-xs">{r.course}</Td>
      <Td>{r.units}</Td>
      <Td>{r.grade}</Td>
      <Td>{r.term}</Td>
      <Td>
        {r.cumulativeGpa == null ? (
          <span className="text-slate-500">—</span>
        ) : (
          r.cumulativeGpa.toFixed(2)
        )}
      </Td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-1">
          <IconAction
            title="Edit row"
            onClick={() => beginEdit(r)}
          >
            <Pencil className="w-3.5 h-3.5" />
          </IconAction>
          <IconAction
            title="Delete row"
            tone="rose"
            onClick={() => {
              if (
                window.confirm(
                  `Delete grade row for ${r.studentId} / ${r.course} / ${r.term || '(no term)'}?`
                )
              ) {
                onDeleteMany([keyOf(r)]);
              }
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </IconAction>
        </div>
      </td>
    </>
  );

  const renderEdit = (
    d: GradeRow,
    setD: (t: GradeRow) => void,
    errs: Record<string, string>
  ): ReactNode => (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      <Field
        label="Student ID"
        value={d.studentId}
        onChange={(v) => setD({ ...d, studentId: v })}
        required
        error={errs.studentId}
      />
      <Field
        label="Name"
        value={d.studentName ?? ''}
        onChange={(v) => setD({ ...d, studentName: v })}
      />
      <Field
        label="Major"
        value={d.major ?? ''}
        onChange={(v) => setD({ ...d, major: v })}
      />
      <Field
        label="Course"
        value={d.course}
        onChange={(v) => setD({ ...d, course: v })}
        required
        error={errs.course}
      />
      <Field
        label="Units"
        type="number"
        value={d.units}
        onChange={(v) =>
          setD({ ...d, units: v === '' ? 0 : Number(v) })
        }
        error={errs.units}
      />
      <Field
        label="Grade"
        value={d.grade}
        onChange={(v) => setD({ ...d, grade: v.toUpperCase() })}
        required
        error={errs.grade}
      />
      <Field
        label="Term"
        value={d.term}
        onChange={(v) => setD({ ...d, term: v })}
      />
      <Field
        label="Cum GPA"
        type="number"
        value={d.cumulativeGpa ?? ''}
        onChange={(v) =>
          setD({
            ...d,
            cumulativeGpa: v === '' ? undefined : Number(v),
          })
        }
      />
    </div>
  );

  return (
    <EditableList
      rows={rows}
      query={query}
      setQuery={setQuery}
      selected={selected}
      setSelected={setSelected}
      editingKey={editingKey}
      setEditingKey={setEditingKey}
      addingNew={addingNew}
      setAddingNew={setAddingNew}
      draft={draft}
      setDraft={setDraft}
      renderHeader={renderHeader}
      renderRow={renderRow}
      renderEdit={renderEdit}
      validate={validate}
      newRow={newRow}
      onSave={onSave}
      onDeleteOne={() => {}}
      onDeleteMany={onDeleteMany}
      Icon={BookOpen}
      accent="bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/40 text-blue-100"
      entityName="grade-book"
      totalCount={rows.length}
      keyOf={keyOf}
      onAppendFile={(f) => {
        onImport(f);
      }}
      onClearAll={onClearAll}
      emptyHint="Click Add row to create a single entry, or Append from file to merge an existing Excel."
      confirmDeleteOne={() => true}
    />
  );
}

// =========================================================================
// Catalog tab
// =========================================================================

function CatalogTab({
  catalog,
  onAdd,
  onUpdate,
  onDeleteMany,
  onImport,
  onClearAll,
}: {
  catalog: CourseCatalog | null;
  onAdd: (c: CatalogCourse) => boolean;
  onUpdate: (code: string, patch: Partial<CatalogCourse>) => void;
  onDeleteMany: (codes: string[]) => void;
  onImport: (f: File) => Promise<void>;
  onClearAll: () => void;
}) {
  const courses = catalog?.courses ?? [];
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [draft, setDraft] = useState<CatalogCourse | null>(null);

  const keyOf = (c: CatalogCourse) => courseKeyOf(c);

  const newRow = (): CatalogCourse => ({
    code: '',
    title: '',
    credits: 3,
    prerequisites: [],
  });

  const validate = (d: CatalogCourse): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!d.code.trim()) e.code = 'Required';
    if (!d.title.trim()) e.title = 'Required';
    if (typeof d.credits !== 'number' || d.credits < 0) e.credits = 'Number ≥ 0';
    return e;
  };

  const onSave = (d: CatalogCourse, isNew: boolean): boolean => {
    const cleaned: CatalogCourse = {
      ...d,
      code: d.code.trim(),
      title: d.title.trim(),
      credits:
        typeof d.credits === 'number' && Number.isFinite(d.credits)
          ? d.credits
          : 0,
      prerequisites: Array.isArray(d.prerequisites) ? d.prerequisites : [],
    };
    if (isNew) return onAdd(cleaned);
    onUpdate(cleaned.code, cleaned);
    return true;
  };

  const renderHeader = (): ReactNode => (
    <>
      <Th>Code</Th>
      <Th>Title</Th>
      <Th>Credits</Th>
      <Th>Prerequisites</Th>
      <Th className="text-right">Actions</Th>
    </>
  );

  const renderRow = (c: CatalogCourse, beginEdit: (c: CatalogCourse) => void): ReactNode => (
    <>
      <Td className="font-mono text-xs">{c.code}</Td>
      <Td className="font-bold">{c.title}</Td>
      <Td>{c.credits}</Td>
      <Td className="text-xs text-slate-400">
        {c.prerequisites.length === 0 ? '—' : c.prerequisites.join(', ')}
      </Td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-1">
          <IconAction title="Edit course" onClick={() => beginEdit(c)}>
            <Pencil className="w-3.5 h-3.5" />
          </IconAction>
          <IconAction
            title="Delete course"
            tone="rose"
            onClick={() => {
              if (
                window.confirm(
                  `Delete catalog course "${c.code}"? This will also affect advising queries that reference it.`
                )
              ) {
                onDeleteMany([keyOf(c)]);
              }
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </IconAction>
        </div>
      </td>
    </>
  );

  const renderEdit = (
    d: CatalogCourse,
    setD: (t: CatalogCourse) => void,
    errs: Record<string, string>
  ): ReactNode => (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      <Field
        label="Code"
        value={d.code}
        onChange={(v) => setD({ ...d, code: v })}
        required
        error={errs.code}
      />
      <Field
        label="Title"
        value={d.title}
        onChange={(v) => setD({ ...d, title: v })}
        required
        error={errs.title}
      />
      <Field
        label="Credits"
        type="number"
        value={d.credits}
        onChange={(v) =>
          setD({ ...d, credits: v === '' ? 0 : Number(v) })
        }
        error={errs.credits}
      />
      <Field
        label="Prerequisites (comma)"
        value={
          Array.isArray(d.prerequisites) ? d.prerequisites.join(', ') : ''
        }
        onChange={(v) =>
          setD({
            ...d,
            prerequisites: v
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          })
        }
      />
    </div>
  );

  return (
    <EditableList
      rows={courses}
      query={query}
      setQuery={setQuery}
      selected={selected}
      setSelected={setSelected}
      editingKey={editingKey}
      setEditingKey={setEditingKey}
      addingNew={addingNew}
      setAddingNew={setAddingNew}
      draft={draft}
      setDraft={setDraft}
      renderHeader={renderHeader}
      renderRow={renderRow}
      renderEdit={renderEdit}
      validate={validate}
      newRow={newRow}
      onSave={onSave}
      onDeleteOne={() => {}}
      onDeleteMany={onDeleteMany}
      Icon={FileSpreadsheet}
      accent="bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-indigo-100"
      entityName="catalog"
      totalCount={courses.length}
      keyOf={keyOf}
      onAppendFile={(f) => {
        onImport(f);
      }}
      onClearAll={onClearAll}
      emptyHint="Click Add row to add a course manually, or Append from file to merge an Excel catalog. (Until you import a catalog, the prereq map has no courses to render.)"
      confirmDeleteOne={() => true}
    />
  );
}

// =========================================================================
// Roster tab
// =========================================================================

function RosterTab({
  roster,
  onAdd,
  onUpdate,
  onDeleteMany,
  onImport,
  onClearAll,
}: {
  roster: RosterEntry[];
  onAdd: (r: RosterEntry) => boolean;
  onUpdate: (id: string, patch: Partial<RosterEntry>) => void;
  onDeleteMany: (ids: string[]) => void;
  onImport: (f: File) => Promise<void>;
  onClearAll: () => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [draft, setDraft] = useState<RosterEntry | null>(null);

  const keyOf = (r: RosterEntry) => studentKeyOf(r);

  const newRow = (): RosterEntry => ({
    studentId: '',
    studentName: '',
    major: '',
    email: '',
    nationalId: '',
  });

  const validate = (d: RosterEntry): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!d.studentId.trim()) e.studentId = 'Required';
    return e;
  };

  const onSave = (d: RosterEntry, isNew: boolean): boolean => {
    const cleaned: RosterEntry = {
      studentId: d.studentId.trim(),
      studentName: d.studentName?.trim() || undefined,
      major: d.major?.trim() || undefined,
      email: d.email?.trim() || undefined,
      nationalId: d.nationalId?.trim() || undefined,
    };
    if (isNew) return onAdd(cleaned);
    onUpdate(cleaned.studentId, cleaned);
    return true;
  };

  const renderHeader = (): ReactNode => (
    <>
      <Th>Student ID</Th>
      <Th>Name</Th>
      <Th>Major</Th>
      <Th>Email</Th>
      <Th>National ID</Th>
      <Th className="text-right">Actions</Th>
    </>
  );

  const renderRow = (r: RosterEntry, beginEdit: (r: RosterEntry) => void): ReactNode => (
    <>
      <Td className="font-mono text-xs">{r.studentId}</Td>
      <Td className="font-bold">
        {r.studentName || <span className="text-slate-500">—</span>}
      </Td>
      <Td>{r.major || <span className="text-slate-500">—</span>}</Td>
      <Td className="font-mono text-xs text-slate-400">
        {r.email || <span className="text-slate-500">—</span>}
      </Td>
      <Td className="font-mono text-xs text-slate-400">
        {r.nationalId || <span className="text-slate-500">—</span>}
      </Td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-1">
          <IconAction title="Edit entry" onClick={() => beginEdit(r)}>
            <Pencil className="w-3.5 h-3.5" />
          </IconAction>
          <IconAction
            title="Delete entry"
            tone="rose"
            onClick={() => {
              if (
                window.confirm(
                  `Delete roster entry for "${r.studentId}"? Existing grade-book rows still reference this id.`
                )
              ) {
                onDeleteMany([keyOf(r)]);
              }
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </IconAction>
        </div>
      </td>
    </>
  );

  const renderEdit = (
    d: RosterEntry,
    setD: (t: RosterEntry) => void,
    errs: Record<string, string>
  ): ReactNode => (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
      <Field
        label="Student ID"
        value={d.studentId}
        onChange={(v) => setD({ ...d, studentId: v })}
        required
        error={errs.studentId}
      />
      <Field
        label="Name"
        value={d.studentName ?? ''}
        onChange={(v) => setD({ ...d, studentName: v })}
      />
      <Field
        label="Major"
        value={d.major ?? ''}
        onChange={(v) => setD({ ...d, major: v })}
      />
      <Field
        label="Email"
        value={d.email ?? ''}
        onChange={(v) => setD({ ...d, email: v })}
      />
      <Field
        label="National ID"
        value={d.nationalId ?? ''}
        onChange={(v) => setD({ ...d, nationalId: v })}
      />
    </div>
  );

  return (
    <EditableList
      rows={roster}
      query={query}
      setQuery={setQuery}
      selected={selected}
      setSelected={setSelected}
      editingKey={editingKey}
      setEditingKey={setEditingKey}
      addingNew={addingNew}
      setAddingNew={setAddingNew}
      draft={draft}
      setDraft={setDraft}
      renderHeader={renderHeader}
      renderRow={renderRow}
      renderEdit={renderEdit}
      validate={validate}
      newRow={newRow}
      onSave={onSave}
      onDeleteOne={() => {}}
      onDeleteMany={onDeleteMany}
      Icon={Users}
      accent="bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-100"
      entityName="roster"
      totalCount={roster.length}
      keyOf={keyOf}
      onAppendFile={(f) => {
        onImport(f);
      }}
      onClearAll={onClearAll}
      emptyHint="Click Add row to add a single student, or Append from file to merge an Excel roster."
      confirmDeleteOne={() => true}
    />
  );
}
