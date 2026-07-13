/**
 * Roster Excel parser — v2.
 *
 * Reads a one-row-per-student sheet and returns the canonical roster.
 * Required: `student_id`. Optional: `student_name`, `major`, `email`,
 * `national_id`. Headers are case-insensitive and tolerant of synonyms
 * the user's Python pipeline used (`ID`, `student id`, `full name`,
 * `program`, `national id`, etc.).
 *
 * Duplicate ids: the LAST row wins. A console.warn logs how many ids
 * collided so the user can fix the file if it wasn't intentional.
 */

import * as XLSX from 'xlsx';
import type { RosterEntry } from './types';

const HEADER_SYNONYMS: Record<string, string[]> = {
  studentId: ['student_id', 'studentid', 'id', 'student id', 'student number'],
  studentName: ['student_name', 'studentname', 'name', 'full_name', 'full name'],
  major: ['major', 'program', 'department'],
  // Roster identity fields. Header variants cover camelCase, spaced,
  // and the more verbose names users tend to write when filling out
  // spreadsheets by hand.
  email: ['email', 'e-mail', 'email address', 'mail'],
  nationalId: [
    'nationalid',
    'national_id',
    'national id',
    'nationalid number',
    'ssn',
    'id number',
  ],
  phone: [                                    // <-- add this block
    'phone',
    'phone number',
    'phone_number',
    'phonenumber',
    'mobile',
    'cell',
    'telephone',
  ],
  sisPwd: [
    'sispwd',
    'sis_pwd',
    'sis password',
    'sis_password',
    'sispassword',
  ],
};

/**
 * Parse the first worksheet of an Excel ArrayBuffer into a roster.
 * Drops rows without a `student_id`. Deduplicates by id (last row wins).
 */
export function parseRoster(buffer: ArrayBuffer): RosterEntry[] {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
  });

  const byId = new Map<string, RosterEntry>();
  let dupes = 0;
  for (const row of jsonRows) {
    const entry = mapRow(row);
    if (!entry) continue;
    if (byId.has(entry.studentId)) dupes++;
    byId.set(entry.studentId, entry);
  }
  if (dupes > 0) {
    // eslint-disable-next-line no-console
    console.warn(`parseRoster: ${dupes} duplicate student_id(s) collapsed (last row wins)`);
  }

  return Array.from(byId.values()).sort((a, b) =>
    a.studentId.localeCompare(b.studentId)
  );
}

function mapRow(row: Record<string, unknown>): RosterEntry | null {
  const get = (...keys: string[]): string => {
    for (const key of Object.keys(row)) {
      const normalized = key.toLowerCase().trim();
      if (keys.includes(normalized)) {
        const value = row[key];
        if (value === null || value === undefined) return '';
        return String(value).trim();
      }
    }
    return '';
  };

  const studentId = get(...HEADER_SYNONYMS.studentId);
  if (!studentId) return null;

  const studentName = get(...HEADER_SYNONYMS.studentName) || undefined;
  const major = get(...HEADER_SYNONYMS.major) || undefined;
  const email = get(...HEADER_SYNONYMS.email) || undefined;
  const nationalId = get(...HEADER_SYNONYMS.nationalId) || undefined;
  const phone = get(...HEADER_SYNONYMS.phone) || undefined;  // <-- add this
  const sisPwd = get(...HEADER_SYNONYMS.sisPwd) || undefined;

  return { studentId, studentName, major, email, nationalId, phone, sisPwd };
}
