/**
 * Unit tests for `downstreamCoursesFor` — the helper that returns
 * every catalog course whose `prerequisites[]` lists a given code.
 * Used by the Failure Stats leaderboard to render "this failed course
 * locks these downstream courses" under each row.
 */

import { describe, it, expect } from 'vitest';
import type { CourseCatalog } from './types';
import { downstreamCoursesFor } from './advising';

// MEC011 is a prereq for MEC211 + MEC310.
// CIV230 has no dependents (leaf course).
// CHE101's semester for the Petroleum major is 1 (sem 0 = not on plan).
// MEC242 (CNC Machine) and MEC342 (Additive Manufacturing) appear in
// real catalogs with a *narrow* shape: `majors: ['Mechatronics']`
// and `semesters: [7]` — meaning "semester 7 on the only listed
// major". The reader must find Mechatronics inside the row's own
// `majors[]` and use the row's own index, not the catalog-wide index.
const catalogMajors = [
  'Petrol and Gas Engineering',
  'Environmental Architecture',
  'Aerospace Engineering',
  'Civil Engineering',
  'Mechatronics Engineering',
  'Biomedical Engineering',
];
const catalog: CourseCatalog = {
  courses: [
    {
      code: 'MEC011',
      title: 'Intro to Mechatronics',
      credits: 3,
      prerequisites: [],
      majors: ['Mechatronics Engineering', 'Petroleum and Gas Engineering'],
      semesters: [1, 2],
    },
    {
      code: 'MEC211',
      title: 'Robotics',
      credits: 3,
      prerequisites: ['MEC011'],
      majors: ['Mechatronics Engineering'],
      semesters: [3, 0],
    },
    {
      code: 'MEC310',
      title: 'Sensors',
      credits: 3,
      prerequisites: ['MEC011', 'MAT101'],
      majors: ['Mechatronics Engineering'],
      semesters: [4, 0],
    },
    {
      code: 'CIV230',
      title: 'Soil Mechanics',
      credits: 3,
      prerequisites: [],
      majors: ['Civil Engineering'],
      semesters: [4, 0],
    },
    {
      code: 'CHE101',
      title: 'Intro Chemistry',
      credits: 3,
      prerequisites: ['MEC011'],
      majors: ['Mechatronics Engineering'],
      semesters: [1, 0],
    },
    // The narrow-shape rows that originally broke the semester chip:
    // `majors: ['Mechatronics Engineering']` + `semesters: [7]`.
    {
      code: 'MEC242',
      title: 'CNC Machine',
      credits: 6,
      prerequisites: ['MEC121'],
      majors: ['Mechatronics Engineering'],
      semesters: [7],
    },
    {
      code: 'MEC342',
      title: 'Additive Manufacturing 1',
      credits: 6,
      prerequisites: ['MEC121'],
      majors: ['Mechatronics Engineering'],
      semesters: [7],
    },
  ],
};

describe('downstreamCoursesFor', () => {
  it('returns every catalog course listing the code as a prereq', () => {
    // MEC011 has three downstream: MEC211 (sem 3) and MEC310 (sem 4) and
    // CHE101 (sem 1) when the major index points at the first catalog
    // major (Mechatronics).
    const out = downstreamCoursesFor(catalog, 'MEC011', 0);
    expect(out.map((d) => d.courseCode).sort()).toEqual(['CHE101', 'MEC211', 'MEC310']);
  });

  it('includes the semester for the chosen major index', () => {
    const out = downstreamCoursesFor(catalog, 'MEC011', 0);
    const byCode = Object.fromEntries(out.map((d) => [d.courseCode, d.semester]));
    expect(byCode).toEqual({ MEC211: 3, MEC310: 4, CHE101: 1 });
  });

  it('sorts the result by course code ascending', () => {
    const out = downstreamCoursesFor(catalog, 'MEC011', 0);
    expect(out.map((d) => d.courseCode)).toEqual(['CHE101', 'MEC211', 'MEC310']);
  });

  it('returns an empty list when no course lists the code as a prereq', () => {
    const out = downstreamCoursesFor(catalog, 'CIV230', 0);
    expect(out).toEqual([]);
  });

  it('returns an empty list when the catalog is null', () => {
    expect(downstreamCoursesFor(null, 'MEC011', 0)).toEqual([]);
  });

  it('returns sem 0 when the major index is -1 (no major picked)', () => {
    const out = downstreamCoursesFor(catalog, 'MEC011', -1);
    for (const d of out) expect(d.semester).toBe(0);
  });

  it('normalizes loose course codes (MEC 11 → MEC011)', () => {
    const out = downstreamCoursesFor(catalog, 'MEC 11', 0);
    expect(out.length).toBeGreaterThan(0);
    expect(out.map((d) => d.courseCode)).toContain('MEC211');
  });

  it('uses the second major index when the caller switches plans', () => {
    // The Petroleum major is index 1 in this catalog — MEC211, MEC310,
    // CHE101 and CIV230 all drop to semester 0 (off-plan). MEC011 has
    // semester 2 on the Petroleum plan.
    const out = downstreamCoursesFor(catalog, 'MEC011', 1);
    for (const d of out) expect(d.semester).toBe(0);
  });

  it('resolves narrow-shape rows (single-major catalogs)', () => {
    // The caller is looking at Mechatronics (index 4 in the catalog).
    // MEC242 and MEC342 are downstream of MEC121 (not MEC011), so they
    // don't appear under MEC011 — but the semester helper itself
    // should still report 7 for them via the narrow shape. We verify
    // the helper indirectly by asking for downstream of MEC121.
    const out = downstreamCoursesFor(catalog, 'MEC121', 4, catalogMajors);
    const codes = out.map((d) => d.courseCode).sort();
    expect(codes).toContain('MEC242');
    expect(codes).toContain('MEC342');
    const byCode = Object.fromEntries(out.map((d) => [d.courseCode, d.semester]));
    expect(byCode.MEC242).toBe(7);
    expect(byCode.MEC342).toBe(7);
  });
});
