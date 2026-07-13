/**
 * EmptyState — v2.
 *
 * Shown when no grade-book is imported yet. Has two dropzones (grade-
 * book + catalog) and a dev-only "Load demo data" button that
 * synthesises a small dataset so the UI can be exercised without the
 * user's real Excel.
 */

import { useRef } from 'react';
import { GraduationCap, FileSpreadsheet, Sparkles, Users } from 'lucide-react';
import { useData } from '../data/DataContext';
import { buildDemoCatalog, buildDemoRows } from './demoData';

export default function EmptyState() {
  const {
    importGradeBook,
    importCatalog,
    importRoster,
    loadDemoRows,
    loadDemoCatalog,
    state,
    lastError,
  } = useData();
  const gradeInput = useRef<HTMLInputElement>(null);
  const catalogInput = useRef<HTMLInputElement>(null);
  const rosterInput = useRef<HTMLInputElement>(null);

  // Load both demo rows AND the demo catalog so the prereq-map has
  // something to render immediately (without this, the user clicks
  // "Generate demo rows" then "Prereq Map" and sees an empty grid).
  const handleLoadDemo = () => {
    loadDemoRows(buildDemoRows());
    loadDemoCatalog(buildDemoCatalog());
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-12 text-slate-100">
      <div className="max-w-2xl w-full text-center space-y-8">
        <div>
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-500/15 ring-1 ring-blue-500/30 mb-4">
            <GraduationCap className="w-8 h-8 text-blue-400" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight">Academic Advisor</h1>
          <p className="text-sm text-slate-400 mt-3 leading-relaxed">
            Import a grade-book Excel to see every student's course history and run
            advising queries against it. The data stays in your browser via localStorage.
          </p>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
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
          <button
            onClick={() => gradeInput.current?.click()}
            className="group bg-white/5 hover:bg-blue-500/10 border border-white/10 hover:border-blue-500/40 rounded-2xl p-6 text-left transition-all cursor-pointer"
          >
            <div className="flex items-center gap-2 mb-2">
              <GraduationCap className="w-5 h-5 text-blue-400" />
              <h2 className="font-bold text-white">Grade-book</h2>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Excel with <code className="text-blue-300">student_id</code>,{' '}
              <code className="text-blue-300">course</code>,{' '}
              <code className="text-blue-300">units</code>,{' '}
              <code className="text-blue-300">grade</code>,{' '}
              <code className="text-blue-300">term</code>,{' '}
              <code className="text-blue-300">cumulative_gpa</code> columns.
            </p>
          </button>

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
          <button
            onClick={() => rosterInput.current?.click()}
            className="group bg-white/5 hover:bg-emerald-500/10 border border-white/10 hover:border-emerald-500/40 rounded-2xl p-6 text-left transition-all cursor-pointer"
          >
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-5 h-5 text-emerald-400" />
              <h2 className="font-bold text-white">Roster</h2>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Excel with <code className="text-emerald-300">student_id</code>,{' '}
              <code className="text-emerald-300">student_name</code>,{' '}
              <code className="text-emerald-300">major</code>. Avoids re-typing
              names onto every grade-book row.
            </p>
          </button>

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
          <button
            onClick={() => catalogInput.current?.click()}
            className="group bg-white/5 hover:bg-indigo-500/10 border border-white/10 hover:border-indigo-500/40 rounded-2xl p-6 text-left transition-all cursor-pointer"
          >
            <div className="flex items-center gap-2 mb-2">
              <FileSpreadsheet className="w-5 h-5 text-indigo-400" />
              <h2 className="font-bold text-white">Course Catalog</h2>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Excel with <code className="text-indigo-300">code</code>,{' '}
              <code className="text-indigo-300">title</code>,{' '}
              <code className="text-indigo-300">credits</code>,{' '}
              <code className="text-indigo-300">prerequisites</code>. Prereqs may be
              <code className="text-indigo-300">MAT101;PHY101</code> or comma-separated.
            </p>
          </button>
        </div>

        {import.meta.env.DEV && (
          <button
            onClick={handleLoadDemo}
            className="inline-flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer"
            title="Load demo grade-book rows AND a tiny course catalog so the prereq map has courses to display"
          >
            <Sparkles className="w-4 h-4" />
            <span>Generate demo rows</span>
          </button>
        )}

        {state.rows.length === 0 && state.catalog && (
          <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
            Catalog loaded ({state.catalog.courses.length} courses). Import a
            grade-book to see students.
          </p>
        )}
        {lastError && (
          <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
            {lastError}
          </p>
        )}
      </div>
    </div>
  );
}