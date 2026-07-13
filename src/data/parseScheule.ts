import * as XLSX from 'xlsx';
import type { MasterSchedule, ClassSession, ProgramGroup, SessionType, TimeSlot } from './types';

/**
 * Columns we expect (case‑insensitive). Any column not listed is ignored.
 */
const EXPECTED = [
    'term',
    'courseCode',
    'courseName',
    'sessionType',
    'targetGroups',
    'instructorName',
    'roomCode',
    'sisClassNumber',
    'dayOfWeek',
    'startTime',
    'endTime',
    'capacity',      // optional
    'enrolled',      // optional
    'statusOverride',// optional
] as const;

export function parseScheduleCSV(buffer: ArrayBuffer): MasterSchedule | null {
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return null;

  const sheet = wb.Sheets[sheetName];
  // raw: false → all cells come as the displayed string, no numeric room codes
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  if (rows.length < 2) return null;

  const headers = (rows[0] as string[]).map(h => String(h).trim().toLowerCase());
  const idx = (col: string) => headers.indexOf(col);
  if (idx('coursecode') === -1) return null;

  const sessions: ClassSession[] = [];
  const groupMap = new Map<string, ProgramGroup>();

  const cell = (row: any[], col: string, fallback = '') => {
    const i = idx(col);
    return i >= 0 ? String(row[i] ?? '').trim() : fallback;
  };

  const num = (row: any[], col: string): number | undefined => {
    const i = idx(col);
    if (i < 0) return undefined;
    const val = row[i];
    if (val === '' || val === undefined) return undefined;
    const n = Number(val);
    return Number.isFinite(n) ? n : undefined;
  };

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const term = cell(row, 'term');
    const courseCode = cell(row, 'coursecode');
    const courseName = cell(row, 'coursename');
    const sessionType = cell(row, 'sessiontype') as SessionType;
    const targetGroupsRaw = cell(row, 'targetgroups');
    const instructorName = cell(row, 'instructorname');
    const roomCode = cell(row, 'roomcode');
    const sisClassNumber = cell(row, 'sisclassnumber');
    const dayOfWeek = cell(row, 'dayofweek') as TimeSlot['dayOfWeek'];
    const startTime = cell(row, 'starttime');
    const endTime = cell(row, 'endtime');

    if (!courseCode || !term || !sessionType || !dayOfWeek || !startTime || !endTime) continue;

    const groupNames = targetGroupsRaw
      .split(/[|,]/)
      .map(g => g.trim())
      .filter(Boolean);

    for (const name of groupNames) {
      if (!groupMap.has(name)) {
        groupMap.set(name, { id: name, name, department: '' });
      }
    }

    sessions.push({
      id: `${courseCode}-${sisClassNumber}-${i}`,
      term,
      targetGroups: groupNames,
      courseCode,
      courseName,
      sessionType,
      instructorName,
      roomCode,
      sisClassNumber,
      time: { dayOfWeek, startTime, endTime },
      capacity: num(row, 'capacity'),
      enrolled: num(row, 'enrolled'),
      statusOverride: cell(row, 'statusoverride') as ClassSession['statusOverride'] || undefined,
    });
  }

  if (sessions.length === 0) return null;

  return {
    term: sessions[0].term ?? '',
    groups: Array.from(groupMap.values()),
    sessions,
  };
}