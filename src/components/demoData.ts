/**
 * Demo dataset used by the dev-only "Generate demo rows" button.
 *
 * Three students (Sara / Omar / Lina), a handful of graded courses,
 * a couple of failures so advising queries have something to show,
 * AND a tiny course catalog so the prereq-map renders properly
 * without forcing the user to import a real Excel first.
 *
 * Catalog majors are aligned with the canonical set the
 * `MAJOR_PLAN_COLUMNS` map in `parseCatalog.ts` knows about —
 * keep them in lock-step so a real Excel that uses the same names
 * renders identically.
 */

import type { CatalogCourse, CourseCatalog, GradeRow } from '../data/types';

// Nine majors in the same positional order as MAJOR_PLAN_COLUMNS in
// parseCatalog.ts so the demo layout mirrors what a real 9-major
// Excel produces.
const DEMO_MAJORS = [
  'Petrol and Gas Engineering',
  'Environmental Architecture',
  'Aerospace Engineering',
  'Civil Engineering',
  'Mechatronics Engineering',
  'Biomedical Engineering',
  'Media and Communication Engineering',
  'Product Design and Development Engineering',
  'Energy and Power Engineering',
];

export function buildDemoRows(): GradeRow[] {
  const rows: GradeRow[] = [];
  const students = [
    { id: 'S1', name: 'Sara', major: 'Mechatronics' },
    { id: 'S2', name: 'Omar', major: 'Civil' },
    { id: 'S3', name: 'Lina', major: 'Biomedical' },
  ];
  const courses: Array<{ course: string; grade: string; gpa: number }> = [
    { course: 'MAT101', grade: 'A', gpa: 4.0 },
    { course: 'PHY101', grade: 'B+', gpa: 3.5 },
    { course: 'CHE101', grade: 'C+', gpa: 3.0 },
  ];
  for (const s of students) {
    let gpa = 0;
    courses.forEach((c, i) => {
      gpa = c.gpa - i * 0.2;
      rows.push({
        studentId: s.id,
        studentName: s.name,
        major: s.major,
        course: c.course,
        units: 3,
        grade: c.grade,
        term: 'Fall 2024',
        cumulativeGpa: gpa,
      });
    });
    if (s.id === 'S1') {
      rows.push({
        studentId: 'S1', studentName: 'Sara', major: 'Mechatronics',
        course: 'MEC011', units: 3, grade: 'F', term: 'Spring 2025', cumulativeGpa: 2.6,
      });
      rows.push({
        studentId: 'S1', studentName: 'Sara', major: 'Mechatronics',
        course: 'MEC011', units: 3, grade: 'F', term: 'Fall 2025', cumulativeGpa: 2.2,
      });
    }
    if (s.id === 'S3') {
      rows.push({
        studentId: 'S3', studentName: 'Lina', major: 'Biomedical',
        course: 'CHE101', units: 3, grade: 'FD', term: 'Spring 2025', cumulativeGpa: 2.4,
      });
    }
  }
  return rows;
}

/**
 * Tiny catalog covering the courses the demo rows reference, with
 * per-major `semesters`/`majors` columns so the prereq-map grid lays
 * the cards out across semesters 1–3 the same way a real Excel would.
 *
 * Semester numbers are intentionally different per major so the adviser
 * sees a non-trivial grid layout (e.g. CHE101 sits in semester 1 for
 * everyone; MEC242 lives in semester 7 of Mechatronics only).
 */
export function buildDemoCatalog(): CourseCatalog {
  const courses: CatalogCourse[] = [
    {
      code: 'MAT101',
      title: 'Calculus I',
      credits: 3,
      prerequisites: [],
      majors: DEMO_MAJORS,
      semesters: [1, 1, 1, 1, 1, 1, 1, 1, 1],
    },
    {
      code: 'PHY101',
      title: 'Physics I',
      credits: 3,
      prerequisites: ['MAT101'],
      majors: DEMO_MAJORS,
      semesters: [2, 2, 2, 2, 2, 2, 2, 2, 2],
    },
    {
      code: 'CHE101',
      title: 'Chemistry I',
      credits: 3,
      prerequisites: [],
      majors: DEMO_MAJORS,
      semesters: [1, 1, 1, 1, 1, 1, 1, 1, 1],
    },
    {
      code: 'MEC011',
      title: 'Introduction to Mechatronics',
      credits: 3,
      prerequisites: ['MAT101', 'PHY101'],
      majors: ['Mechatronics Engineering'],
      semesters: [3],
    },
    {
      code: 'MEC242',
      title: 'Control Systems',
      credits: 3,
      prerequisites: ['MEC011'],
      majors: ['Mechatronics Engineering'],
      semesters: [7],
    },
    {
      code: 'CIV201',
      title: 'Structural Analysis',
      credits: 3,
      prerequisites: ['MAT101', 'PHY101'],
      majors: ['Civil Engineering'],
      semesters: [4],
    },
    {
      code: 'BIO110',
      title: 'Cell Biology',
      credits: 3,
      prerequisites: ['CHE101'],
      majors: ['Biomedical Engineering'],
      semesters: [3],
    },
  ];
  return { courses };
}
