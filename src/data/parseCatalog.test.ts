/**
 * Unit tests for the course-catalog Excel parser.
 *
 * Pins the schema: `code`/`title`/`credits` are required, every other
 * recognised column (`prerequisites`, `department`, `level`,
 * `category`, `description`, `semesters`, `majors`) is optional and
 * lands in the typed fields on CatalogCourse. Anything else stays in
 * the loose bag.
 *
 * The tests construct an ArrayBuffer by hand because we own the
 * XLSX-internal pipeline; going through xlsx.write would just be
 * testing xlsx.
 */

import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseCatalog, parseSemesters, splitDelimitedList } from './parseCatalog';

/** Build a real ArrayBuffer from an array of row objects. */
function buildBuffer(rows: Array<Record<string, unknown>>): ArrayBuffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Catalog');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return out as ArrayBuffer;
}

describe('parseSemesters', () => {
  it('parses JSON arrays', () => {
    expect(parseSemesters('[1,1,1,1,1,1]')).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('parses comma-separated values', () => {
    expect(parseSemesters('1,1,1,1,1,1')).toEqual([1, 1, 1, 1, 1, 1]);
    expect(parseSemesters('2, 3, 4')).toEqual([2, 3, 4]);
  });

  it('returns undefined for empty / invalid input', () => {
    expect(parseSemesters('')).toBeUndefined();
    expect(parseSemesters('not a list')).toBeUndefined();
    expect(parseSemesters('[1, "two", 3]')).toBeUndefined();
  });
});

describe('splitDelimitedList', () => {
  it('handles ; , | as primary delimiters', () => {
    expect(splitDelimitedList('a;b;c')).toEqual(['a', 'b', 'c']);
    expect(splitDelimitedList('a,b,c')).toEqual(['a', 'b', 'c']);
    expect(splitDelimitedList('a|b|c')).toEqual(['a', 'b', 'c']);
    expect(splitDelimitedList('a; b, c | d')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('falls back to whitespace when no delimiters are present', () => {
    expect(splitDelimitedList('a b c')).toEqual(['a', 'b', 'c']);
  });

  it('returns undefined for empty input', () => {
    expect(splitDelimitedList('')).toBeUndefined();
    expect(splitDelimitedList('   ')).toBeUndefined();
  });
});

describe('parseCatalog', () => {
  it('reads a full course row matching the v1 example object', () => {
    const buffer = buildBuffer([
      {
        code: 'MEC011',
        title: 'Engineering Drawing (1)',
        credits: 2,
        department: 'MEC',
        prerequisites: '',
        description:
          'Introduction to engineering drawing, layout, lettering, dimensioning, geometric construction, projection, and sectional views.',
        level: 'Intro',
        category: 'Core Engineering',
        semesters: '[1,1,1,1,1,1]',
        majors:
          'Petrol and Gas Engineering;Environmental Architecture;Aerospace Engineering;Civil Engineering;Mechatronics Engineering;Biomedical Engineering',
      },
    ]);
    const catalog = parseCatalog(buffer);
    expect(catalog.courses).toHaveLength(1);
    const c = catalog.courses[0];
    expect(c.code).toBe('MEC011');
    expect(c.title).toBe('Engineering Drawing (1)');
    expect(c.credits).toBe(2);
    expect(c.department).toBe('MEC');
    expect(c.level).toBe('Intro');
    expect(c.category).toBe('Core Engineering');
    expect(c.description).toContain('engineering drawing');
    expect(c.semesters).toEqual([1, 1, 1, 1, 1, 1]);
    expect(c.majors).toEqual([
      'Petrol and Gas Engineering',
      'Environmental Architecture',
      'Aerospace Engineering',
      'Civil Engineering',
      'Mechatronics Engineering',
      'Biomedical Engineering',
    ]);
    expect(c.prerequisites).toEqual([]);
  });

  it('parses prerequisites with mixed delimiters', () => {
    const buffer = buildBuffer([
      { code: 'MEC211', title: 'Robotics', credits: 3, prerequisites: 'MAT101; PHY101 | CHE101' },
    ]);
    const c = parseCatalog(buffer).courses[0];
    expect(c.prerequisites).toEqual(['MAT101', 'PHY101', 'CHE101']);
  });

  it('keeps unknown columns in the loose bag', () => {
    const buffer = buildBuffer([
      {
        code: 'MEC011',
        title: 'Intro',
        credits: 2,
        lecture_hours: 2,
        lab_hours: 3,
      },
    ]);
    const c = parseCatalog(buffer).courses[0];
    expect(c.lecture_hours).toBe(2);
    expect(c.lab_hours).toBe(3);
    // Recognised fields stay typed.
    expect(c.code).toBe('MEC011');
    expect(c.department).toBeUndefined();
    expect(c.semesters).toBeUndefined();
    expect(c.majors).toBeUndefined();
  });

  it('drops rows without a code', () => {
    const buffer = buildBuffer([
      { title: 'No Code Course', credits: 3 },
      { code: 'MAT101', title: 'Calculus', credits: 3 },
    ]);
    const catalog = parseCatalog(buffer);
    expect(catalog.courses).toHaveLength(1);
    expect(catalog.courses[0].code).toBe('MAT101');
  });

  it('tolerates lowercase + alternate headers', () => {
    const buffer = buildBuffer([
      {
        Code: 'BIO101',
        Title: 'Biology',
        Credits: 4,
        Department: 'BIO',
        Level: 'Intro',
        Category: 'Life Sciences',
        Description: 'Cells',
        Prerequisites: 'MAT101',
        Semesters: '[1]',
        Majors: 'Biomedical Engineering',
      },
    ]);
    const c = parseCatalog(buffer).courses[0];
    expect(c.code).toBe('BIO101');
    expect(c.title).toBe('Biology');
    expect(c.credits).toBe(4);
    expect(c.department).toBe('BIO');
    expect(c.level).toBe('Intro');
    expect(c.category).toBe('Life Sciences');
    expect(c.description).toBe('Cells');
    expect(c.prerequisites).toEqual(['MAT101']);
    expect(c.semesters).toEqual([1]);
    expect(c.majors).toEqual(['Biomedical Engineering']);
  });

  it('returns an empty catalog for an empty workbook', () => {
    const ws = XLSX.utils.json_to_sheet<Record<string, unknown>>([]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Catalog');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    expect(parseCatalog(buf)).toEqual({ courses: [] });
  });

  it('reads per-major semester columns (one cell per major)', () => {
    const buffer = buildBuffer([
      {
        code: 'MEC011',
        title: 'Engineering Drawing (1)',
        credits: 2,
        department: 'MEC',
        level: 'Intro',
        category: 'Core Engineering',
        semester_petrol: 1,
        semester_arch: 1,
        semester_aero: 1,
        semester_civil: 1,
        semester_mechatronics: 1,
        semester_biomed: 1,
      },
    ]);
    const c = parseCatalog(buffer).courses[0];
    expect(c.semesters).toEqual([1, 1, 1, 1, 1, 1]);
    expect(c.majors).toEqual([
      'Petrol and Gas Engineering',
      'Environmental Architecture',
      'Aerospace Engineering',
      'Civil Engineering',
      'Mechatronics Engineering',
      'Biomedical Engineering',
    ]);
    // Per-major columns should not leak into extras.
    expect(c.semester_petrol).toBeUndefined();
    expect(c.semester_arch).toBeUndefined();
  });

  it('only fills majors whose per-major column is present', () => {
    const buffer = buildBuffer([
      {
        code: 'CIV211',
        title: 'Civil-only course',
        credits: 3,
        semester_civil: 4,
      },
    ]);
    const c = parseCatalog(buffer).courses[0];
    expect(c.semesters).toEqual([4]);
    expect(c.majors).toEqual(['Civil Engineering']);
  });

  it('skips blank or non-numeric per-major cells', () => {
    const buffer = buildBuffer([
      {
        code: 'MAT101',
        title: 'Calc',
        credits: 3,
        semester_petrol: '',
        semester_arch: 'not a number',
        semester_aero: 2,
        semester_civil: 2,
        semester_mechatronics: null,
        semester_biomed: undefined,
      },
    ]);
    const c = parseCatalog(buffer).courses[0];
    // Only the numeric entries survive; the rest are skipped silently.
    expect(c.semesters).toEqual([2, 2]);
    expect(c.majors).toEqual(['Aerospace Engineering', 'Civil Engineering']);
  });

  it('per-major columns override the combined semesters/majors cells', () => {
    const buffer = buildBuffer([
      {
        code: 'MEC011',
        title: 'Engineering Drawing (1)',
        credits: 2,
        semester_petrol: 1,
        semester_arch: 2,
        semester_aero: 3,
        // These combined cells should be ignored in favor of the per-major ones.
        semesters: '[9,9,9,9]',
        majors: 'A;B;C;D',
      },
    ]);
    const c = parseCatalog(buffer).courses[0];
    expect(c.semesters).toEqual([1, 2, 3]);
    expect(c.majors).toEqual([
      'Petrol and Gas Engineering',
      'Environmental Architecture',
      'Aerospace Engineering',
    ]);
  });
});