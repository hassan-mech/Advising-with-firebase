/**
 * Plan export to Excel.
 * ... (original doc comment unchanged, except the row description now mentions the new fields)
 */

import * as XLSX from 'xlsx';
import type {
  CatalogCourse,
  CourseCatalog,
  DataState,
  GradeRow,
  Term,
} from './types';
import {
  compareTerms,
  didStudentFailCourse,
  didStudentPassCourse,
  lastTermGpa,
  totalPassedUnits,
  totalFailedUnits,
  
} from './metrics';
import { normalizeCourseCodeLoose } from './normalize';

// ---------------------------------------------------------------------------
// Course classification (unchanged)
// ---------------------------------------------------------------------------

export type PlanCourseStatus = 'new' | 'enhancing' | 'repeated';

export function planCourseStatus(
  rows: GradeRow[],
  studentId: string,
  courseCode: string
): PlanCourseStatus {
  if (didStudentFailCourse(rows, studentId, courseCode)) return 'repeated';
  if (didStudentPassCourse(rows, studentId, courseCode)) return 'enhancing';
  return 'new';
}

// ---------------------------------------------------------------------------
// Row types + column layout
// ---------------------------------------------------------------------------

export interface PlanExportRow {
  student_id: string;
  student_name: string;
  email: string;
  national_id: string;
  phone: string;          // <-- add this
  major: string;
  level: string;
  term: string;
  course_code: string;
  course_title: string;
  credits: number;
  new_ch: 0 | 1;
  enhancing_ch: 0 | 1;
  repeated_ch: 0 | 1;
  status: string;
  cumulative_gpa: number;
  earned_hours: number;
  earned_points: number;      // cumulative_gpa * earned_hours
  prerequisites: string;      // comma-separated list
}

const TERM_COLUMNS = [
  'student_id',
  'student_name',
  'email',
  'national_id',
  'phone',         // <-- add here
  'major',
  'level',
  'term',
  'course_code',
  'course_title',
  'credits',
  'new_ch',
  'enhancing_ch',
  'repeated_ch',
  'status',
  'cumulative_gpa',
  'earned_hours',
  'earned_points',
  'prerequisites',
] as const;

export interface FailedExportRow {
  student_id: string;
  student_name: string;
  email: string;
  national_id: string;
  major: string;
  level: string;
  term: string;
  course_code: string;
  course_title: string;
  credits: number;
  grade: string;
  status: 'failed';
}

const FAILED_COLUMNS = [
  'student_id',
  'student_name',
  'email',
  'national_id',
  'major',
  'level',
  'term',
  'course_code',
  'course_title',
  'credits',
  'grade',
  'status',
] as const;

// Excel-illegal sheet-name characters
const ILLEGAL_SHEET_CHARS = /[\\/?*[\]:]/g;
const FAILED_SHEET_NAME = 'Failed Courses';

// ---------------------------------------------------------------------------
// Helpers (unchanged except for new pre‑computed metrics map)
// ---------------------------------------------------------------------------

function indexCatalog(catalog: CourseCatalog | null): Map<string, CatalogCourse> {
  const map = new Map<string, CatalogCourse>();
  if (!catalog) return map;
  for (const c of catalog.courses) {
    map.set(normalizeCourseCodeLoose(c.code), c);
  }
  return map;
}

function mostRecentAttempt(
  rows: GradeRow[],
  studentId: string,
  courseCode: string
): GradeRow | undefined {
  const norm = normalizeCourseCodeLoose(courseCode);
  const attempts = rows.filter(
    (r) => r.studentId === studentId && normalizeCourseCodeLoose(r.course) === norm
  );
  if (attempts.length === 0) return undefined;
  return attempts.slice().sort((a, b) => compareTerms(b.term, a.term))[0];
}

