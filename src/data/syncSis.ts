/**
 * syncSis.ts
 *
 * Matches the `classNumbers.json` output of the Playwright SIS scraper
 * (see `fetchClassNumbers.ts`) against the app's own `MasterSchedule`,
 * and updates each session's `sisClassNumber`.
 *
 * ── Matching rules ──────────────────────────────────────────────────────
 * For every ACTIVE (non-outdated) session in the schedule:
 *
 *   1. Find SIS rows for the same course + same session type (LEC/LAB/TUT)
 *      whose section code looks like a real section (L#E / T#E / LB#E /
 *      B#E — combined/admin/distance-ed rows are ignored, same filter the
 *      scraper itself already applies).
 *
 *   2. If one of those rows has a meeting on the same day, at the same
 *      start+end time as the session → EXACT MATCH. Just update
 *      `sisClassNumber` (and room, if SIS has one) in place. Nothing else
 *      changes.
 *
 *   3. Otherwise, the time didn't match. That means either:
 *        a) the section is online in SIS (its scraped `meetings[]` is
 *           empty — the scraper only records a meeting row when it finds
 *           a start/end time), in which case there's no time to correct —
 *           `sisClassNumber` is updated in place, no new session needed.
 *        b) the section's time actually changed in SIS. If exactly one
 *           candidate row has a meeting on the SAME day as the existing
 *           session (just a different time), that's treated as "this
 *           section moved" — a NEW session is created with the corrected
 *           day/time/sisClassNumber, and the OLD session is marked
 *           `outdated: true` (kept, not deleted) and linked via
 *           `supersededBy`.
 *
 *   4. Anything that doesn't cleanly resolve (no candidates at all, or
 *      multiple candidates and none/more-than-one share the session's
 *      day) is left untouched and reported as "unmatched" / "ambiguous"
 *      in the summary so a human can look at it — we never guess at
 *      which of several plausible sections is the right one.
 *
 * This module is pure (no React, no DataContext) so it's easy to unit
 * test; DataContext.syncSisClassNumbers() is a thin wrapper around it.
 */

import type { ClassSession, MasterSchedule, SessionType, TimeSlot } from './types';
import { normalizeCourseCodeLoose } from './normalize';

// ── input shape (mirrors fetchClassNumbers.ts's classNumbers.json) ────────

export interface SisMeeting {
  day: string;
  startTime: string;
  endTime: string;
  roomShort: string;
}

export interface SisClassRow {
  courseCode: string;
  sectionCode: string | null;
  sessionType: string | null;
  classNbr: string | null;
  meetings: SisMeeting[];
}

/** L#E / T#E / LB#E / B#E — NMU's real-section naming convention. Combined
 *  sections, distance-ed rows, and other one-offs don't match this and are
 *  ignored, matching fetchClassNumbers.ts's own `VALID_SECTION_CODE`. */
const VALID_SECTION_CODE = /^(LB|L|T|B)\d+E$/i;

function isRecognizedSectionCode(code: string | null | undefined): boolean {
  return !!code && VALID_SECTION_CODE.test(code.trim());
}

/**
 * Parses and lightly validates the contents of a `classNumbers.json`
 * file. Throws a short, user-facing message on malformed input rather
 * than a raw JSON.parse error.
 */
export function parseSisClassNumbersJson(text: string): SisClassRow[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON — expected the classNumbers.json produced by fetchClassNumbers.ts.');
  }
  if (!Array.isArray(raw)) {
    throw new Error('Expected classNumbers.json to contain an array of sections.');
  }
  const rows: SisClassRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.courseCode !== 'string' || !r.courseCode) continue;
    const meetingsRaw = Array.isArray(r.meetings) ? r.meetings : [];
    const meetings: SisMeeting[] = meetingsRaw
      .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
      .map(m => ({
        day: typeof m.day === 'string' ? m.day : '',
        startTime: typeof m.startTime === 'string' ? m.startTime : '',
        endTime: typeof m.endTime === 'string' ? m.endTime : '',
        roomShort: typeof m.roomShort === 'string' ? m.roomShort : '',
      }));
    rows.push({
      courseCode: r.courseCode,
      sectionCode: typeof r.sectionCode === 'string' ? r.sectionCode : null,
      sessionType: typeof r.sessionType === 'string' ? r.sessionType : null,
      classNbr: typeof r.classNbr === 'string' ? r.classNbr : null,
      meetings,
    });
  }
  return rows;
}

// ── result / summary shape ─────────────────────────────────────────────

export interface SyncSisSummary {
  /** Exact day+time match — sisClassNumber updated in place. */
  matchedExact: number;
  /** No meetings on the SIS row (online) — sisClassNumber updated in place. */
  matchedOnline: number;
  /** Time changed on SIS — new session added, old one marked outdated. */
  timeChanged: number;
  /** Course+type found in SIS, but couldn't confidently pick one row. */
  ambiguous: number;
  /** Course+type not found anywhere in the SIS data at all. */
  unmatched: number;
  /** Already-outdated sessions, skipped entirely. */
  skippedOutdated: number;
}

