/**
 * ascXmlParser.ts
 *
 * Parses aSc Timetables XML export format (used in this project) into
 * a MasterSchedule object compatible with the existing schedule system.
 *
 * XML structure summary:
 *   <periods>      – period number → starttime / endtime
 *   <daysdefs>     – bitmask pattern → day name ("100000" → "Saturday")
 *   <subjects>     – id → "LEC CHE111 Organic Chemistry" style names
 *   <teachers>     – id → instructor name
 *   <classrooms>   – id → short room code + capacity
 *   <classes>      – id → target group name ("Petroleum & Gas", etc.);
 *                    some exports segment the flat class list into levels
 *                    via a bare "Level 2" / "Level 3" marker entry — see
 *                    the classMap-building code below for how that's
 *                    disambiguated (e.g. "Mechatronics G1" → "..._L1")
 *   <lessons>      – id → subjectId + classIds[] + teacherIds[] + periodsPerCard
 *   <cards>        – lessonId + classroomId + period + days bitmask
 *
 * Cards with the same (lessonId, days, classroomId) are consecutive
 * period slots for one class meeting and are merged into a single row
 * (startTime from the lowest period, endTime from the highest).
 *
 * Online courses (subject name ends in "(Online)") are handled specially:
 * if their lesson has real cards in the export, those cards are merged
 * into per-day rows like any other course, but the displayed time is
 * shifted: the period(s) aSc assigned only tell us the class's *duration*,
 * not its real-world time (online classes actually run in the evening),
 * so the row is shown starting at ONLINE_DISPLAY_START (6:00 PM) with
 * that same duration added on top — e.g. a 2h40m card becomes 6:00 PM –
 * 8:40 PM instead of whatever daytime periods it was actually assigned.
 * The session is also tagged with roomCode "ONLINE" and statusOverride
 * "Online" instead of a physical room. Only an online lesson with ZERO
 * cards anywhere in the export (fully async, no schedule entry at all)
 * falls back to a fixed 9:00 AM – 6:00 PM slot across every weekday
 * (Sat–Thu) — that one is intentionally NOT shifted to 6 PM, since its
 * whole point is to span the entire academic day so it overlaps with (and
 * therefore conflicts against) any other in-person session the same
 * group has that day.
 */

import type {
  MasterSchedule,
  ClassSession,
  ProgramGroup,
  SessionType,
} from './types';

// ── helpers ─────────────────────────────────────────────────────────────────

type DayName = 'Saturday' | 'Sunday' | 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday';

const SINGLE_DAY_PATTERNS: Record<string, DayName> = {
  '100000': 'Saturday',
  '010000': 'Sunday',
  '001000': 'Monday',
  '000100': 'Tuesday',
  '000010': 'Wednesday',
  '000001': 'Thursday',
};

const SESSION_TYPE_PREFIXES = ['LEC', 'LAB', 'TUT', 'UE'];

/**
 * Extracts { sessionType, courseCode, courseName } from subject names
 * like "LEC CHE111 Organic Chemistry" or "LAN114 Literary Appreciation".
 */
function parseSubjectName(raw: string): {
  sessionType: SessionType;
  courseCode: string;
  courseName: string;
  isOnline: boolean;
} {
  const name = raw.trim().replace(/\s+/g, ' ');

  // Check if this is an online course
  const isOnline = /\(Online\)$/i.test(name);
  const cleanName = name.replace(/\s*\(Online\)$/i, '').trim();

  // Detect leading session-type prefix (LEC / LAB / TUT / UE [number])
  let sessionType: SessionType = 'LEC'; // default for prefix-less subjects
  let rest = cleanName;

  const prefixRx = /^(LEC|LAB|TUT|UE\s*\d*)\s+/i;
  const prefixMatch = cleanName.match(prefixRx);
  if (prefixMatch) {
    const prefix = prefixMatch[1].trim().toUpperCase();
    // Map UE variants to LEC (or keep as-is if you add UE to SessionType later).
    // Since SessionType is 'LEC'|'LAB'|'TUT', we map UE → LEC.
    sessionType = (SESSION_TYPE_PREFIXES.slice(0, 3).includes(prefix)
      ? prefix
      : 'LEC') as SessionType;
    rest = cleanName.slice(prefixMatch[0].length).trim();
  }

  // Extract course code: 2–4 uppercase letters + 3 digits (e.g. CHE111, MA211)
  const codeRx = /^([A-Z]{2,5}\s*\d{3}[A-Z]?)\s+(.*)/;
  const codeMatch = rest.match(codeRx);
  if (codeMatch) {
    return {
      sessionType,
      courseCode: codeMatch[1].replace(/\s+/, '').trim(),
      courseName: codeMatch[2].trim(),
      isOnline,
    };
  }

  // Fallback: everything is the course name; use first token as code.
  const tokens = rest.split(/\s+/);
  return {
    sessionType,
    courseCode: tokens[0] ?? '',
    courseName: tokens.slice(1).join(' '),
    isOnline,
  };
}

