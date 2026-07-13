import { useMemo, useState } from 'react';
import {
  CheckCircle,
  Clock,
  HelpCircle,
  XCircle,
  SkipForward,
  Database,
} from 'lucide-react';
import { useData } from '../data/DataContext';
import type { SisSyncChangeRecord, SisSyncChangeKind } from '../data/syncSis';

const CATEGORY_LABELS: Record<SisSyncChangeKind, { label: string; icon: typeof CheckCircle; color: string }> = {
  'time-changed':    { label: 'Time Changed',  icon: Clock,        color: 'text-amber-300 bg-amber-500/10 border-amber-500/30' },
  'ambiguous':       { label: 'Needs Review',  icon: HelpCircle,   color: 'text-orange-300 bg-orange-500/10 border-orange-500/30' },
  'matched-exact':   { label: 'Confirmed',     icon: CheckCircle,  color: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' },
  'matched-online':  { label: 'Online (#)',    icon: CheckCircle,  color: 'text-sky-300 bg-sky-500/10 border-sky-500/30' },
  'unmatched':       { label: 'Not Found',     icon: XCircle,      color: 'text-rose-300 bg-rose-500/10 border-rose-500/30' },
  'skipped-outdated':{ label: 'Skipped',       icon: SkipForward,  color: 'text-slate-400 bg-slate-500/10 border-slate-500/30' },
};

export default function SisSyncReviewPage({ onBack }: { onBack: () => void }) {
  const { sisSyncResult, clearSisSyncResult } = useData();
  const [activeSection, setActiveSection] = useState<SisSyncChangeKind | 'all'>('all');

  const grouped = useMemo(() => {
    if (!sisSyncResult) return {};
    const map: Partial<Record<SisSyncChangeKind, SisSyncChangeRecord[]>> = {};
    for (const c of sisSyncResult.changes) {
      if (!map[c.kind]) map[c.kind] = [];
      map[c.kind]!.push(c);
    }
    return map;
  }, [sisSyncResult]);

  if (!sisSyncResult) {
    return (
      <main className="flex-1 flex flex-col min-h-0 bg-slate-950">
        <header className="px-6 py-4 border-b border-white/10 flex items-center gap-3 bg-slate-950/80 backdrop-blur-md">
          <button onClick={onBack} className="text-slate-300 hover:text-white px-2 py-1 rounded-lg hover:bg-white/5">
            ← Back
          </button>
          <h1 className="text-lg font-extrabold tracking-tight">SIS Sync Review</h1>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8">
          <Database className="w-16 h-16 mb-4 opacity-30" />
          <p className="text-lg font-bold mb-2">No sync data</p>
          <p className="text-sm">Run a SIS sync from the Schedule Manager first.</p>
        </div>
      </main>
    );
  }

  const totalChanges = sisSyncResult.changes.length;
  const needsAttention = (grouped['time-changed']?.length ?? 0) + (grouped['ambiguous']?.length ?? 0);

  const handleBack = () => {
    onBack();
  };

  const sections: { key: SisSyncChangeKind; count: number }[] = [
    { key: 'time-changed', count: grouped['time-changed']?.length ?? 0 },
    { key: 'ambiguous', count: grouped['ambiguous']?.length ?? 0 },
    { key: 'matched-exact', count: grouped['matched-exact']?.length ?? 0 },
    { key: 'matched-online', count: grouped['matched-online']?.length ?? 0 },
    { key: 'unmatched', count: grouped['unmatched']?.length ?? 0 },
    { key: 'skipped-outdated', count: grouped['skipped-outdated']?.length ?? 0 },
  ];

  const activeChanges = activeSection === 'all'
    ? sisSyncResult.changes
    : grouped[activeSection] ?? [];

  return (
    <main className="flex-1 flex flex-col min-h-0 bg-slate-950">
      {/* Header */}
      <header className="px-6 py-4 border-b border-white/10 flex items-center gap-3 bg-slate-950/80 backdrop-blur-md">
        <button onClick={handleBack} className="text-slate-300 hover:text-white px-2 py-1 rounded-lg hover:bg-white/5">
          ← Back
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-extrabold tracking-tight flex items-center gap-2">
            <Database className="w-5 h-5 text-amber-400" />
            SIS Sync Review
          </h1>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">
            {totalChanges} session(s) processed
            {needsAttention > 0 && ` · ${needsAttention} need(s) attention`}
          </p>
        </div>
        <button
          onClick={clearSisSyncResult}
          className="text-[10px] uppercase tracking-wider font-bold text-slate-500 hover:text-slate-300 bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg"
        >
          Clear
        </button>
      </header>

      {/* Summary Cards */}
      <div className="grid grid-cols-6 gap-3 p-4 border-b border-white/10">
        {sections.map(({ key, count }) => {
          const meta = CATEGORY_LABELS[key];
          const Icon = meta.icon;
          return (
            <button
              key={key}
              onClick={() => setActiveSection(activeSection === key ? 'all' : key)}
              className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border cursor-pointer transition-all ${
                activeSection === key
                  ? `${meta.color} ring-1 ring-white/20`
                  : 'bg-white/5 border-white/10 hover:bg-white/10 text-slate-300'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-lg font-extrabold">{count}</span>
              <span className="text-[9px] uppercase tracking-wider font-bold text-center leading-tight">{meta.label}</span>
            </button>
          );
        })}
      </div>

      {/* Changes Table */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        {activeChanges.length === 0 ? (
          <div className="flex items-center justify-center h-full text-slate-500 text-sm">
            No items in this category.
          </div>
        ) : (
          <table className="w-full text-sm text-slate-200">
            <thead className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur-sm border-b border-white/10">
              <tr>
                <Th>Status</Th>
                <Th>Course</Th>
                <Th>Type</Th>
                <Th>Section</Th>
                <Th>SIS #</Th>
                <Th>Day</Th>
                <Th>Time</Th>
                <Th>Room</Th>
                <Th className="w-1/3">Description</Th>
              </tr>
            </thead>
            <tbody>
              {activeChanges.map((change, i) => {
                const meta = CATEGORY_LABELS[change.kind];
                const Icon = meta.icon;
                const isTimeChange = change.kind === 'time-changed';
                return (
                  <tr key={`${change.sessionId}-${i}`} className="border-b border-white/5 hover:bg-white/5 align-top">
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${meta.color}`}>
                        <Icon className="w-3 h-3" />
                        {meta.label}
                      </span>
                    </td>
                    <Td className="font-mono text-xs font-bold">{change.courseCode}</Td>
                    <Td className="uppercase text-[10px] font-bold">{change.sessionType}</Td>
                    <Td className="font-mono text-[11px]">{change.sisSectionCode || '—'}</Td>
                    <Td className="font-mono text-[11px]">
                      {change.newSisClassNumber ? (
                        <span>
                          {change.oldSisClassNumber && change.oldSisClassNumber !== change.newSisClassNumber ? (
                            <span className="text-rose-400 line-through mr-1">{change.oldSisClassNumber}</span>
                          ) : null}
                          <span className="text-emerald-300">{change.newSisClassNumber}</span>
                        </span>
                      ) : (
                        <span className="text-slate-500">{change.oldSisClassNumber || '—'}</span>
                      )}
                    </Td>
                    <td className="px-3 py-2.5">
                      {isTimeChange && change.oldTime ? (
                        <div className="text-[11px]">
                          <span className="text-rose-400 line-through block">{change.oldTime.dayOfWeek}</span>
                          <span className="text-emerald-300">{change.newTime?.dayOfWeek}</span>
                        </div>
                      ) : (
                        <span className="text-xs">{change.newTime?.dayOfWeek || change.oldTime?.dayOfWeek || '—'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {isTimeChange && change.oldTime ? (
                        <div className="font-mono text-[11px]">
                          <span className="text-rose-400 line-through block">{change.oldTime.startTime}-{change.oldTime.endTime}</span>
                          <span className="text-emerald-300">{change.newTime?.startTime}-{change.newTime?.endTime}</span>
                        </div>
                      ) : (
                        <span className="font-mono text-xs">
                          {change.newTime
                            ? `${change.newTime.startTime}-${change.newTime.endTime}`
                            : change.oldTime
                              ? `${change.oldTime.startTime}-${change.oldTime.endTime}`
                              : '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {change.newRoom && change.oldTime ? (
                        <span className="text-emerald-300 text-[11px]">{change.newRoom}</span>
                      ) : (
                        <span className="text-xs">{change.newRoom || '—'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-400 leading-relaxed">{change.description}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-white/10 text-[10px] uppercase tracking-wider font-bold text-slate-500 flex items-center justify-between">
        <span>
          {activeChanges.length} of {totalChanges} session(s)
          {needsAttention > 0 && activeSection === 'all' && (
            <span className="ml-2 text-amber-400">⚠ {needsAttention} need(s) review</span>
          )}
        </span>
        <button onClick={handleBack} className="text-slate-400 hover:text-white">
          ← Back to Schedule Manager
        </button>
      </div>
    </main>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider text-slate-400 ${className}`}>{children}</th>;
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 ${className}`}>{children}</td>;
}
