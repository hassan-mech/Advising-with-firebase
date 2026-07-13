/**
 * TermManagerModal — modal CRUD for registration terms.
 *
 * Lists every Term with name, entry count, and active-term radio.
 * Per-row Rename / Duplicate / Delete. Sticky footer creates a new
 * term on demand and switches to it immediately.
 *
 * No data lives here — all reads and writes go through `useData()`,
 * so the modal stays in sync with the PlanPanel + term picker in
 * the prereq-map header.
 */

import { useMemo, useState } from 'react';
import {
  CalendarRange,
  CheckCircle2,
  Circle,
  Copy,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useData } from '../data/DataContext';
import Modal from './shared/Modal';

export default function TermManagerModal({ onClose }: { onClose: () => void }) {
  const {
    state,
    createTerm,
    renameTerm,
    duplicateTerm,
    deleteTerm,
    setActiveTerm,
  } = useData();

  const sortedTerms = useMemo(
    () =>
      [...state.terms].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt)
      ),
    [state.terms]
  );

  const [draftName, setDraftName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const totalCoursesPlanned = state.terms.reduce(
    (n, t) => n + t.entries.reduce((m, e) => m + e.courseCodes.length, 0),
    0
  );

  return (
    <Modal
      open={true}
      onClose={onClose}
      footer={
        <div className="flex items-center gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!draftName.trim()) return;
              createTerm(draftName);
              setDraftName('');
            }}
            className="flex-1 flex items-center gap-2"
          >
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="New term name (e.g. Fall 2025)"
              className="flex-1 bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-fuchsia-500"
            />
            <button
              type="submit"
              disabled={!draftName.trim()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-fuchsia-500/20 border border-fuchsia-500/40 text-xs font-bold uppercase tracking-wider text-fuchsia-100 hover:bg-fuchsia-500/30 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Create
            </button>
          </form>
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-lg border border-white/10 text-xs font-bold uppercase tracking-wider text-slate-300 hover:bg-white/5 cursor-pointer"
          >
            Close
          </button>
        </div>
      }
    >
      <header className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarRange className="w-5 h-5 text-fuchsia-400" />
          <div>
            <h2 className="text-base font-extrabold tracking-tight">
              Manage registration terms
            </h2>
            <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
              {state.terms.length} term(s) · {totalCoursesPlanned} planned course(s)
            </p>
          </div>
        </div>
      </header>

      <div className="p-5">
        {sortedTerms.length === 0 ? (
          <div className="text-xs text-slate-500 text-center py-12 border border-dashed border-white/10 rounded-xl">
            No terms yet. Create one below.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {sortedTerms.map((t) => {
              const isActive = state.activeTermId === t.id;
              const isEditing = editingId === t.id;
              const entryCount = t.entries.length;
              const courseCount = t.entries.reduce(
                (n, e) => n + e.courseCodes.length,
                0
              );
              return (
                <li
                  key={t.id}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
                    isActive
                      ? 'border-fuchsia-500/50 bg-fuchsia-500/5'
                      : 'border-white/10 bg-white/5'
                  }`}
                >
                  <button
                    onClick={() => setActiveTerm(t.id)}
                    title={isActive ? 'Active term' : 'Switch to this term'}
                    className="shrink-0 text-fuchsia-300 hover:text-fuchsia-100 cursor-pointer"
                  >
                    {isActive ? (
                      <CheckCircle2 className="w-5 h-5" />
                    ) : (
                      <Circle className="w-5 h-5" />
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <input
                        autoFocus
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={() => {
                          if (editingName.trim()) {
                            renameTerm(t.id, editingName);
                          }
                          setEditingId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            if (editingName.trim()) {
                              renameTerm(t.id, editingName);
                            }
                            setEditingId(null);
                          }
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        className="w-full bg-slate-950 border border-white/10 rounded-md px-2 py-1 text-sm text-white outline-none focus:ring-1 focus:ring-fuchsia-500"
                      />
                    ) : (
                      <div
                        className="text-sm font-bold text-white truncate cursor-text"
                        onDoubleClick={() => {
                          setEditingId(t.id);
                          setEditingName(t.name);
                        }}
                        title="Double-click to rename"
                      >
                        {t.name}
                      </div>
                    )}
                    <div className="text-[10px] text-slate-500">
                      {entryCount} student(s) · {courseCount} course(s)
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => {
                        setEditingId(t.id);
                        setEditingName(t.name);
                      }}
                      title="Rename"
                      className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300 cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        const name = window.prompt(
                          'Duplicate as:',
                          `${t.name} (copy)`
                        );
                        if (name !== null) duplicateTerm(t.id, name);
                      }}
                      title="Duplicate"
                      className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300 cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete "${t.name}"? All course lists in this term are removed (other terms are unaffected).`
                          )
                        ) {
                          deleteTerm(t.id);
                        }
                      }}
                      title="Delete"
                      className="p-1.5 rounded-lg hover:bg-rose-500/10 text-rose-300 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
