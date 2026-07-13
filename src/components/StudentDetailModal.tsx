/**
 * StudentDetailModal — v2.
 *
 * Clicked from a roster row. Shows the metric summary card on top and
 * the full course history table below. No prereq map, no term board
 * (those are v2).
 */

import { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, BookOpen, GraduationCap } from 'lucide-react';
import { useData } from '../data/DataContext';
import { rowsForStudent, compareTerms, isFailingGrade } from '../data/metrics';
import type { GradeRow } from '../data/types';
import Modal from './shared/Modal';
import { StatsRow } from './shared/StatsCard';
import { gpaToken, type ColorToken } from './shared/colorTokens';

interface StudentDetailModalProps {
  studentId: string | null;
  onClose: () => void;
}

export default function StudentDetailModal({ studentId, onClose }: StudentDetailModalProps) {
  const { state, metricsByStudent } = useData();
  const metrics = studentId ? metricsByStudent[studentId] : undefined;
  const rows = useMemo(
    () => (studentId ? rowsForStudent(state.rows, studentId) : []),
    [state.rows, studentId]
  );

  if (!studentId || !metrics) {
    return <Modal open={false} onClose={onClose}>{null}</Modal>;
  }

  const sortedRows = [...rows].sort((a, b) => compareTerms(b.term, a.term));

  return (
    <Modal open={true} onClose={onClose} maxWidth="max-w-3xl">
      <div className="p-5 border-b border-white/10 flex items-start justify-between bg-white/5">
        <div className="min-w-0 pr-12">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-mono text-xs bg-blue-500/20 text-blue-300 px-2 py-1 rounded border border-blue-500/20">
              {metrics.studentId}
            </span>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              {metrics.major}
            </span>
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-blue-300 bg-blue-500/15 px-2 py-1 rounded border border-blue-500/20">
              {metrics.level}
            </span>
          </div>
          <h2 className="text-xl font-extrabold mt-2 flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-blue-400" />
            {metrics.name}
          </h2>
          {/* Email + national ID surface — only when the roster
              actually carries them. Missing values are silently
              omitted (em-dash would be misleading here). */}
          {(metrics.email || metrics.nationalId) && (
            <div className="mt-1.5 flex items-center gap-3 flex-wrap text-[11px] text-slate-300 font-mono">
              {metrics.email && (
                <span title="Email">
                  <span className="text-slate-500 not-italic mr-1">email:</span>
                  {metrics.email}
                </span>
              )}
              {metrics.nationalId && (
                <span title="National ID">
                  <span className="text-slate-500 not-italic mr-1">national id:</span>
                  {metrics.nationalId}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-3 border-b border-white/10">
        <Stat label="Cum. GPA" value={metrics.gpa.toFixed(2)} accent={gpaToken(metrics.gpa)} hint="Latest term only" valueSize="lg" />
        <Stat label="Units" value={String(metrics.totalUnits)} valueSize="lg" />
        <Stat
          label="Failed"
          value={String(metrics.failedCourseCodes.length)}
          accent={metrics.failedCourseCodes.length > 0 ? 'rose' : 'emerald'}
          valueSize="lg"
        />
        <Stat
          label="Missing Prereqs"
          value={String(metrics.missingPrereqsForNextTerm.length)}
          accent={metrics.missingPrereqsForNextTerm.length > 0 ? 'amber' : 'emerald'}
          valueSize="lg"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
          <BookOpen className="w-4 h-4" />
          Course History ({rows.length} attempts)
        </h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-white/10">
              <th className="text-left px-2 py-2">Course</th>
              <th className="text-left px-2 py-2">Term</th>
              <th className="text-right px-2 py-2">Units</th>
              <th className="text-right px-2 py-2">Grade</th>
              <th className="text-right px-2 py-2">Cum. GPA</th>
              <th className="text-right px-2 py-2">State</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((r, idx) => (
              <HistoryRow key={`${r.term}-${r.course}-${idx}`} row={r} />
            ))}
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-2 py-8 text-center text-slate-500 text-xs">
                  No attempts found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/** Local wrapper around StatsRow that adds the bordered card shell
 *  used by the metric grid. StatsCard's default `bordered` style is
 *  the right fit but pulls in a header — we don't want one here. */
function Stat({
  label,
  value,
  accent,
  hint,
  valueSize = 'md',
}: {
  label: string;
  value: string;
  accent?: ColorToken;
  hint?: string;
  valueSize?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  return (
    <div className="bg-white/5 rounded-xl p-3 border border-white/5">
      <StatsRow label={label} value={value} accent={accent} hint={hint} valueSize={valueSize} />
    </div>
  );
}

function HistoryRow({ row }: { row: GradeRow }) {
  const failing = isFailingGrade(row.grade);
  // Show the cumulative GPA when the cell is a real number (0 counts
  // as a real value — 0.0 GPA from all-F terms is a valid display).
  // `undefined` cells (the user left the column blank) render as a
  // dash so the column aligns.
  const cumGpa =
    typeof row.cumulativeGpa === 'number' && Number.isFinite(row.cumulativeGpa)
      ? row.cumulativeGpa.toFixed(2)
      : '—';
  return (
    <tr className="border-b border-white/5">
      <td className="px-2 py-2 font-mono text-xs">{row.course}</td>
      <td className="px-2 py-2 text-slate-400 text-xs">{row.term}</td>
      <td className="px-2 py-2 text-right text-slate-300">{row.units}</td>
      <td className="px-2 py-2 text-right">
        <span
          className={`font-mono font-bold ${
            failing ? 'text-rose-300' : 'text-emerald-300'
          }`}
        >
          {row.grade}
        </span>
      </td>
      <td className="px-2 py-2 text-right font-mono text-xs text-slate-200">
        {cumGpa}
      </td>
      <td className="px-2 py-2 text-right">
        {failing ? (
          <span className="inline-flex items-center gap-1 text-rose-300 text-xs font-bold">
            <AlertTriangle className="w-3 h-3" /> Failed
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-emerald-300 text-xs font-bold">
            <CheckCircle2 className="w-3 h-3" /> Passed
          </span>
        )}
      </td>
    </tr>
  );
}