function identityFor(state: DataState, studentId: string): {
  name: string;
  email: string;
  nationalId: string;
  phone: string;            // <-- add
  major: string;
} {
  const rosterMatch = state.roster.find((r) => r.studentId === studentId);
  const gradeMatch = state.rows.find((r) => r.studentId === studentId);
  return {
    name:
      rosterMatch?.studentName?.trim() ||
      gradeMatch?.studentName?.trim() ||
      `Student ${studentId}`,
    email: rosterMatch?.email?.trim() || '',
    nationalId: rosterMatch?.nationalId?.trim() || '',
    phone: rosterMatch?.phone?.trim() || '',   // <-- add
    major:
      rosterMatch?.major?.trim() ||
      gradeMatch?.major?.trim() ||
      'Undeclared',
  };
}

function levelFor(state: DataState, studentId: string): string {
  const passed = totalPassedUnits(state.rows, studentId);
  const gpa = lastTermGpa(state.rows, studentId);
  if (passed < 33) return 'Level 0';
  if (passed < 66) return 'Level 1';
  if (passed < 99) return 'Level 2';
  if (passed < 132) return 'Level 3';
  if (passed < 165) return 'Level 4';
  if (passed === 165) return gpa >= 2 ? 'Graduated' : 'ERROR';
  return 'ERROR';
}

/**
 * Pre‑computed per‑student metrics we attach to every row.
 * Avoids calling the expensive metric functions for each (student, course) pair.
 */
interface StudentExportMetrics {
  gpa: number;
  earnedHours: number;
  earnedPoints: number;
}

/**
 * Build a lookup of student metrics from the DataState.
 * Only the students present in the terms are processed.
 */
function buildStudentMetrics(state: DataState): Map<string, StudentExportMetrics> {
  const students = new Set<string>();
  for (const term of state.terms) {
    for (const entry of term.entries) {
      students.add(entry.studentId);
    }
  }
  // Also add any student who has grade rows (for the Failed sheet, etc.)
  // but we only need them for the term sheets, so the set above is enough.
  const map = new Map<string, StudentExportMetrics>();
  for (const studentId of students) {
    const gpa = lastTermGpa(state.rows, studentId);
    const earnedHours = totalPassedUnits(state.rows, studentId) + totalFailedUnits(state.rows, studentId); // ← changed
    const earnedPoints = +(gpa * earnedHours).toFixed(2);
    map.set(studentId, { gpa, earnedHours, earnedPoints });
  }
  return map;
}

function rowFor(
  state: DataState,
  term: Term,
  studentId: string,
  courseCode: string,
  catalogIndex: Map<string, CatalogCourse>,
  metrics: StudentExportMetrics
): PlanExportRow {
  const id = identityFor(state, studentId);
  const cat = catalogIndex.get(normalizeCourseCodeLoose(courseCode));
  const classification = planCourseStatus(state.rows, studentId, courseCode);

  // Prerequisites from the catalog (string[] -> comma separated)
  const prereqs = cat?.prerequisites?.length ? cat.prerequisites.join(', ') : '';

  return {
    student_id: studentId,
    student_name: id.name,
    email: id.email,
    national_id: id.nationalId,
    phone: id.phone,          // <-- add this line
    major: id.major,
    level: levelFor(state, studentId),
    term: term.name,
    course_code: courseCode,
    course_title: cat?.title ?? '',
    credits: cat?.credits ?? 0,
    new_ch: classification === 'new' ? 1 : 0,
    enhancing_ch: classification === 'enhancing' ? 1 : 0,
    repeated_ch: classification === 'repeated' ? 1 : 0,
    status: cat ? 'planned' : 'planned (not in catalog)',
    cumulative_gpa: metrics.gpa,
    earned_hours: metrics.earnedHours,
    earned_points: metrics.earnedPoints,
    prerequisites: prereqs,
  };
}