/** Zero-pads a time string like "9:00" → "09:00". */
function padTime(t: string): string {
  if (!t) return t;
  const [h, m] = t.split(':');
  return `${h.padStart(2, '0')}:${m ?? '00'}`;
}

/** Converts "HH:MM" → minutes since midnight. */
function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map((n) => parseInt(n, 10) || 0);
  return h * 60 + m;
}

/** Converts minutes since midnight → "HH:MM", wrapping around 24h if needed. */
function minutesToTime(mins: number): string {
  const wrapped = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Online lessons with real cards are displayed starting at this clock time
// (aSc's own periods for these lessons are just administrative placeholders
// for duration, not the actual real-world time — online classes actually
// run in the evening). The class's real duration, taken from its assigned
// periods, is added on top of this base to get the end time.
const ONLINE_DISPLAY_START = '18:00';

// ── main export ─────────────────────────────────────────────────────────────

/**
 * Parse an aSc Timetables XML string into a MasterSchedule.
 *
 * @param xmlText  Full text of the XML file (decoded from windows-1252).
 * @param term     Term label to stamp on every session, e.g. "Summer 2025-2026".
 * @returns        A MasterSchedule, or null if parsing fails or is empty.
 */
export function parseAscXML(xmlText: string, term: string): MasterSchedule | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    console.error('[ascXmlParser] XML parse error:', parseError.textContent);
    return null;
  }

  // ── 1. periods ─────────────────────────────────────────────────────────
  const periodMap = new Map<number, { starttime: string; endtime: string }>();
  doc.querySelectorAll('periods > period').forEach((el) => {
    const num = parseInt(el.getAttribute('period') ?? '0', 10);
    periodMap.set(num, {
      starttime: padTime(el.getAttribute('starttime') ?? ''),
      endtime: padTime(el.getAttribute('endtime') ?? ''),
    });
  });

  // ── 2. day pattern → day name ──────────────────────────────────────────
  // Build from daysdefs first, then fall back to the hard-coded map.
  const daysPatternMap = new Map<string, DayName>(
    Object.entries(SINGLE_DAY_PATTERNS)
  );
  doc.querySelectorAll('daysdefs > daysdef').forEach((el) => {
    const name = el.getAttribute('name') ?? '';
    const days = el.getAttribute('days') ?? '';
    const matched = Object.entries(SINGLE_DAY_PATTERNS).find(([, d]) => d === name);
    if (matched) return; // already in map from hard-coded table
    // Single-pattern daysdef that we don't recognise — skip.
    days.split(',').forEach((pattern) => {
      if (pattern && !daysPatternMap.has(pattern)) {
        // Try to match to a known day name.
        const known = SINGLE_DAY_PATTERNS[pattern];
        if (known) daysPatternMap.set(pattern, known);
      }
    });
  });

  // ── 3. subjects ────────────────────────────────────────────────────────
  const subjectMap = new Map<string, ReturnType<typeof parseSubjectName>>();
  doc.querySelectorAll('subjects > subject').forEach((el) => {
    const id = el.getAttribute('id') ?? '';
    const name = el.getAttribute('name') ?? '';
    if (id) subjectMap.set(id, parseSubjectName(name));
  });

  // ── 4. teachers ────────────────────────────────────────────────────────
  const teacherMap = new Map<string, string>();
  doc.querySelectorAll('teachers > teacher').forEach((el) => {
    const id = el.getAttribute('id') ?? '';
    const name = el.getAttribute('name') ?? '';
    if (id) teacherMap.set(id, name.trim());
  });

  // ── 5. classrooms ──────────────────────────────────────────────────────
  const classroomMap = new Map<string, { short: string; capacity?: number }>();
  doc.querySelectorAll('classrooms > classroom').forEach((el) => {
    const id = el.getAttribute('id') ?? '';
    const short = (el.getAttribute('short') || (el.getAttribute('name') ?? '')).trim();
    const capStr = el.getAttribute('capacity') ?? '';
    const capacity =
      capStr && capStr !== '*' ? parseInt(capStr, 10) : undefined;
    if (id) classroomMap.set(id, { short, capacity });
  });

  // ── 6. classes (student groups) ────────────────────────────────────────
  // aSc lists every class in one flat sequence. This export segments that
  // sequence by level using a bare marker entry named "Level 2", "Level 3",
  // etc — everything before the first marker is implicitly Level 1. Group
  // *names* repeat across levels (e.g. "Mechatronics G1" shows up once per
  // level as a genuinely different cohort with its own id/roster), so once
  // we detect any level markers we tag every group's id AND display name
  // with its level (→ "Mechatronics G1_L1") so same-named groups from
  // different levels never get merged into one.
  interface ClassInfo {
    id: string;
    label: string;
  }
  const classEls = Array.from(doc.querySelectorAll('classes > class'));
  const levelMarkerRx = /^level\s*(\d+)$/i;
  const hasLevelMarkers = classEls.some((el) =>
    levelMarkerRx.test((el.getAttribute('name') ?? '').trim())
  );

  const classMap = new Map<string, ClassInfo>();
  let currentLevel = 1;
  for (const el of classEls) {
    const xmlId = el.getAttribute('id') ?? '';
    // Decode XML entities in name (DOMParser already handles &amp; etc.)
    const rawName = (el.getAttribute('name') ?? '').trim();
    const marker = rawName.match(levelMarkerRx);
    if (marker) {
      currentLevel = parseInt(marker[1], 10);
      continue; // boundary marker, not a real group
    }
    if (!xmlId || !rawName) continue;
    classMap.set(xmlId, hasLevelMarkers
      ? { id: `${rawName}_L${currentLevel}`, label: `${rawName} (Level ${currentLevel})` }
      : { id: rawName, label: rawName });
  }

  // ── 7. lessons ─────────────────────────────────────────────────────────
  interface Lesson {
    subjectId: string;
    classIds: string[];
    teacherIds: string[];
  }
  const lessonMap = new Map<string, Lesson>();
  doc.querySelectorAll('lessons > lesson').forEach((el) => {
    const id = el.getAttribute('id') ?? '';
    if (!id) return;
    lessonMap.set(id, {
      subjectId: el.getAttribute('subjectid') ?? '',
      classIds: (el.getAttribute('classids') ?? '').split(',').filter(Boolean),
      teacherIds: (el.getAttribute('teacherids') ?? '').split(',').filter(Boolean),
    });
  });

  // ── 8. cards → grouped sessions ────────────────────────────────────────
  interface CardGroup {
    lessonId: string;
    days: string;
    classroomId: string;
    periods: number[];
  }
  const cardGroups = new Map<string, CardGroup>();

  doc.querySelectorAll('cards > card').forEach((el) => {
    const lessonId = el.getAttribute('lessonid') ?? '';
    const classroomIds = el.getAttribute('classroomids') ?? '';
    const period = parseInt(el.getAttribute('period') ?? '0', 10);
    const days = el.getAttribute('days') ?? '';

    if (!lessonId || !days || !period) return;

    // Use the first assigned classroom for this card.
    const classroomId = classroomIds.split(',')[0] ?? '';
    const key = `${lessonId}\u0000${days}\u0000${classroomId}`;

    const existing = cardGroups.get(key);
    if (existing) {
      existing.periods.push(period);
    } else {
      cardGroups.set(key, { lessonId, days, classroomId, periods: [period] });
    }
  });

  // Lessons that have at least one real card in the export. Online lessons
  // in this set are scheduled from their actual card data in step 9 below,
  // merged into per-day rows just like any other course. Only online
  // lessons NOT in this set (zero cards at all) get the fixed all-week
  // 9–6 fallback in step 10.
  const lessonIdsWithCards = new Set(
    Array.from(cardGroups.values()).map((g) => g.lessonId)
  );

  // ── 9. Build ClassSession list ─────────────────────────────────────────
  const sessions: ClassSession[] = [];
  const groupMap = new Map<string, ProgramGroup>();
  let sisCounter = 10001;

  for (const group of cardGroups.values()) {
    const lesson = lessonMap.get(group.lessonId);
    if (!lesson) continue;

    const subject = subjectMap.get(lesson.subjectId);
    if (!subject || !subject.courseCode) continue;

    const dayName = daysPatternMap.get(group.days);
    if (!dayName) continue; // multi-day or unrecognised pattern — skip

    const sortedPeriods = [...group.periods].sort((a, b) => a - b);
    const firstPeriod = periodMap.get(sortedPeriods[0]);
    const lastPeriod = periodMap.get(sortedPeriods[sortedPeriods.length - 1]);
    if (!firstPeriod || !lastPeriod) continue;

    // Online lessons with real cards keep their real *duration* (derived
    // from the periods aSc assigned) but are displayed starting at
    // ONLINE_DISPLAY_START instead of the period's literal daytime clock
    // time — online classes actually run in the evening, so the assigned
    // periods only tell us how long the class is, not when it happens.
    const classroom = classroomMap.get(group.classroomId);
    const roomCode = subject.isOnline ? 'ONLINE' : (classroom?.short ?? '');
    const capacity = subject.isOnline ? undefined : classroom?.capacity;

    let startTime = firstPeriod.starttime;
    let endTime = lastPeriod.endtime;
    if (subject.isOnline) {
      const durationMins = timeToMinutes(lastPeriod.endtime) - timeToMinutes(firstPeriod.starttime);
      startTime = ONLINE_DISPLAY_START;
      endTime = minutesToTime(timeToMinutes(ONLINE_DISPLAY_START) + Math.max(durationMins, 0));
    }

    const instructorName = lesson.teacherIds
      .map((id) => teacherMap.get(id) ?? '')
      .filter(Boolean)
      .join(' / ');

    const targetGroups = lesson.classIds
      .map((id) => classMap.get(id))
      .filter((g): g is ClassInfo => Boolean(g));

    for (const g of targetGroups) {
      if (!groupMap.has(g.id)) {
        groupMap.set(g.id, { id: g.id, name: g.label, department: '' });
      }
    }

    const targetGroupIds = targetGroups.map((g) => g.id);

    const sisClassNumber = String(sisCounter++);

    sessions.push({
      id: `${subject.courseCode}-${group.lessonId}-${group.days}`,
      term,
      courseCode: subject.courseCode,
      courseName: subject.courseName,
      sessionType: subject.sessionType,
      targetGroups: targetGroupIds,
      instructorName,
      roomCode,
      sisClassNumber,
      time: {
        dayOfWeek: dayName,
        startTime,
        endTime,
      },
      capacity,
      enrolled: undefined,
      statusOverride: subject.isOnline ? 'Online' : undefined,
    });
  }

  // ── 10. Online courses with NO real cards — fixed 9:00 AM – 6:00 PM ─────
  // fallback, every weekday (Sat–Thu). This only fires for a lesson with
  // zero entries in <cards> anywhere in the export (fully async, no
  // schedule row at all). Online lessons that DO have cards were already
  // handled in step 9 above using their actual day/time, so they're
  // excluded here via lessonIdsWithCards. None of the online lessons in
  // a typical export hit this path, but it's kept as a safety net for
  // exports that omit cards for fully-async courses.
  const weekDays: DayName[] = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'];

  for (const [lessonId, lesson] of lessonMap.entries()) {
    const subject = subjectMap.get(lesson.subjectId);
    if (!subject || !subject.isOnline) continue;
    if (lessonIdsWithCards.has(lessonId)) continue; // already scheduled from real cards in step 9

    const instructorName = lesson.teacherIds
      .map((id) => teacherMap.get(id) ?? '')
      .filter(Boolean)
      .join(' / ');

    const targetGroups = lesson.classIds
      .map((id) => classMap.get(id))
      .filter((g): g is ClassInfo => Boolean(g));

    if (targetGroups.length === 0) continue;

    for (const g of targetGroups) {
      if (!groupMap.has(g.id)) {
        groupMap.set(g.id, { id: g.id, name: g.label, department: '' });
      }
    }

    const targetGroupIds = targetGroups.map((g) => g.id);

    weekDays.forEach((day) => {
      const sisClassNumber = String(sisCounter++);

      sessions.push({
        id: `${subject.courseCode}-${lessonId}-online-${day}`,
        term,
        courseCode: subject.courseCode,
        courseName: subject.courseName,
        sessionType: subject.sessionType,
        targetGroups: targetGroupIds,
        instructorName,
        roomCode: 'ONLINE',
        sisClassNumber,
        time: {
          dayOfWeek: day,
          startTime: '09:00',
          endTime: '18:00',
        },
        capacity: undefined,
        enrolled: undefined,
        statusOverride: 'Online',
      });
    });
  }

  if (sessions.length === 0) return null;

  return {
    term,
    groups: Array.from(groupMap.values()),
    sessions,
  };
}

/**
 * Reads an aSc XML File (windows-1252 encoded), decodes it, and parses
 * it into a MasterSchedule. Returns null on any failure.
 */
export async function readAndParseAscXML(
  file: File,
  term: string
): Promise<MasterSchedule | null> {
  try {
    const buffer = await file.arrayBuffer();
    // aSc exports as windows-1252; TextDecoder handles the mapping to
    // Unicode so Arabic or special chars in room/instructor names survive.
    const text = new TextDecoder('windows-1252').decode(buffer);
    return parseAscXML(text, term);
  } catch (err) {
    console.error('[ascXmlParser] Failed to read/parse file:', err);
    return null;
  }
}