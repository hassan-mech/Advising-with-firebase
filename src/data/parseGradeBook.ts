/**
 * Grade-book Excel parser — v2.
 *
 * Pure function: takes an ArrayBuffer from a File, returns GradeRow[].
 * Header matching is case-insensitive and tolerant of synonyms the
 * user's Python pipeline used (Student_ID / student_id / id, course /
 * course_code, etc.). Rows missing both student_id and course are
 * silently dropped.
 */

import * as XLSX from 'xlsx';
import type { GradeRow } from './types';
import { normalizeCourseCodeLoose } from './normalize';

const HEADER_SYNONYMS: Record<string, string[]> = {
  studentId: ['student_id', 'studentid', 'id', 'student id'],
  studentName: ['student_name', 'studentname', 'name'],
  major: ['major', 'department'],
  course: ['course', 'course_code', 'coursecode'],
  units: ['units', 'unit', 'credit_hours', 'credits', 'credit hours'],
  grade: ['grade', 'final_grade', 'finalgrade'],
  term: ['term', 'semester'],
  cumulativeGpa: ['cumulative_gpa', 'cum_gpa', 'cgpa', 'gpa'],
};

/**
 * Parse the first worksheet of an Excel ArrayBuffer into GradeRow[].
 */
export function parseGradeBook(buffer: ArrayBuffer): GradeRow[] {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
  });
  

  return jsonRows
    .map((row) => mapRow(row))
    .filter((r): r is GradeRow => r !== null);
}

/**
 * Detect whether a worksheet's first row matches the grade-book shape.
 * Used by `parseGradeBookOrCatalog` if we ever want to auto-detect;
 * kept around because the column-synonym logic is reused later.
 */
export function looksLikeGradeBook(
  rows: Array<Record<string, unknown>>
): boolean {
  if (rows.length === 0) return false;
  const keys = new Set(
    Object.keys(rows[0]).map((k) => k.toLowerCase().trim())
  );
  const hasStudentId = HEADER_SYNONYMS.studentId.some((s) => keys.has(s));
  const hasCourse = HEADER_SYNONYMS.course.some((s) => keys.has(s));
  const hasGrade = HEADER_SYNONYMS.grade.some((s) => keys.has(s));
  return Boolean(hasStudentId && hasCourse && hasGrade);
}

function mapRow(row: Record<string, unknown>): GradeRow | null {
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
  const course = get(...HEADER_SYNONYMS.course);
  if (!studentId || !course) return null;

  const unitsRaw = get(...HEADER_SYNONYMS.units);
  const units = parseNumber(unitsRaw);

  const gradeRaw = get(...HEADER_SYNONYMS.grade);
  if (!gradeRaw) return null;
  const grade = gradeRaw.toUpperCase();

  const term = get(...HEADER_SYNONYMS.term);
  const cumulativeGpaRaw = get(...HEADER_SYNONYMS.cumulativeGpa);
  const cumulativeGpa = cumulativeGpaRaw ? parseNumber(cumulativeGpaRaw) : undefined;

  const studentName = get(...HEADER_SYNONYMS.studentName) || undefined;
  const major = get(...HEADER_SYNONYMS.major) || undefined;

  return {
    studentId,
    studentName,
    major,
    // Loose-normalize: collapses "MEC 11" and "MEC011" to the same
    // key so the catalog/grade-book join succeeds without manual
    // re-typing. Without this the join silently misses on a
    // grade-book that uses "MEC 11" for a catalog keyed under
    // "MEC011".
    course: normalizeCourseCodeLoose(course),
    units,
    grade,
    term,
    cumulativeGpa,
  };
}

function parseNumber(input: string | number | undefined | null): number {
  if (input === undefined || input === null || input === '') return 0;
  if (typeof input === 'number') return input;
  const n = Number(input);
  return Number.isFinite(n) ? n : 0;
}