export interface SyncSisResult {
  schedule: MasterSchedule;
  summary: SyncSisSummary;
  /** One short line per session that changed or needs attention, for an
   *  optional detail view. Always safe to ignore. */
  details: string[];
  /** Structured per-session change record, one entry per active session
   *  that was processed. Useful for rendering the review screen. */
  changes: SisSyncChangeRecord[];
}

export type SisSyncChangeKind =
  | 'matched-exact'
  | 'matched-online'
  | 'time-changed'
  | 'ambiguous'
  | 'unmatched'
  | 'skipped-outdated';

export interface SisSyncChangeRecord {
  kind: SisSyncChangeKind;
  courseCode: string;
  sessionType: string;
  sessionId: string;
  oldSisClassNumber?: string;
  newSisClassNumber?: string;
  oldTime?: TimeSlot;
  newTime?: TimeSlot;
  newRoom?: string;
  sisSectionCode?: string;
  description: string;
}

function timesEqual(a: TimeSlot, m: SisMeeting): boolean {
  return a.dayOfWeek === m.day && a.startTime === m.startTime && a.endTime === m.endTime;
}

function minutesFromMidnight(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function timesCloseEnough(a: TimeSlot, m: SisMeeting): boolean {
  if (a.dayOfWeek !== m.day) return false;
  return (
    Math.abs(minutesFromMidnight(a.startTime) - minutesFromMidnight(m.startTime)) <= 1 &&
    Math.abs(minutesFromMidnight(a.endTime) - minutesFromMidnight(m.endTime)) <= 1
  );
}

function sessionTypeMatches(candidate: SisClassRow, wanted: SessionType): boolean {
  return (candidate.sessionType ?? '').trim().toUpperCase() === wanted;
}

/**
 * Pure function: given the current schedule and the parsed SIS rows,
 * returns a NEW MasterSchedule (originals are never mutated) plus a
 * summary of what happened.
 */
export function syncSisClassNumbers(
  schedule: MasterSchedule,
  sisRows: SisClassRow[]
): SyncSisResult {
  const summary: SyncSisSummary = {
    matchedExact: 0,
    matchedOnline: 0,
    timeChanged: 0,
    ambiguous: 0,
    unmatched: 0,
    skippedOutdated: 0,
  };
  const details: string[] = [];
  const changes: SisSyncChangeRecord[] = [];

  // Index SIS rows by normalized course code for fast lookup.
  const byCourse = new Map<string, SisClassRow[]>();
  for (const row of sisRows) {
    if (!isRecognizedSectionCode(row.sectionCode) || !row.classNbr) continue;
    const key = normalizeCourseCodeLoose(row.courseCode);
    if (!byCourse.has(key)) byCourse.set(key, []);
    byCourse.get(key)!.push(row);
  }

  const nextSessions: ClassSession[] = [];
  const newSessions: ClassSession[] = [];
  let idCounter = 0;
  const freshId = (base: string) => `${base}-sis-${Date.now()}-${idCounter++}`;

  const pushChange = (kind: SisSyncChangeKind, session: ClassSession, extra?: Partial<SisSyncChangeRecord>) => {
    changes.push({
      kind,
      courseCode: session.courseCode,
      sessionType: session.sessionType,
      sessionId: session.id,
      oldSisClassNumber: session.sisClassNumber,
      description: '',
      ...extra,
    });
  };

  for (const session of schedule.sessions) {
    if (session.outdated) {
      summary.skippedOutdated++;
      pushChange('skipped-outdated', session);
      nextSessions.push(session);
      continue;
    }

    const candidates = (byCourse.get(normalizeCourseCodeLoose(session.courseCode)) ?? [])
      .filter(row => sessionTypeMatches(row, session.sessionType));

    if (candidates.length === 0) {
      summary.unmatched++;
      pushChange('unmatched', session, {
        description: `${session.courseCode} ${session.sessionType} (${session.id}): course+type not found in SIS data.`,
      });
      nextSessions.push(session);
      continue;
    }

    // 1) Exact day+time match against ANY meeting on ANY candidate.
    const exact = candidates.find(row => row.meetings.some(m => timesEqual(session.time, m)));
    if (exact) {
      summary.matchedExact++;
      pushChange('matched-exact', session, {
        newSisClassNumber: exact.classNbr!,
        sisSectionCode: exact.sectionCode ?? undefined,
        newRoom: exact.meetings.find(m => timesEqual(session.time, m))?.roomShort || session.roomCode,
        description: `${session.courseCode} ${session.sessionType} (${session.id}): exact match — SIS # ${exact.classNbr}.`,
      });
      nextSessions.push({
        ...session,
        sisClassNumber: exact.classNbr!,
        roomCode: exact.meetings.find(m => timesEqual(session.time, m))?.roomShort || session.roomCode,
      });
      continue;
    }

    // 1b) Close-enough match (±1 minute) — SIS shows a trivial time
    //     difference. Keep the session's current time as-is and just
    //     update the class number, rather than flagging it as a change.
    const close = candidates.find(row =>
      row.meetings.some(m => timesCloseEnough(session.time, m))
    );
    if (close) {
      summary.matchedExact++;
      pushChange('matched-exact', session, {
        newSisClassNumber: close.classNbr!,
        sisSectionCode: close.sectionCode ?? undefined,
        newRoom: close.meetings.find(m => timesCloseEnough(session.time, m))?.roomShort || session.roomCode,
        description: `${session.courseCode} ${session.sessionType} (${session.id}): time within 1 min of SIS — class # updated, time kept as-is.`,
      });
      nextSessions.push({
        ...session,
        sisClassNumber: close.classNbr!,
        roomCode: close.meetings.find(m => timesCloseEnough(session.time, m))?.roomShort || session.roomCode,
      });
      continue;
    }

    // 2) Online sections: a candidate for this course+type with no
    //    meetings at all. Only safe to use if it's the ONLY such
    //    candidate (or all candidates are online) — otherwise we don't
    //    know which SIS row actually corresponds to this session.
    const onlineCandidates = candidates.filter(row => row.meetings.length === 0);
    if (onlineCandidates.length === 1 && candidates.length === 1) {
      summary.matchedOnline++;
      pushChange('matched-online', session, {
        newSisClassNumber: onlineCandidates[0].classNbr!,
        sisSectionCode: onlineCandidates[0].sectionCode ?? undefined,
        description: `${session.courseCode} ${session.sessionType} (${session.id}): section is online on SIS — class # updated, time left as-is.`,
      });
      nextSessions.push({ ...session, sisClassNumber: onlineCandidates[0].classNbr! });
      details.push(`${session.courseCode} ${session.sessionType} (${session.id}): section is online on SIS — class # updated, time left as-is.`);
      continue;
    }

    // 3) Time apparently changed: look for exactly one candidate with a
    //    meeting on the SAME day as the existing session.
    const sameDayMatches = candidates.filter(row =>
      row.meetings.some(m => m.day === session.time.dayOfWeek)
    );

    if (sameDayMatches.length === 1) {
      const row = sameDayMatches[0];
      const meeting = row.meetings.find(m => m.day === session.time.dayOfWeek)!;
      const newTime: TimeSlot = {
        dayOfWeek: session.time.dayOfWeek,
        startTime: meeting.startTime,
        endTime: meeting.endTime,
      };
      const newSession: ClassSession = {
        ...session,
        id: freshId(session.id || session.courseCode),
        sisClassNumber: row.classNbr!,
        roomCode: meeting.roomShort || session.roomCode,
        time: { ...newTime },
        outdated: false,
        supersededBy: undefined,
      };
      newSessions.push(newSession);
      summary.timeChanged++;
      pushChange('time-changed', session, {
        newSisClassNumber: row.classNbr!,
        sisSectionCode: row.sectionCode ?? undefined,
        oldTime: { ...session.time },
        newTime,
        newRoom: meeting.roomShort || session.roomCode,
        description:
          `${session.courseCode} ${session.sessionType} (${session.id}): time changed on SIS ` +
          `${session.time.startTime}-${session.time.endTime} → ${meeting.startTime}-${meeting.endTime}. ` +
          `Added a corrected entry and marked the old one outdated.`,
      });
      details.push(
        `${session.courseCode} ${session.sessionType} (${session.id}): time changed on SIS ` +
        `${session.time.startTime}-${session.time.endTime} → ${meeting.startTime}-${meeting.endTime}. ` +
        `Added a corrected entry and marked the old one outdated.`
      );
      nextSessions.push({ ...session, outdated: true, supersededBy: newSession.id });
      continue;
    }

    // 4) Couldn't confidently resolve — leave the session untouched.
    summary.ambiguous++;
    pushChange('ambiguous', session, {
      description:
        `${session.courseCode} ${session.sessionType} (${session.id}): ${candidates.length} SIS section(s) found ` +
        `but none/more than one share this session's day — needs manual review.`,
    });
    details.push(
      `${session.courseCode} ${session.sessionType} (${session.id}): ${candidates.length} SIS section(s) found ` +
      `but none/more than one share this session's day — needs manual review.`
    );
    nextSessions.push(session);
  }

  return {
    schedule: { ...schedule, sessions: [...nextSessions, ...newSessions] },
    summary,
    details,
    changes,
  };
}

/** Turns a SyncSisSummary into the one-line message shown in the app's
 *  notice banner (DataContext.lastError channel). */
export function formatSyncSummary(summary: SyncSisSummary): string {
  const parts: string[] = [];
  if (summary.matchedExact) parts.push(`${summary.matchedExact} confirmed`);
  if (summary.matchedOnline) parts.push(`${summary.matchedOnline} online (# updated)`);
  if (summary.timeChanged) parts.push(`${summary.timeChanged} time changed (new entry added)`);
  if (summary.ambiguous) parts.push(`${summary.ambiguous} ambiguous (needs review)`);
  if (summary.unmatched) parts.push(`${summary.unmatched} not found on SIS`);
  if (parts.length === 0) return 'SIS sync ran, but there were no active sessions to check.';
  return `SIS sync complete — ${parts.join(', ')}.`;
}
