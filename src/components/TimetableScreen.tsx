/**
 * TimetableScreen — Time-proportional weekly timetable.
 *
 * Three view modes:
 *   • Student    — planned courses for a specific student (smart scheduling)
 *   • Room       — all sessions in a given room
 *   • Instructor — all sessions for a given instructor
 *
 * The vertical axis is based on PERIODS (P1, P2 …). Default: 8 periods
 * of 50 min starting at 09:00 (ends 12:40 PM). All settings are
 * configurable live via the "Periods" panel. Times are shown in 12-hour
 * AM/PM format. Session blocks are placed at exact clock positions so
 * they align perfectly with the period grid.
 */

import React, { useMemo, useState, useEffect } from 'react';
import {
  ArrowLeft, Clock, User, DoorOpen, Users, Calendar, BookOpen,
  Search, X, Settings, ChevronLeft, ChevronRight, AlertTriangle
} from 'lucide-react';
import { useData } from '../data/DataContext';
import { getAllCombinationsForCourse, findValidAssignment } from '../data/scheduleUtils';
import { normalizeCourseCodeLoose } from '../data/normalize';
import { doTimeSlotsOverlap } from '../data/types';
import type { ClassSession, ProgramGroup, StudentMetrics } from '../data/types';
import StudentCombobox from './StudentCombobox';

// ─────────────────────────────────────────────────────────────────────────────
// Constants & helpers
// ─────────────────────────────────────────────────────────────────────────────

const DAYS: ClassSession['time']['dayOfWeek'][] = [
  'Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
];
const DAY_SHORT: Record<string, string> = {
  Saturday: 'Sat', Sunday: 'Sun', Monday: 'Mon',
  Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri',
};

