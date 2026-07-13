/**
 * Unit tests for syncSisClassNumbers — the matching rules that update
 * ClassSession.sisClassNumber from a scraped classNumbers.json.
 */

import { describe, it, expect } from 'vitest';
import type { ClassSession, MasterSchedule } from './types';
import {
  parseSisClassNumbersJson,
  syncSisClassNumbers,
  formatSyncSummary,
  type SisClassRow,
} from './syncSis';

function session(partial: Partial<ClassSession>): ClassSession {
  return {
    id: 'S1',
    term: 'Fall 2026',
    targetGroups: [],
    courseCode: 'MEC041',
    courseName: 'Dynamics',
    sessionType: 'LEC',
    instructorName: 'Dr. Ahmed',
    roomCode: '2-2-72',
    sisClassNumber: '',
    time: { dayOfWeek: 'Monday', startTime: '09:00', endTime: '10:40' },
    ...partial,
  };
}

function schedule(sessions: ClassSession[]): MasterSchedule {
  return { term: 'Fall 2026', groups: [], sessions };
}

function sisRow(partial: Partial<SisClassRow>): SisClassRow {
  return {
    courseCode: 'MEC041',
    sectionCode: 'L1E',
    sessionType: 'LEC',
    classNbr: '1149',
    meetings: [{ day: 'Monday', startTime: '09:00', endTime: '10:40', roomShort: '2-2-72' }],
    ...partial,
  };
}

describe('parseSisClassNumbersJson', () => {
  it('parses a well-formed classNumbers.json array', () => {
    const rows = parseSisClassNumbersJson(JSON.stringify([sisRow({})]));
    expect(rows).toHaveLength(1);
    expect(rows[0].classNbr).toBe('1149');
  });

  it('throws a friendly error on invalid JSON', () => {
    expect(() => parseSisClassNumbersJson('{not json')).toThrow(/valid JSON/);
  });

  it('throws when the JSON is not an array', () => {
    expect(() => parseSisClassNumbersJson('{}')).toThrow(/array/);
  });

  it('skips entries without a courseCode', () => {
    const rows = parseSisClassNumbersJson(JSON.stringify([{ classNbr: '1' }, sisRow({})]));
    expect(rows).toHaveLength(1);
  });
});

describe('syncSisClassNumbers', () => {
  it('updates sisClassNumber in place on an exact day+time match', () => {
    const sched = schedule([session({ id: 'A', sisClassNumber: 'OLD' })]);
    const { schedule: out, summary } = syncSisClassNumbers(sched, [sisRow({})]);
    expect(summary.matchedExact).toBe(1);
    expect(summary.timeChanged).toBe(0);
    expect(out.sessions).toHaveLength(1);
    expect(out.sessions[0].sisClassNumber).toBe('1149');
    expect(out.sessions[0].outdated).toBeFalsy();
  });

  it('updates in place (no new entry) when the SIS section is online', () => {
    const sched = schedule([session({ id: 'A', sisClassNumber: 'OLD' })]);
    const online = sisRow({ classNbr: '9999', meetings: [] });
    const { schedule: out, summary } = syncSisClassNumbers(sched, [online]);
    expect(summary.matchedOnline).toBe(1);
    expect(out.sessions).toHaveLength(1);
    expect(out.sessions[0].sisClassNumber).toBe('9999');
    expect(out.sessions[0].time).toEqual(session({}).time); // time untouched
  });

  it('adds a corrected new entry and marks the old one outdated when the time changed', () => {
    const sched = schedule([session({ id: 'A', sisClassNumber: 'OLD' })]);
    const moved = sisRow({
      classNbr: '2222',
      meetings: [{ day: 'Monday', startTime: '11:00', endTime: '12:40', roomShort: '3-1-10' }],
    });
    const { schedule: out, summary } = syncSisClassNumbers(sched, [moved]);
    expect(summary.timeChanged).toBe(1);
    expect(out.sessions).toHaveLength(2);

    const old = out.sessions.find(s => s.id === 'A')!;
    expect(old.outdated).toBe(true);
    expect(old.sisClassNumber).toBe('OLD'); // old entry's own number is untouched

    const fresh = out.sessions.find(s => s.id !== 'A')!;
    expect(fresh.sisClassNumber).toBe('2222');
    expect(fresh.time).toEqual({ dayOfWeek: 'Monday', startTime: '11:00', endTime: '12:40' });
    expect(fresh.outdated).toBeFalsy();
    expect(old.supersededBy).toBe(fresh.id);
  });

  it('leaves the session untouched when no SIS row matches the course+type', () => {
    const sched = schedule([session({ id: 'A' })]);
    const { schedule: out, summary } = syncSisClassNumbers(sched, [sisRow({ courseCode: 'CIV113' })]);
    expect(summary.unmatched).toBe(1);
    expect(out.sessions).toEqual(sched.sessions);
  });

  it('flags ambiguous when multiple candidates share no clear day match', () => {
    const sched = schedule([session({ id: 'A' })]); // Monday 09:00-10:40
    const candidates = [
      sisRow({ classNbr: '1', meetings: [{ day: 'Tuesday', startTime: '09:00', endTime: '10:40', roomShort: 'X' }] }),
      sisRow({ classNbr: '2', meetings: [{ day: 'Wednesday', startTime: '09:00', endTime: '10:40', roomShort: 'Y' }] }),
    ];
    const { schedule: out, summary } = syncSisClassNumbers(sched, candidates);
    expect(summary.ambiguous).toBe(1);
    expect(out.sessions[0].sisClassNumber).toBe(''); // untouched
  });

  it('only matches within the same session type (LEC vs LAB)', () => {
    const sched = schedule([session({ id: 'A', sessionType: 'LEC' })]);
    const labOnly = sisRow({ sectionCode: 'LB1E', sessionType: 'LAB', classNbr: '5' });
    const { summary } = syncSisClassNumbers(sched, [labOnly]);
    expect(summary.unmatched).toBe(1);
  });

  it('ignores section codes that do not match the recognized L/T/LB/B pattern', () => {
    const sched = schedule([session({ id: 'A' })]);
    const weirdSection = sisRow({ sectionCode: 'COMBINED-1', classNbr: '5' });
    const { summary } = syncSisClassNumbers(sched, [weirdSection]);
    expect(summary.unmatched).toBe(1);
  });

  it('skips already-outdated sessions entirely', () => {
    const sched = schedule([session({ id: 'A', outdated: true, sisClassNumber: 'OLD' })]);
    const { schedule: out, summary } = syncSisClassNumbers(sched, [sisRow({})]);
    expect(summary.skippedOutdated).toBe(1);
    expect(out.sessions[0].sisClassNumber).toBe('OLD');
  });
});

describe('formatSyncSummary', () => {
  it('produces a readable one-liner', () => {
    const msg = formatSyncSummary({
      matchedExact: 3,
      matchedOnline: 1,
      timeChanged: 2,
      ambiguous: 0,
      unmatched: 1,
      skippedOutdated: 0,
    });
    expect(msg).toContain('3 confirmed');
    expect(msg).toContain('2 time changed');
    expect(msg).toContain('1 not found');
    expect(msg).not.toContain('ambiguous');
  });

  it('handles the all-zero case', () => {
    const msg = formatSyncSummary({
      matchedExact: 0, matchedOnline: 0, timeChanged: 0, ambiguous: 0, unmatched: 0, skippedOutdated: 0,
    });
    expect(msg).toMatch(/no active sessions/);
  });
});
