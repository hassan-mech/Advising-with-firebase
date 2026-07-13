/**
 * Unit tests for buildPlansWorkbook + exportPlansFile.
 *
 * Both functions accept a fully-formed DataState and return either
 * a workbook object (pure) or trigger a browser download (DOM-side).
 * We test the pure one in vitest by converting the returned workbook
 * back into JSON and asserting row counts + column layout.
 */

import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import type { CatalogCourse, CourseCatalog, DataState, GradeRow, Term } from './types';
import { buildPlansWorkbook } from './exportPlans';

const rows: GradeRow[] = [
  {
    studentId: 'S1',
    studentName: 'Hassan',
    major: 'Mechatronics Engineering',
    course: 'MAT101',
    units: 3,
    grade: 'A',
    term: 'Fall 2024',
  },
  {
    studentId: 'S2',
    studentName: 'Sara',
    major: 'Civil Engineering',
    course: 'MAT101',
    units: 3,
    grade: 'B',
    term: 'Fall 2024',
  },
];

const catalog: CourseCatalog = {
  courses: [
    { code: 'MAT101', title: 'Calculus I', credits: 3, prerequisites: [] },
    { code: 'MEC011', title: 'Intro to Mechatronics', credits: 4, prerequisites: [] },
    { code: 'CHE101', title: 'Chemistry', credits: 3, prerequisites: [] },
  ] as CatalogCourse[],
};

const terms: Term[] = [
  {
    id: 't-summer',
    name: 'Summer 2025',
    createdAt: '2025-01-01T00:00:00Z',
    entries: [
      { studentId: 'S1', courseCodes: ['MEC011', 'CHE101'] },
      { studentId: 'S2', courseCodes: ['MEC011'] },
    ],
  },
  {
    id: 't-fall',
    name: 'Fall 2025',
    createdAt: '2025-06-01T00:00:00Z',
    entries: [{ studentId: 'S1', courseCodes: ['CHE101'] }],
  },
  // Empty term — should not produce a sheet.
  {
    id: 't-empty',
    name: 'Spring 2026',
    createdAt: '2026-01-01T00:00:00Z',
    entries: [],
  },
];

const state: DataState = {
  rows,
  catalog,
  roster: [
    {
      studentId: 'S1',
      studentName: 'Hassan',
      major: 'Mechatronics Engineering',
      email: 'hassan@nmu.edu.eg',
      nationalId: '30101010101010',
    },
    {
      studentId: 'S2',
      studentName: 'Sara',
      major: 'Civil Engineering',
      email: 'sara@nmu.edu.eg',
      nationalId: '30202020202020',
    },
  ],
  terms,
  activeTermId: 't-summer',
  masterSchedule: null,
};

function readSheet(wb: XLSX.WorkBook, name: string): Array<Record<string, unknown>> {
  const ws = wb.Sheets[name];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
}