function failedRowFor(
  state: DataState,
  studentId: string,
  courseCode: string,
  catalogIndex: Map<string, CatalogCourse>
): FailedExportRow | null {
  const attempt = mostRecentAttempt(state.rows, studentId, courseCode);
  if (!attempt || !didStudentFailCourse(state.rows, studentId, courseCode)) {
    return null;
  }
  const id = identityFor(state, studentId);
  const cat = catalogIndex.get(normalizeCourseCodeLoose(courseCode));
  return {
    student_id: studentId,
    student_name: id.name,
    email: id.email,
    national_id: id.nationalId,
    major: id.major,
    level: levelFor(state, studentId),
    term: attempt.term,
    course_code: courseCode,
    course_title: cat?.title ?? '',
    credits: cat?.credits ?? attempt.units,
    grade: attempt.grade,
    status: 'failed',
  };
}

/**
 * Build an XLSX workbook from the planner state.
 */
export function buildPlansWorkbook(state: DataState): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const catalogIndex = indexCatalog(state.catalog);
  const studentMetrics = buildStudentMetrics(state);

  for (const term of state.terms) {
    const rows: PlanExportRow[] = [];
    for (const entry of term.entries) {
      const metrics = studentMetrics.get(entry.studentId);
      if (!metrics) continue; // student not found (shouldn't happen)
      for (const code of entry.courseCodes) {
        rows.push(rowFor(state, term, entry.studentId, code, catalogIndex, metrics));
      }
    }
    if (rows.length === 0) continue;

    const ws = XLSX.utils.json_to_sheet(rows, { header: [...TERM_COLUMNS] });
    ws['!cols'] = [
      { wch: 12 }, // student_id
      { wch: 24 }, // student_name
      { wch: 28 }, // email
      { wch: 18 }, // national_id
      { wch: 20 }, // phone
      { wch: 26 }, // major
      { wch: 12 }, // level
      { wch: 14 }, // term
      { wch: 12 }, // course_code
      { wch: 36 }, // course_title
      { wch: 8 },  // credits
      { wch: 8 },  // new_ch
      { wch: 12 }, // enhancing_ch
      { wch: 12 }, // repeated_ch
      { wch: 24 }, // status
      { wch: 14 }, // cumulative_gpa
      { wch: 14 }, // earned_hours
      { wch: 16 }, // earned_points
      { wch: 40 }, // prerequisites
    ];

    const safeName =
      (term.name || 'Term')
        .replace(ILLEGAL_SHEET_CHARS, '_')
        .slice(0, 31) || 'Term';
    XLSX.utils.book_append_sheet(wb, ws, safeName);
  }

  // Failed-courses sheet (unchanged)
  const failedRows: FailedExportRow[] = [];
  const seen = new Set<string>();
  for (const r of state.rows) {
    const code = normalizeCourseCodeLoose(r.course);
    if (!code) continue;
    if (!didStudentFailCourse(state.rows, r.studentId, code)) continue;
    const key = `${r.studentId}|${code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = failedRowFor(state, r.studentId, code, catalogIndex);
    if (row) failedRows.push(row);
  }

  // Sort by student_id first and then course_code in ascending alphabetical order
  failedRows.sort((a, b) => {
    const studentComp = a.student_id.localeCompare(b.student_id);
    if (studentComp !== 0) return studentComp;
    return a.course_code.localeCompare(b.course_code);
  });

  if (failedRows.length > 0) {
    const wsFailed = XLSX.utils.json_to_sheet(failedRows, { header: [...FAILED_COLUMNS] });
    wsFailed['!cols'] = [
      { wch: 12 }, { wch: 24 }, { wch: 28 }, { wch: 18 }, { wch: 26 },
      { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 36 }, { wch: 8 },
      { wch: 8 },  { wch: 10 },
    ];
    XLSX.utils.book_append_sheet(wb, wsFailed, FAILED_SHEET_NAME);
  }

  return wb;
}

export function exportPlansFile(state: DataState): void {
  const wb = buildPlansWorkbook(state);
  if (wb.SheetNames.length === 0) return;
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `plans-${date}.xlsx`);
}