/**
 * CourseCombobox — searchable + major-filterable catalog picker.
 *
 * A custom dropdown because the native `<select>` cannot:
 *   - filter options by free-text typing on code + title
 *   - narrow options to one major's plan
 *   - render code + title together without truncation
 *
 * Used by both the FailedTab (pick the course to search failures for)
 * and the SuggestTab (focus the suggestion list on a single course).
 *
 * Pure UI: the parent passes `courses`, `value` (the picked course
 * code or ''), and `onChange`. The component owns the local search
 * text + major filter so re-renders stay cheap.
 *
 * When `courses` is empty or has no `majors[]` column on every row,
 * the major filter is hidden — there's nothing meaningful to filter
 * by.
 */

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import type { CatalogCourse } from '../data/types';
import { normalizeCourseCodeLoose } from '../data/normalize';
import { catalogMajorsFor, resolveMajorIndex, semesterForMajor } from '../data/majorIndex';
import { useAutoFocusOnOpen } from './shared/useAutoFocusOnOpen';
import { useClickOutside } from './shared/useClickOutside';

export interface CourseComboboxProps {
  /** Catalog rows. Empty array = no catalog imported. */
  courses: CatalogCourse[];
  /** Currently picked course code (normalized). '' = nothing picked. */
  value: string;
  /** Fired with the normalized course code on pick, or '' on clear. */
  onChange: (code: string) => void;
  /** Placeholder for the empty state of the dropdown trigger. */
  emptyLabel?: string;
  /** Label rendered above the combobox. */
  label?: string;
}

interface Option {
  code: string;
  title: string;
  /** Semester number on the chosen major's plan, or 0 when out of plan. */
  semester: number;
}

export default function CourseCombobox({
  courses,
  value,
  onChange,
  emptyLabel = '— import a catalog first —',
  label,
}: CourseComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [major, setMajor] = useState<string>('all');
  const containerRef = useClickOutside<HTMLDivElement>(open, () => setOpen(false));
  const inputRef = useAutoFocusOnOpen<HTMLInputElement>(open);

  // Discover the catalog's majors[] (assumed identical on every row).
  // When no row has a majors[] column we hide the major filter.
  const catalogMajors = useMemo(
    () => (courses.length > 0 ? catalogMajorsFor(courses[0]) : undefined),
    [courses]
  );

  // Distinct majors present in the catalog, sorted alphabetically.
  // Empty when the catalog has no majors[] column.
  const majorOptions = useMemo(() => {
    if (!catalogMajors || catalogMajors.length === 0) return [];
    return [...catalogMajors].sort((a, b) => a.localeCompare(b));
  }, [catalogMajors]);

  // Resolve the picked major's index so we can read each course's
  // semester under that major. Falls back to 0 when "all" is picked
  // (we don't filter by semester then).
  const majorIdx = useMemo(() => {
    if (major === 'all' || !catalogMajors) return -1;
    return resolveMajorIndex(major, catalogMajors).index;
  }, [major, catalogMajors]);

  // Build the option list. We always normalize codes so the picker
  // and the rest of the app agree on "MEC011" vs "MEC 11" vs "MEC-011".
  const options: Option[] = useMemo(() => {
    return courses
      .map((c) => {
        const code = normalizeCourseCodeLoose(c.code);
        const sem =
          majorIdx >= 0 ? semesterForMajor(c, majorIdx, catalogMajors) : 0;
        return { code, title: c.title || '', semester: sem };
      })
      .filter((o) => o.code);
  }, [courses, majorIdx, catalogMajors]);

  // Apply the major + text filter. "all" major means every course.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.filter((o) => {
      if (majorIdx >= 0 && o.semester === 0) return false;
      if (!q) return true;
      return (
        o.code.toLowerCase().includes(q) ||
        o.title.toLowerCase().includes(q)
      );
    });
  }, [options, query, majorIdx]);

  // When the picked value changes outside, close the menu (so the
  // user sees the chip refresh on the trigger).
  useEffect(() => {
    setOpen(false);
  }, [value]);

  const picked = options.find((o) => o.code === value);
  const triggerLabel = picked
    ? `${picked.code} — ${picked.title || '(no title)'}`
    : courses.length === 0
      ? emptyLabel
      : '— select a course —';

  return (
    <div ref={containerRef} className="space-y-1">
      {label && (
        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          {label}
        </label>
      )}

      {/* Trigger row — looks like a select but is a button. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between gap-2 bg-slate-950 border rounded-lg px-2 py-2 text-xs text-left outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer ${
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
          <ChevronDown className={`w-3.5 h-3.5 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {open && (
        <div className="relative">
          <div className="absolute z-30 left-0 right-0 mt-1 bg-slate-950 border border-white/10 rounded-lg shadow-xl shadow-black/40 max-h-72 flex flex-col">
            {/* Search box */}
            <div className="relative border-b border-white/10">
              <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-500" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search code or title..."
                className="w-full bg-transparent py-2 pl-9 pr-3 text-xs text-white outline-none placeholder:text-slate-500"
              />
            </div>

            {/* Major filter — only when the catalog has majors[] */}
            {majorOptions.length > 0 && (
              <div className="border-b border-white/10 px-2 py-2 flex items-center gap-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider shrink-0">
                  Major
                </span>
                <select
                  value={major}
                  onChange={(e) => setMajor(e.target.value)}
                  className="flex-1 bg-slate-900 border border-white/10 rounded px-2 py-1 text-[11px] text-white outline-none focus:ring-1 focus:ring-blue-500"
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
              {courses.length === 0 && (
                <li className="px-3 py-3 text-[11px] text-slate-500">
                  No catalog imported.
                </li>
              )}
              {courses.length > 0 && filtered.length === 0 && (
                <li className="px-3 py-3 text-[11px] text-slate-500">
                  No courses match your filters.
                </li>
              )}
              {filtered.map((o) => {
                const active = o.code === value;
                return (
                  <li key={o.code}>
                    <button
                      type="button"
                      onClick={() => onChange(o.code)}
                      className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-[11px] cursor-pointer ${
                        active
                          ? 'bg-blue-500/15 text-blue-100'
                          : 'text-slate-200 hover:bg-white/5'
                      }`}
                    >
                      <span className="flex items-center gap-2 truncate">
                        <span className="font-mono font-bold">{o.code}</span>
                        <span className="text-slate-400 truncate">— {o.title || '(no title)'}</span>
                      </span>
                      {majorIdx >= 0 && o.semester > 0 && (
                        <span className="text-[9px] font-mono text-slate-500 shrink-0">
                          sem {o.semester}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* Footer hint */}
            <div className="border-t border-white/10 px-3 py-1.5 text-[10px] text-slate-500 flex items-center justify-between">
              <span>{filtered.length} of {options.length} courses</span>
              <span>{picked ? `Selected: ${picked.code}` : 'Nothing selected'}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}