function timeToMins(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function minsToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "14:50" → "2:50 PM" */
function fmt12(t: string): string {
  const [hStr, mStr = '00'] = t.split(':');
  const h = parseInt(hStr, 10);
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 || 12;
  return `${h12}:${mStr} ${ampm}`;
}

const PALETTE = [
  { bg: 'bg-violet-500/20',  border: 'border-violet-400/50',  text: 'text-violet-100',  dot: 'bg-violet-400'  },
  { bg: 'bg-cyan-500/20',    border: 'border-cyan-400/50',    text: 'text-cyan-100',    dot: 'bg-cyan-400'    },
  { bg: 'bg-amber-500/20',   border: 'border-amber-400/50',   text: 'text-amber-100',   dot: 'bg-amber-400'   },
  { bg: 'bg-emerald-500/20', border: 'border-emerald-400/50', text: 'text-emerald-100', dot: 'bg-emerald-400' },
  { bg: 'bg-rose-500/20',    border: 'border-rose-400/50',    text: 'text-rose-100',    dot: 'bg-rose-400'    },
  { bg: 'bg-fuchsia-500/20', border: 'border-fuchsia-400/50', text: 'text-fuchsia-100', dot: 'bg-fuchsia-400' },
  { bg: 'bg-sky-500/20',     border: 'border-sky-400/50',     text: 'text-sky-100',     dot: 'bg-sky-400'     },
  { bg: 'bg-orange-500/20',  border: 'border-orange-400/50',  text: 'text-orange-100',  dot: 'bg-orange-400'  },
] as const;
type PaletteEntry = typeof PALETTE[number];

function getPalette(code: string, map: Map<string, number>): PaletteEntry {
  if (!map.has(code)) map.set(code, map.size % PALETTE.length);
  return PALETTE[map.get(code)!];
}

type ViewMode = 'student' | 'room' | 'instructor' | 'group';

const TYPE_COLORS: Record<string, string> = {
  LEC: 'bg-blue-500/30 text-blue-200 border border-blue-400/30',
  LAB: 'bg-emerald-500/30 text-emerald-200 border border-emerald-400/30',
  TUT: 'bg-amber-500/30 text-amber-200 border border-amber-400/30',
};

// ─────────────────────────────────────────────────────────────────────────────
// Group contradiction detection
// ─────────────────────────────────────────────────────────────────────────────

/** Two sessions targeting the same group that overlap in time — a group
 *  can't physically attend both, so this is a scheduling contradiction. */
interface GroupConflict {
  groupId: string;
  groupName: string;
  a: ClassSession;
  b: ClassSession;
}

/** Scans every group's sessions (already filtered to one term) for
 *  pairwise time overlaps. O(sessions²) per group, which is fine at
 *  timetable scale (dozens–hundreds of sessions). */
function findGroupConflicts(sessions: ClassSession[], groups: ProgramGroup[]): GroupConflict[] {
  const conflicts: GroupConflict[] = [];
  for (const group of groups) {
    const groupSessions = sessions.filter(s => s.targetGroups.includes(group.id));
    for (let i = 0; i < groupSessions.length; i++) {
      for (let j = i + 1; j < groupSessions.length; j++) {
        const a = groupSessions[i];
        const b = groupSessions[j];
        if (a.id === b.id) continue;
        if (doTimeSlotsOverlap(a.time, b.time)) {
          conflicts.push({ groupId: group.id, groupName: group.name || group.id, a, b });
        }
      }
    }
  }
  return conflicts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session block
// ─────────────────────────────────────────────────────────────────────────────

function SessionBlock({
  session, palette, compact, gridStartMins, gridTotalMins, hasConflict,
}: {
  session: ClassSession;
  palette: PaletteEntry;
  compact: boolean;
  gridStartMins: number;
  gridTotalMins: number;
  hasConflict?: boolean;
}) {
  const startMins = timeToMins(session.time.startTime);
  const endMins   = timeToMins(session.time.endTime);
  const duration  = endMins - startMins;

  const topPct    = ((startMins - gridStartMins) / gridTotalMins) * 100;
  const heightPct = (duration / gridTotalMins) * 100;

  return (
    <div
      className={`
        absolute inset-x-0.5 rounded-lg border overflow-hidden flex flex-col
        select-none cursor-default transition-all duration-150 group
        hover:brightness-125 hover:z-20 hover:shadow-xl hover:shadow-black/50
        ${palette.bg} ${palette.border}
        ${hasConflict ? 'ring-2 ring-red-500 ring-offset-1 ring-offset-slate-950' : ''}
      `}
      style={{ top: `${topPct}%`, height: `${Math.max(heightPct, 0.3)}%`, minHeight: '4px', zIndex: 10 }}
      title={[
        `${session.courseCode} — ${session.courseName}`,
        `${session.sessionType}  ·  ${fmt12(session.time.startTime)} – ${fmt12(session.time.endTime)}`,
        session.instructorName && `Instructor: ${session.instructorName}`,
        session.roomCode       && `Room: ${session.roomCode}`,
        session.targetGroups.length > 0 && `Groups: ${session.targetGroups.join(', ')}`,
        hasConflict && '⚠ Conflicts with another session for this group',
      ].filter(Boolean).join('\n')}
    >
      {hasConflict && (
        <div className="absolute top-0.5 right-0.5 z-20 bg-red-500 rounded-full p-0.5 shadow">
          <AlertTriangle className="w-2.5 h-2.5 text-white" />
        </div>
      )}
      {/* Left accent stripe */}
      <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${palette.dot} opacity-90`} />

      <div className="pl-[7px] pr-1.5 pt-1 pb-1.5 flex flex-col gap-0.5 overflow-hidden h-full">
        {/* Code + type badge */}
        <div className="flex items-center gap-1 min-w-0">
          <span className={`text-[10px] font-extrabold tracking-wide ${palette.text} truncate flex-1 leading-tight`}>
            {session.courseCode}
          </span>
          {duration >= 20 && (
            <span className={`text-[7px] font-bold uppercase px-1 py-0.5 rounded shrink-0 ${TYPE_COLORS[session.sessionType] ?? 'bg-white/10 text-white'}`}>
              {session.sessionType}
            </span>
          )}
        </div>

        {/* Time */}
        {duration >= 28 && (
          <div className={`text-[9px] font-mono ${palette.text} opacity-70 truncate leading-tight`}>
            {fmt12(session.time.startTime)}–{fmt12(session.time.endTime)}
          </div>
        )}

        {/* Course name */}
        {duration >= 55 && (
          <div className={`text-[9px] ${palette.text} opacity-55 truncate leading-tight`}>
            {session.courseName}
          </div>
        )}

        {/* Room & instructor */}
        {duration >= 70 && (
          <div className="flex flex-col gap-0.5 mt-auto pt-0.5">
            {session.roomCode && (
              <div className={`flex items-center gap-1 text-[9px] ${palette.text} opacity-60 truncate`}>
                <DoorOpen className="w-2.5 h-2.5 shrink-0 opacity-80" />
                <span className="truncate leading-tight">{session.roomCode}</span>
              </div>
            )}
            {session.instructorName && !compact && (
              <div className={`flex items-center gap-1 text-[9px] ${palette.text} opacity-60 truncate`}>
                <User className="w-2.5 h-2.5 shrink-0 opacity-80" />
                <span className="truncate leading-tight">{session.instructorName}</span>
              </div>
            )}
            {session.targetGroups.length > 0 && !compact && (
              <div className={`flex items-center gap-1 text-[9px] ${palette.text} opacity-50 truncate`}>
                <Users className="w-2.5 h-2.5 shrink-0 opacity-80" />
                <span className="truncate leading-tight">{session.targetGroups.join(', ')}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function TimetableScreen({
  initialStudentId,
  onBack,
}: {
  initialStudentId: string;
  onBack: () => void;
}) {
  const [studentId, setStudentId] = useState(initialStudentId);
  const { state, metricsByStudent } = useData();
  const rawSchedule = state.masterSchedule;
  // Sessions superseded by a corrected SIS sync entry are kept in storage
  // for audit purposes but hidden from the visual grid — showing both the
  // stale and corrected block would just be confusing.
  const schedule = useMemo(() => {
    if (!rawSchedule) return rawSchedule;
    return { ...rawSchedule, sessions: rawSchedule.sessions.filter(s => !s.outdated) };
  }, [rawSchedule]);
  const studentName = metricsByStudent[studentId]?.name ?? studentId;

  // ── View mode & filters ───────────────────────────────────────────────────
  const [viewMode,           setViewMode]           = useState<ViewMode>('student');
  const [selectedGroup,      setSelectedGroup]      = useState('');
  const [selectedTerm,       setSelectedTerm]       = useState('');
  const [selectedRoom,       setSelectedRoom]       = useState('');
  const [selectedInstructor, setSelectedInstructor] = useState('');
  const [searchQuery,        setSearchQuery]        = useState('');

  // ── Period settings ───────────────────────────────────────────────────────
  const [showSettings,  setShowSettings]  = useState(false);
  const [periodStart,   setPeriodStart]   = useState('09:00');
  const [periodMinutes, setPeriodMinutes] = useState(50);
  const [numPeriods,    setNumPeriods]    = useState(8);

  // Init selected term from schedule data
  useEffect(() => {
    if (schedule && !selectedTerm) {
      const terms = [...new Set(schedule.sessions.map(s => s.term).filter(Boolean))];
      setSelectedTerm(terms[0] ?? '');
    }
  }, [schedule, selectedTerm]);

  // ── Dropdown options ──────────────────────────────────────────────────────
  const termOptions = useMemo(() =>
    schedule ? [...new Set(schedule.sessions.map(s => s.term).filter(Boolean))] : [],
  [schedule]);

  const roomOptions = useMemo(() =>
    schedule ? [...new Set(schedule.sessions.map(s => s.roomCode).filter(Boolean))].sort() : [],
  [schedule]);

  const instructorOptions = useMemo(() =>
    schedule ? [...new Set(schedule.sessions.map(s => s.instructorName).filter(Boolean))].sort() : [],
  [schedule]);

  const groupOptions = useMemo(() => schedule?.groups ?? [], [schedule]);

  // ── Student sessions ──────────────────────────────────────────────────────
  const activeTerm   = state.terms.find(t => t.id === state.activeTermId);
  const entry        = activeTerm?.entries.find(e => e.studentId === studentId);
  const plannedCodes = entry?.courseCodes ?? [];

  const studentSessions = useMemo(() => {
    if (!schedule || !selectedTerm || plannedCodes.length === 0) return [];
    const coursesToAssign = plannedCodes.map(code => {
      const sessions = schedule.sessions.filter(
        s => normalizeCourseCodeLoose(s.courseCode) === normalizeCourseCodeLoose(code)
          && s.term === selectedTerm
      );
      const combos = getAllCombinationsForCourse(sessions, selectedGroup || undefined);
      return { code, combos };
    });
    const valid = coursesToAssign.filter(c => c.combos.length > 0);
    if (valid.length === 0) return [];
    const assignment = findValidAssignment(valid);
    return assignment
      ? assignment.flat()
      : plannedCodes.flatMap(code =>
          schedule.sessions.filter(
            s => normalizeCourseCodeLoose(s.courseCode) === normalizeCourseCodeLoose(code)
              && s.term === selectedTerm
          )
        );
  }, [schedule, selectedTerm, selectedGroup, plannedCodes]);

  // ── Master sessions (room / instructor / group) ───────────────────────────
  const masterSessions = useMemo(() => {
    if (!schedule) return [];
    return schedule.sessions.filter(s => {
      if (selectedTerm && s.term !== selectedTerm) return false;
      if (viewMode === 'room'       && s.roomCode       !== selectedRoom)       return false;
      if (viewMode === 'instructor' && s.instructorName !== selectedInstructor) return false;
      if (viewMode === 'group'      && selectedGroup && !s.targetGroups.includes(selectedGroup)) return false;
      if (searchQuery) {
        const q   = searchQuery.toLowerCase();
        const hay = [s.courseCode, s.courseName, s.roomCode, s.instructorName, ...s.targetGroups]
          .join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [schedule, viewMode, selectedTerm, selectedRoom, selectedInstructor, selectedGroup, searchQuery]);

  const displaySessions: ClassSession[] = viewMode === 'student' ? studentSessions : masterSessions;

  // ── Group contradiction scan (all groups, current term) ───────────────────
  // Runs regardless of which single group is selected, so the banner can
  // point out contradictions in groups the advisor hasn't picked yet.
  const termFilteredSessions = useMemo(() => {
    if (!schedule) return [];
    return selectedTerm ? schedule.sessions.filter(s => s.term === selectedTerm) : schedule.sessions;
  }, [schedule, selectedTerm]);

  const groupConflicts = useMemo(
    () => (schedule ? findGroupConflicts(termFilteredSessions, schedule.groups) : []),
    [schedule, termFilteredSessions]
  );

  const conflictsByGroup = useMemo(() => {
    const m = new Map<string, GroupConflict[]>();
    for (const c of groupConflicts) {
      const list = m.get(c.groupId) ?? [];
      list.push(c);
      m.set(c.groupId, list);
    }
    return m;
  }, [groupConflicts]);

  const conflictSessionIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of groupConflicts) { set.add(c.a.id); set.add(c.b.id); }
    return set;
  }, [groupConflicts]);

  // ── Color map ─────────────────────────────────────────────────────────────
  const colorMap = useMemo(() => {
    const m = new Map<string, number>();
    displaySessions.forEach(s => {
      if (!m.has(s.courseCode)) m.set(s.courseCode, m.size % PALETTE.length);
    });
    return m;
  }, [displaySessions]);

  // ── Period math ───────────────────────────────────────────────────────────
  const periodStartMins = timeToMins(periodStart);
  const periodEndMins   = periodStartMins + numPeriods * periodMinutes;

  const periods = useMemo(() =>
    Array.from({ length: numPeriods }, (_, i) => ({
      num:       i + 1,
      startMins: periodStartMins + i * periodMinutes,
      endMins:   periodStartMins + (i + 1) * periodMinutes,
    })),
  [periodStartMins, periodMinutes, numPeriods]);

  // ── Grid range: spans periods + any out-of-range sessions ─────────────────
  const gridStartMins = useMemo(() => {
    if (displaySessions.length === 0) return periodStartMins;
    const sessMin = Math.min(...displaySessions.map(s => timeToMins(s.time.startTime)));
    return Math.min(periodStartMins, sessMin);
  }, [displaySessions, periodStartMins]);

  const gridEndMins = useMemo(() => {
    if (displaySessions.length === 0) return periodEndMins;
    const sessMax = Math.max(...displaySessions.map(s => timeToMins(s.time.endTime)));
    return Math.max(periodEndMins, sessMax);
  }, [displaySessions, periodEndMins]);

  const gridTotalMins = Math.max(gridEndMins - gridStartMins, 1);
  // 1.6 px per minute gives comfortable readability
  const GRID_H = Math.max(gridTotalMins * 1.6, 400);

  // ── Active days ───────────────────────────────────────────────────────────
  const activeDays = useMemo(() => {
    const daySet = new Set(displaySessions.map(s => s.time.dayOfWeek));
    return DAYS.filter(d => daySet.has(d));
  }, [displaySessions]);

  const daysToShow = activeDays.length > 0 ? activeDays : DAYS.slice(0, 5);
  const compact    = daysToShow.length > 5;

  // Helpers that close over the current grid range
  const pct    = (absMins: number) => `${((absMins - gridStartMins) / gridTotalMins) * 100}%`;
  const hPct   = (start: string, end: string) =>
    `${((timeToMins(end) - timeToMins(start)) / gridTotalMins) * 100}%`;

  const periodSummary = `${fmt12(periodStart)} – ${fmt12(minsToTime(periodEndMins))}  (${numPeriods} × ${periodMinutes} min)`;

  // ── Empty schedule guard ──────────────────────────────────────────────────
  if (!schedule) {
    return (
      <main className="flex-1 flex flex-col min-h-0 bg-slate-950">
        <TimetableHeader onBack={onBack} studentId={studentId} setStudentId={setStudentId} />
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-400">
          <Calendar className="w-16 h-16 opacity-20" />
          <p className="text-lg font-bold">No schedule imported</p>
          <p className="text-sm opacity-60">Import a master schedule to view the timetable.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col min-h-0 bg-slate-950 overflow-hidden">
      <TimetableHeader onBack={onBack} studentId={studentId} setStudentId={setStudentId} />

      {/* ── Filter bar ── */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-white/10 bg-slate-900/40 backdrop-blur-sm">

        {/* View mode tabs */}
        <div className="flex items-center rounded-lg bg-white/5 border border-white/10 overflow-hidden shrink-0">
          {([
            { id: 'student'    as const, Icon: BookOpen, label: 'Student'    },
            { id: 'group'      as const, Icon: Users,    label: 'Group'      },
            { id: 'room'       as const, Icon: DoorOpen, label: 'Room'       },
            { id: 'instructor' as const, Icon: User,     label: 'Instructor' },
          ]).map(({ id, Icon, label }) => (
            <button key={id} onClick={() => setViewMode(id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border-r border-white/10 last:border-r-0 transition-all cursor-pointer ${
                viewMode === id ? 'bg-teal-500/20 text-teal-200' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}>
              <Icon className="w-3 h-3" />{label}
              {id === 'group' && groupConflicts.length > 0 && (
                <span className="flex items-center justify-center w-3.5 h-3.5 rounded-full bg-red-500 text-white text-[8px] font-extrabold">
                  {groupConflicts.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Term */}
        {termOptions.length > 0 && (
          <FilterSelect icon={<Calendar className="w-3 h-3 text-slate-400" />}>
            <select value={selectedTerm} onChange={e => setSelectedTerm(e.target.value)}
              className="bg-transparent text-xs text-white outline-none min-w-[9rem]">
              {termOptions.map(t => <option key={t} value={t} className="bg-slate-900">{t}</option>)}
            </select>
          </FilterSelect>
        )}

        {/* Group (student mode narrows combos; group mode filters to one group) */}
        {(viewMode === 'student' || viewMode === 'group') && groupOptions.length > 0 && (
          <FilterSelect icon={<Users className="w-3 h-3 text-slate-400" />}>
            <select value={selectedGroup} onChange={e => setSelectedGroup(e.target.value)}
              className="bg-transparent text-xs text-white outline-none min-w-[9rem]">
              <option value="" className="bg-slate-900">All groups</option>
              {groupOptions.map(g => (
                <option key={g.id} value={g.id} className="bg-slate-900">
                  {(g.name || g.id) + (conflictsByGroup.has(g.id) ? ' ⚠' : '')}
                </option>
              ))}
            </select>
          </FilterSelect>
        )}

        {/* Room */}
        {viewMode === 'room' && (
          <FilterSelect icon={<DoorOpen className="w-3 h-3 text-slate-400" />}>
            <select value={selectedRoom} onChange={e => setSelectedRoom(e.target.value)}
              className="bg-transparent text-xs text-white outline-none min-w-[10rem]">
              <option value="" className="bg-slate-900">Pick a room…</option>
              {roomOptions.map(r => <option key={r} value={r} className="bg-slate-900">{r}</option>)}
            </select>
          </FilterSelect>
        )}

        {/* Instructor */}
        {viewMode === 'instructor' && (
          <FilterSelect icon={<User className="w-3 h-3 text-slate-400" />}>
            <select value={selectedInstructor} onChange={e => setSelectedInstructor(e.target.value)}
              className="bg-transparent text-xs text-white outline-none min-w-[12rem]">
              <option value="" className="bg-slate-900">Pick an instructor…</option>
              {instructorOptions.map(i => <option key={i} value={i} className="bg-slate-900">{i}</option>)}
            </select>
          </FilterSelect>
        )}

        {/* Search */}
        {viewMode !== 'student' && (
          <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 flex-1 min-w-[10rem]">
            <Search className="w-3 h-3 text-slate-400 shrink-0" />
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search sessions…"
              className="bg-transparent text-xs text-white outline-none flex-1 placeholder:text-slate-500" />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-slate-500 hover:text-white cursor-pointer">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

        {/* Session count */}
        <div className="flex items-center gap-1.5 bg-teal-500/10 border border-teal-500/20 rounded-full px-3 py-1 shrink-0">
          <Clock className="w-3 h-3 text-teal-400" />
          <span className="text-[10px] font-bold text-teal-200">
            {displaySessions.length} session{displaySessions.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Period settings toggle */}
        <button onClick={() => setShowSettings(v => !v)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-all shrink-0 ${
            showSettings
              ? 'bg-violet-500/20 border-violet-500/30 text-violet-200'
              : 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-200 hover:bg-white/10'
          }`}>
          <Settings className="w-3 h-3" />
          Periods
        </button>
      </div>

      {/* ── Period settings panel ── */}
      {showSettings && (
        <div className="flex flex-wrap items-center gap-5 px-5 py-3 border-b border-violet-500/20 bg-violet-500/5">
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Start time</label>
            <input type="time" value={periodStart}
              onChange={e => setPeriodStart(e.target.value)}
              className="bg-slate-900 border border-white/15 rounded-md px-2 py-1 text-white text-xs outline-none focus:ring-1 focus:ring-violet-400 cursor-pointer" />
          </div>

          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Period length</label>
            <div className="flex items-center gap-1">
              <input type="number" value={periodMinutes} min={10} max={180} step={5}
                onChange={e => setPeriodMinutes(Math.max(10, Math.min(180, Number(e.target.value))))}
                className="bg-slate-900 border border-white/15 rounded-md px-2 py-1 text-white text-xs outline-none focus:ring-1 focus:ring-violet-400 w-16 text-center" />
              <span className="text-slate-500 text-xs">min</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider"># Periods</label>
            <input type="number" value={numPeriods} min={1} max={20}
              onChange={e => setNumPeriods(Math.max(1, Math.min(20, Number(e.target.value))))}
              className="bg-slate-900 border border-white/15 rounded-md px-2 py-1 text-white text-xs outline-none focus:ring-1 focus:ring-violet-400 w-16 text-center" />
          </div>

          {/* Live summary */}
          <div className="ml-auto bg-slate-900/60 border border-violet-500/20 rounded-lg px-3 py-1.5 text-[11px] font-mono text-violet-300">
            {periodSummary}
          </div>
        </div>
      )}

      {/* ── Group contradiction banner ── */}
      {viewMode === 'group' && groupConflicts.length > 0 && (
        <div className="mx-4 mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-red-300 mb-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            {groupConflicts.length} contradiction{groupConflicts.length === 1 ? '' : 's'} found
            {conflictsByGroup.size > 1 ? ` across ${conflictsByGroup.size} groups` : ''}
          </div>
          <ul className="space-y-1 text-[11px] text-red-200/90">
            {[...conflictsByGroup.entries()].map(([gid, list]) => (
              <li key={gid} className="flex flex-wrap items-center gap-x-1.5">
                <button
                  onClick={() => setSelectedGroup(gid)}
                  className="font-bold underline decoration-dotted underline-offset-2 hover:text-red-100 cursor-pointer shrink-0"
                >
                  {list[0].groupName}:
                </button>
                {list.map((c, i) => (
                  <span key={`${c.a.id}-${c.b.id}`} className="text-red-300/80">
                    {c.a.courseCode} ({c.a.sessionType}) vs {c.b.courseCode} ({c.b.sessionType}) — {DAY_SHORT[c.a.time.dayOfWeek]} {fmt12(c.a.time.startTime)}
                    {i < list.length - 1 ? ',' : ''}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Empty state ── */}
      {displaySessions.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400 p-8">
          <Calendar className="w-12 h-12 opacity-20" />
          <p className="text-base font-bold text-center">
            {viewMode === 'student'
              ? plannedCodes.length === 0
                ? 'No courses planned — add courses in the Prereq Map'
                : 'No sessions found for the planned courses in this term'
              : viewMode === 'group'
              ? selectedGroup
                ? `No sessions found for this group`
                : 'Select a group to view its combined schedule'
              : viewMode === 'room'
              ? selectedRoom
                ? `No sessions found for room "${selectedRoom}"`
                : 'Select a room to view its schedule'
              : selectedInstructor
              ? `No sessions found for "${selectedInstructor}"`
              : 'Select an instructor to view their schedule'}
          </p>
        </div>
      ) : (
        /* ── Timetable grid ── */
        <div className="flex-1 overflow-auto">
          <div
            className="min-w-[520px]"
            style={{ display: 'grid', gridTemplateColumns: `72px repeat(${daysToShow.length}, minmax(0, 1fr))` }}
          >
            {/* Sticky day header row */}
            <div className="sticky top-0 z-30 bg-slate-950 border-b border-r border-white/10 h-10" />
            {daysToShow.map(day => (
              <div key={day}
                className="sticky top-0 z-30 bg-slate-950/95 backdrop-blur-sm border-b border-r border-white/10 h-10 flex items-center justify-center">
                <span className="text-[11px] font-extrabold uppercase tracking-widest text-slate-300">
                  {compact ? DAY_SHORT[day] : day}
                </span>
              </div>
            ))}

            {/* Time / period axis */}
            <div className="relative border-r border-white/10 bg-slate-950/80"
              style={{ height: `${GRID_H}px` }}>
              {periods.map(p => (
                <div key={p.num}
                  className="absolute left-0 right-0 flex flex-col items-center justify-start pt-0.5 border-t border-teal-500/20"
                  style={{ top: pct(p.startMins), height: hPct(minsToTime(p.startMins), minsToTime(p.endMins)) }}>
                  <span className="text-[9px] font-extrabold text-teal-400 leading-none">P{p.num}</span>
                  <span className="text-[8px] text-slate-500 font-mono leading-none mt-0.5">
                    {fmt12(minsToTime(p.startMins))}
                  </span>
                </div>
              ))}
              {/* End-of-periods marker */}
              <div className="absolute left-0 right-0 flex items-center justify-center"
                style={{ top: pct(periodEndMins) }}>
                <span className="text-[8px] text-slate-600 font-mono">{fmt12(minsToTime(periodEndMins))}</span>
              </div>
            </div>

            {/* Day columns */}
            {daysToShow.map(day => {
              const daySessions = displaySessions.filter(s => s.time.dayOfWeek === day);
              return (
                <div key={day}
                  className="relative border-r border-white/10 bg-slate-950"
                  style={{ height: `${GRID_H}px` }}>

                  {/* Period band fills + gridlines */}
                  {periods.map(p => (
                    <React.Fragment key={p.num}>
                      {/* Alternating subtle bands */}
                      {p.num % 2 === 0 && (
                        <div className="absolute inset-x-0 bg-white/[0.015]"
                          style={{ top: pct(p.startMins), height: hPct(minsToTime(p.startMins), minsToTime(p.endMins)) }} />
                      )}
                      {/* Period start line */}
                      <div className="absolute inset-x-0 border-t border-teal-500/10"
                        style={{ top: pct(p.startMins) }} />
                    </React.Fragment>
                  ))}

                  {/* End-of-periods dashed line */}
                  <div className="absolute inset-x-0 border-t-2 border-dashed border-teal-500/25"
                    style={{ top: pct(periodEndMins) }} />

                  {/* Session blocks */}
                  {daySessions.map((session, i) => (
                    <SessionBlock
                      key={`${session.id}-${i}`}
                      session={session}
                      palette={getPalette(session.courseCode, colorMap)}
                      compact={compact}
                      gridStartMins={gridStartMins}
                      gridTotalMins={gridTotalMins}
                      hasConflict={viewMode === 'group' && conflictSessionIds.has(session.id)}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Legend footer ── */}
      {displaySessions.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2 border-t border-white/10 bg-slate-900/30 text-[10px]">
          {[...new Set(displaySessions.map(s => s.courseCode))].map(code => {
            const pal  = getPalette(code, colorMap);
            const name = displaySessions.find(s => s.courseCode === code)?.courseName ?? '';
            return (
              <div key={code} className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-sm ${pal.dot}`} />
                <span className="font-bold text-slate-300">{code}</span>
                {name && <span className="text-slate-500 truncate max-w-[14ch]">{name}</span>}
              </div>
            );
          })}
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {(['LEC', 'LAB', 'TUT'] as const).map(type => (
              <span key={type} className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${TYPE_COLORS[type] ?? ''}`}>
                {type}
              </span>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function TimetableHeader({
  onBack,
  studentId,
  setStudentId,
}: {
  onBack: () => void;
  studentId: string;
  setStudentId: (id: string) => void;
}) {
  const { state, metricsByStudent } = useData();

  // Find students who have at least one course planned in the active term
  const activeTerm = state.terms.find(t => t.id === state.activeTermId);
  
  const plannedStudents = useMemo(() => {
    if (!activeTerm) return [];
    return activeTerm.entries
      .filter(e => e.courseCodes.length > 0)
      .map(e => {
        const fallback: StudentMetrics = metricsByStudent[e.studentId] ?? {
          studentId: e.studentId,
          name: e.studentId,
          major: '',
          gpa: 0,
          totalUnits: 0,
          totalFailedUnits: 0,
          failedCourseCodes: [],
          missingPrereqsForNextTerm: [],
          hasPlannedConflict: false,
          currentSemester: 1,
          level: 'Level 0',
        };
        return fallback;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [activeTerm, metricsByStudent]);

  const currentIndex = plannedStudents.findIndex(s => s.studentId === studentId);
  
  const canPrev = currentIndex > 0;
  const canNext = currentIndex >= 0 && currentIndex < plannedStudents.length - 1;

  const handlePrev = () => { if (canPrev) setStudentId(plannedStudents[currentIndex - 1].studentId); };
  const handleNext = () => { if (canNext) setStudentId(plannedStudents[currentIndex + 1].studentId); };

  // Ensure current student is in the dropdown list even if they have no plan
  const allStudentsForDropdown = useMemo(() => {
    if (plannedStudents.some(s => s.studentId === studentId)) {
      return plannedStudents;
    }
    const fallback: StudentMetrics = metricsByStudent[studentId] ?? {
      studentId,
      name: studentId,
      major: '',
      gpa: 0,
      totalUnits: 0,
      totalFailedUnits: 0,
      failedCourseCodes: [],
      missingPrereqsForNextTerm: [],
      hasPlannedConflict: false,
      currentSemester: 1,
      level: 'Level 0',
    };
    return [fallback, ...plannedStudents].sort((a, b) => a.name.localeCompare(b.name));
  }, [plannedStudents, studentId, metricsByStudent]);

  const positionLabel = currentIndex >= 0 
    ? `${currentIndex + 1} / ${plannedStudents.length}`
    : `0 / ${plannedStudents.length}`;

  return (
    <header className="px-6 py-4 border-b border-white/10 flex flex-col gap-4 bg-slate-950/80 backdrop-blur-md shrink-0">
      <div className="flex flex-col gap-4 w-full">
        {/* Top row: Student Selector */}
        <div className="flex items-end justify-between w-full">
          <div className="w-full max-w-2xl">
            <StudentCombobox
              students={allStudentsForDropdown}
              value={studentId}
              onChange={setStudentId}
              label="Student Schedule"
            />
          </div>
        </div>

        {/* Bottom row: Back button, Title, Prev/Next arrows */}
        <div className="flex items-center gap-4 flex-wrap">
          <button onClick={onBack}
            className="flex items-center gap-2 text-slate-300 hover:text-white px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors cursor-pointer">
            <ArrowLeft className="w-4 h-4" />
            <span className="text-xs font-bold uppercase tracking-wider">Back to Map</span>
          </button>
          
          <div className="flex items-center gap-3 border-l border-white/10 pl-4">
            <div className="w-9 h-9 rounded-xl bg-teal-500/15 border border-teal-500/30 flex items-center justify-center">
              <Clock className="w-4 h-4 text-teal-400" />
            </div>
            <div>
              <h1 className="text-base font-extrabold tracking-tight text-white leading-tight">Weekly Timetable</h1>
              <p className="text-[10px] text-teal-300/70 uppercase tracking-wider font-bold leading-tight">
                {metricsByStudent[studentId]?.name ?? studentId}
              </p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl px-1 py-1">
            <button
              onClick={handlePrev}
              disabled={!canPrev}
              title="Previous student with plan"
              className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                canPrev
                  ? 'hover:bg-white/10 text-slate-200'
                  : 'text-slate-600 cursor-not-allowed'
              }`}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            
            <span className={`text-[10px] uppercase tracking-wider font-bold px-1 select-none text-slate-500`}>
              {positionLabel}
            </span>
            
            <button
              onClick={handleNext}
              disabled={!canNext}
              title="Next student with plan"
              className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                canNext
                  ? 'hover:bg-white/10 text-slate-200'
                  : 'text-slate-600 cursor-not-allowed'
              }`}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

function FilterSelect({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5">
      {icon}
      {children}
    </div>
  );
}