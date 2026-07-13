/**
 * StudentCombobox — searchable student picker.
 *
 * Same shape as `CourseCombobox`: a custom dropdown because the
 * native `<select>` cannot filter options by free-text typing on
 * name + ID, and cannot show "Name (ID) — Major" legibly when the
 * cohort is 200+ students.
 *
 * Used by `PrereqMapScreen` as the active-student picker so the
 * adviser can:
 *   - open the dropdown
 *   - type a partial name or ID
 *   - click a row to jump to that student
 *   - clear the pick with the X
 *
 * The major filter inside the panel narrows the visible list to
 * one major — useful when the cohort spans six departments and the
 * adviser only wants Mechatronics.
 *
 * Pure UI: parent passes `students` (the full sorted list), the
 * `value` (active student id) and `onChange`. The component owns
 * the local search text + major filter.
 */

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import type { StudentMetrics } from '../data/types';
import { getAvailableMajors } from '../data/filters';
import { useAutoFocusOnOpen } from './shared/useAutoFocusOnOpen';
import { useClickOutside } from './shared/useClickOutside';

export interface StudentComboboxProps {
  /** Full student list, sorted however the caller wants. */
  students: StudentMetrics[];
  /** Active student id. '' = nothing picked. */
  value: string;
  /** Fired with the new student id on pick, or '' on clear. */
  onChange: (studentId: string) => void;
  /** Label rendered above the combobox. */
  label?: string;
  /** Show the major filter. Default: true. */
  showMajorFilter?: boolean;
  /** Placeholder when no students are loaded. */
  emptyLabel?: string;
}

export default function StudentCombobox({
  students,
  value,
  onChange,
  label,
  showMajorFilter = true,
  emptyLabel = '— no students —',
}: StudentComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [major, setMajor] = useState<string>('all');
  const containerRef = useClickOutside<HTMLDivElement>(open, () => setOpen(false));
  const inputRef = useAutoFocusOnOpen<HTMLInputElement>(open);

  // Distinct majors present in the dataset. Powers the inner filter
  // dropdown so the adviser can scope the list to a single major.
  const majorOptions = useMemo(() => getAvailableMajors(students), [students]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return students.filter((s) => {
      if (major !== 'all' && s.major !== major) return false;
      if (!q) return true;
      const name = (s.name || '').toLowerCase();
      const id = s.studentId.toLowerCase();
      return name.includes(q) || id.includes(q);
    });
  }, [students, query, major]);

  // Close the menu when the parent changes the value externally.
  useEffect(() => {
    setOpen(false);
  }, [value]);

  const picked = students.find((s) => s.studentId === value);
  const triggerLabel = picked
    ? `${picked.name?.trim() || `Student ${picked.studentId}`} (${picked.studentId})`
    : students.length === 0
      ? emptyLabel
      : '— select a student —';

  return (
    <div ref={containerRef} className="space-y-1 w-full min-w-[28rem]">
      {label && (
        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          {label}
        </label>
      )}

      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between gap-2 bg-slate-950 border rounded-lg px-3 py-2 text-xs text-left outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer ${
          picked ? 'text-white border-blue-500/30' : 'text-slate-400 border-white/10'
        }`}
      >
        <span className="truncate">{triggerLabel}</span>
        <span className="flex items-center gap-1 shrink-0">
          {picked && (
            <span
              role="button"
              aria-label="Clear selection"
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
              }}
              className="p-0.5 rounded hover:bg-white/10 text-slate-400 hover:text-slate-200"
            >
              <X className="w-3 h-3" />
            </span>
          )}
          <ChevronDown className={`w-3 h-3 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {open && (
        <div className="relative">
          <div className="absolute z-30 left-0 right-0 mt-1 bg-slate-950 border border-white/10 rounded-lg shadow-xl shadow-black/40 min-w-[20rem] max-h-96 flex flex-col">
            {/* Search box */}
            <div className="relative border-b border-white/10">
              <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-500" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name or ID..."
                className="w-full bg-transparent py-2 pl-9 pr-3 text-xs text-white outline-none placeholder:text-slate-500"
              />
            </div>

            {/* Major filter (optional) */}
            {showMajorFilter && majorOptions.length > 0 && (
              <div className="border-b border-white/10 px-2 py-2 flex items-center gap-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider shrink-0">
                  Major
                </span>
                <select
                  value={major}
                  onChange={(e) => setMajor(e.target.value)}
                  className="flex-1 bg-slate-900 border border-white/10 rounded px-2 py-1 text-xs text-white outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="all">All majors</option>
                  {majorOptions.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Result list */}
            <ul className="flex-1 overflow-y-auto">
              {students.length === 0 && (
                <li className="px-3 py-3 text-xs text-slate-500">
                  No students loaded.
                </li>
              )}
              {students.length > 0 && filtered.length === 0 && (
                <li className="px-3 py-3 text-xs text-slate-500">
                  No students match your filters.
                </li>
              )}
              {filtered.map((s) => {
                const active = s.studentId === value;
                return (
                  <li key={s.studentId}>
                    <button
                      type="button"
                      onClick={() => onChange(s.studentId)}
                      className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-xs cursor-pointer ${
                        active
                          ? 'bg-blue-500/15 text-blue-100'
                          : 'text-slate-200 hover:bg-white/5'
                      }`}
                    >
                      <span className="flex items-center gap-2 truncate">
                        <span className="font-mono font-bold text-slate-300">{s.studentId}</span>
                        <span className="truncate">{s.name?.trim() || `(no name)`}</span>
                      </span>
                      {s.major && (
                        <span className="text-[10px] font-mono text-slate-500 shrink-0 truncate max-w-[10rem]">
                          {s.major}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* Footer hint */}
            <div className="border-t border-white/10 px-3 py-1.5 text-[10px] text-slate-500 flex items-center justify-between gap-2">
              <span className="font-mono">{filtered.length} of {students.length} students</span>
              <span className="truncate">{picked ? `Selected: ${picked.studentId}` : 'Nothing selected'}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}