describe('buildPlansWorkbook', () => {
  it('emits one sheet per non-empty term', () => {
    const wb = buildPlansWorkbook(state);
    expect(wb.SheetNames).toEqual(['Summer 2025', 'Fall 2025']);
  });

  it('writes one row per planned course inside a term', () => {
    const wb = buildPlansWorkbook(state);
    const summer = readSheet(wb, 'Summer 2025');
    expect(summer).toHaveLength(3); // S1 has 2, S2 has 1
    expect(summer.map((r) => r.student_id).sort()).toEqual(['S1', 'S1', 'S2']);
    expect(summer.map((r) => r.course_code).sort()).toEqual(['CHE101', 'MEC011', 'MEC011']);
  });

  it('fills student_name + major from the roster', () => {
    const wb = buildPlansWorkbook(state);
    const summer = readSheet(wb, 'Summer 2025');
    const s1Mec = summer.find(
      (r) => r.student_id === 'S1' && r.course_code === 'MEC011'
    );
    expect(s1Mec?.student_name).toBe('Hassan');
    expect(s1Mec?.major).toBe('Mechatronics Engineering');
    expect(s1Mec?.term).toBe('Summer 2025');
  });

  it('looks up catalog title + credits for each course', () => {
    const wb = buildPlansWorkbook(state);
    const summer = readSheet(wb, 'Summer 2025');
    const s1Che = summer.find(
      (r) => r.student_id === 'S1' && r.course_code === 'CHE101'
    );
    expect(s1Che?.course_title).toBe('Chemistry');
    expect(s1Che?.credits).toBe(3);
    expect(s1Che?.status).toBe('planned');
  });

  it('falls back to roster name with "Undeclared" when not present', () => {
    const wb = buildPlansWorkbook({
      ...state,
      terms: [
        {
          id: 't1',
          name: 'Test',
          createdAt: '2025-01-01T00:00:00Z',
          entries: [{ studentId: 'S3', courseCodes: ['MAT101'] }],
        },
      ],
    });
    const sheet = readSheet(wb, 'Test');
    const row = sheet[0];
    expect(row.student_id).toBe('S3');
    // S3 is not in the rows fixture or the roster, so the name is
    // auto-generated and the major is "Undeclared".
    expect(row.student_name).toBe('Student S3');
    expect(row.major).toBe('Undeclared');
    expect(row.course_title).toBe('Calculus I');
  });

  it('returns a workbook with no sheets when every term is empty', () => {
    const wb = buildPlansWorkbook({
      ...state,
      terms: [
        { id: 'a', name: 'A', createdAt: '', entries: [] },
        { id: 'b', name: 'B', createdAt: '', entries: [] },
      ],
    });
    expect(wb.SheetNames).toEqual([]);
  });

  it('sanitises Excel-illegal characters in term names', () => {
    const wb = buildPlansWorkbook({
      ...state,
      terms: [
        {
          id: 't1',
          name: 'Fall/2025: [cohort]',
          createdAt: '',
          entries: [{ studentId: 'S1', courseCodes: ['MEC011'] }],
        },
      ],
    });
    // Sheet-name max length is 31, but more importantly the
    // illegal-char replace should kick in.
    expect(wb.SheetNames).toHaveLength(1);
    expect(wb.SheetNames[0]).not.toMatch(/[\\/?*[\]:]/);
  });

  it('passes email + nationalId + level through to the term sheet', () => {
    const wb = buildPlansWorkbook(state);
    const summer = readSheet(wb, 'Summer 2025');
    const s1Mec = summer.find(
      (r) => r.student_id === 'S1' && r.course_code === 'MEC011'
    );
    expect(s1Mec?.email).toBe('hassan@nmu.edu.eg');
    expect(s1Mec?.national_id).toBe('30101010101010');
    // S1's only passing attempt is MAT101 (3 cr) — that puts them at
    // Level 0 in the export's level formula.
    expect(s1Mec?.level).toBe('Level 0');
  });

  it('marks New / Enhancing / Repeated on the planned course rows', () => {
    const wb = buildPlansWorkbook({
      ...state,
      terms: [
        {
          id: 't-mixed',
          name: 'Mixed',
          createdAt: '',
          entries: [
            // MAT101 — S1 already passed → enhancing
            // PHY101 — S1 never attempted → new
            // CHE101 — pretend S1 failed it before, with the retry now on the plan → repeated
            { studentId: 'S1', courseCodes: ['MAT101', 'PHY101', 'CHE101'] },
          ],
        },
      ],
      // Inject a failed CHE101 attempt so the "Repeated" branch has
      // data. PHY101 is NOT in the rows fixture — S1 hasn't attempted
      // it yet, so its classification is "new".
      rows: [
        ...rows,
        {
          studentId: 'S1',
          course: 'CHE101',
          units: 3,
          grade: 'F',
          term: 'Spring 2025',
        },
      ],
    });
    const mixed = readSheet(wb, 'Mixed');
    const get = (code: string) => mixed.find((r) => r.course_code === code);
    expect(get('MAT101')?.enhancing_ch).toBe(1);
    expect(get('MAT101')?.new_ch).toBe(0);
    expect(get('MAT101')?.repeated_ch).toBe(0);
    expect(get('PHY101')?.new_ch).toBe(1);
    expect(get('PHY101')?.enhancing_ch).toBe(0);
    expect(get('PHY101')?.repeated_ch).toBe(0);
    expect(get('CHE101')?.repeated_ch).toBe(1);
    expect(get('CHE101')?.new_ch).toBe(0);
    expect(get('CHE101')?.enhancing_ch).toBe(0);
  });

  it('appends a Failed Courses sheet listing every (student, course) failure', () => {
    const stateWithFails: DataState = {
      ...state,
      rows: [
        ...rows,
        // S1 fails MEC011; S1 fails CHE101; S2 fails MAT101. Note:
        // S2 had previously passed MAT101 in Fall 2024 (base fixture);
        // we replace that with a fail-by-overwrite simulation by
        // keeping the pass — the failed set used by the export is
        // computed at runtime from `didStudentFailCourse`, which
        // returns FALSE when ANY attempt passed. To keep the test
        // deterministic, we use a course S2 hasn't attempted before
        // (PHY101) and force a failed attempt on it.
        {
          studentId: 'S1',
          studentName: 'Hassan',
          major: 'Mechatronics Engineering',
          course: 'MEC011',
          units: 4,
          grade: 'F',
          term: 'Spring 2025',
        },
        {
          studentId: 'S1',
          studentName: 'Hassan',
          major: 'Mechatronics Engineering',
          course: 'CHE101',
          units: 3,
          grade: 'FD',
          term: 'Spring 2025',
        },
        {
          studentId: 'S2',
          studentName: 'Sara',
          major: 'Civil Engineering',
          course: 'PHY101',
          units: 3,
          grade: 'F',
          term: 'Spring 2025',
        },
      ],
    };
    const wb = buildPlansWorkbook(stateWithFails);
    // The Failed Courses sheet is appended AFTER the per-term sheets.
    expect(wb.SheetNames).toEqual(['Summer 2025', 'Fall 2025', 'Failed Courses']);
    const failed = readSheet(wb, 'Failed Courses');
    // 3 (student, course) failures — sorted by student id then code.
    expect(failed).toHaveLength(3);
    expect(failed[0].student_id).toBe('S1');
    expect(failed[0].course_code).toBe('CHE101');
    expect(failed[0].grade).toBe('FD');
    expect(failed[0].status).toBe('failed');
    expect(failed[0].credits).toBe(3); // catalog hit
    expect(failed[0].level).toBe('Level 0');
    expect(failed[0].email).toBe('hassan@nmu.edu.eg');
    expect(failed[0].national_id).toBe('30101010101010');
    expect(failed[1].student_id).toBe('S1');
    expect(failed[1].course_code).toBe('MEC011');
    expect(failed[2].student_id).toBe('S2');
    expect(failed[2].course_code).toBe('PHY101');
  });

  it('does NOT emit a Failed Courses sheet when the grade-book has no failures', () => {
    const wb = buildPlansWorkbook(state);
    // The base fixture has no failed courses anywhere — so the Failed
    // Courses sheet should be absent.
    expect(wb.SheetNames).not.toContain('Failed Courses');
  });
});
