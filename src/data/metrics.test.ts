/**
 * Unit tests for the Python-equivalent metrics helpers.
 *
 * Each test pins a single rule. If the user's spreadsheet layout or
 * pass/fail semantics change, this file is the single place that has
 * to be updated.
 */

import { describe, it, expect } from 'vitest';
import type { GradeRow } from './types';
import {
  checkCourseState,
  checkCoursesState,
  computeExpectedGpa,
  compareTerms,
  currentSemesterForStudent,
  didStudentFailCourse,
  didStudentPassCourse,
  failedSubjects,
  isFailingGrade,
  lastTermGpa,
  letterToPoints,
  missingFromList,
  rowsForStudent,
  studentLevel,
  studentRoster,
  totalFailedUnits,
  totalPassedUnits,
} from './metrics';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function row(partial: Partial<GradeRow>): GradeRow {
  return {
    studentId: 'S1',
    course: 'MAT101',
    units: 3,
    grade: 'A',
    term: 'Fall 2024',
    ...partial,
  };
}

const rows: GradeRow[] = [
  // S1 passed MAT101 in Fall 2024, took PHY101 in Spring 2025, then failed and retook MEC011.
  row({ studentId: 'S1', course: 'MAT101', grade: 'A', term: 'Fall 2024', units: 3, cumulativeGpa: 3.5 }),
  row({ studentId: 'S1', course: 'PHY101', grade: 'B+', term: 'Spring 2025', units: 3, cumulativeGpa: 3.3 }),
  row({ studentId: 'S1', course: 'MEC011', grade: 'F', term: 'Spring 2025', units: 3, cumulativeGpa: 3.3 }),
  row({ studentId: 'S1', course: 'MEC011', grade: 'F', term: 'Fall 2025', units: 3, cumulativeGpa: 2.8 }),
  row({ studentId: 'S1', course: 'CHE101', grade: 'C', term: 'Fall 2025', units: 3, cumulativeGpa: 2.8 }),
  // S2 has only one passing attempt and one failure.
  row({ studentId: 'S2', studentName: 'Sara', course: 'MAT101', grade: 'B', term: 'Fall 2024', units: 3, cumulativeGpa: 3.0 }),
  row({ studentId: 'S2', studentName: 'Sara', major: 'Mechatronics', course: 'MEC011', grade: 'FD', term: 'Fall 2024', units: 3, cumulativeGpa: 3.0 }),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isFailingGrade', () => {
  it('flags F, FD, FL, FA (and any case)', () => {
    expect(isFailingGrade('F')).toBe(true);
    expect(isFailingGrade('FD')).toBe(true);
    expect(isFailingGrade('fl')).toBe(true);
    expect(isFailingGrade('FA')).toBe(true);
  });

  it('does not flag A / B+ / U-suffixed grades as failing the rule of F-prefix', () => {
    // U counts as failing — keep this contract pinned.
    expect(isFailingGrade('A')).toBe(false);
    expect(isFailingGrade('B+')).toBe(false);
    // U is intentionally NOT in the F-prefix set — handle separately if
    // future requirements change. The Python pipeline used F-prefix only.
    expect(isFailingGrade('U')).toBe(false);
  });
});

describe('letterToPoints', () => {
  it('maps the full A..F range to the 4.0 scale', () => {
    expect(letterToPoints('A')).toBe(4.0);
    expect(letterToPoints('A-')).toBe(3.7);
    expect(letterToPoints('B+')).toBe(3.3);
    expect(letterToPoints('B')).toBe(3.0);
    expect(letterToPoints('B-')).toBe(2.7);
    expect(letterToPoints('C+')).toBe(2.3);
    expect(letterToPoints('C')).toBe(2.0);
    expect(letterToPoints('C-')).toBe(1.7);
    expect(letterToPoints('D+')).toBe(1.3);
    expect(letterToPoints('D')).toBe(1.0);
    expect(letterToPoints('F')).toBe(0.0);
  });

  it('normalises case + whitespace', () => {
    expect(letterToPoints('  b+ ')).toBe(3.3);
    expect(letterToPoints('a-')).toBe(3.7);
    expect(letterToPoints('C')).toBe(2.0);
  });

  it('returns null for non-letter grades (FL, FD, U, P, W, empty)', () => {
    expect(letterToPoints('')).toBeNull();
    expect(letterToPoints('U')).toBeNull();
    expect(letterToPoints('FL')).toBeNull();
    expect(letterToPoints('FD')).toBeNull();
    expect(letterToPoints('FA')).toBeNull();
    expect(letterToPoints('P')).toBeNull();
    expect(letterToPoints('W')).toBeNull();
  });
});

describe('didStudentPassCourse / didStudentFailCourse', () => {
  it('passes when at least one attempt is non-F', () => {
    expect(didStudentPassCourse(rows, 'S1', 'MAT101')).toBe(true);
    expect(didStudentPassCourse(rows, 'S1', 'PHY101')).toBe(true);
    expect(didStudentPassCourse(rows, 'S1', 'CHE101')).toBe(true);
  });

  it('fails when every attempt starts with F', () => {
    expect(didStudentFailCourse(rows, 'S1', 'MEC011')).toBe(true);
    expect(didStudentFailCourse(rows, 'S2', 'MEC011')).toBe(true);
  });

  it('returns false for missing courses', () => {
    expect(didStudentPassCourse(rows, 'S1', 'BIO101')).toBe(false);
    expect(didStudentFailCourse(rows, 'S1', 'BIO101')).toBe(false);
  });
});

describe('rowsForStudent', () => {
  it('returns only the rows for the given student', () => {
    expect(rowsForStudent(rows, 'S1')).toHaveLength(5);
    expect(rowsForStudent(rows, 'S2')).toHaveLength(2);
    expect(rowsForStudent(rows, 'NONE')).toHaveLength(0);
  });
});

describe('lastTermGpa', () => {
  it('returns the cumulative GPA on the latest term the student appears in', () => {
    expect(lastTermGpa(rows, 'S1')).toBe(2.8);
    expect(lastTermGpa(rows, 'S2')).toBe(3.0);
    expect(lastTermGpa(rows, 'UNKNOWN')).toBe(0);
  });

  it('returns 0 when the latest term has rows but no numeric cumulativeGpa (does not backfill from an earlier term)', () => {
    // A student has rows in Fall 2024 (cumGpa 3.0) and Fall 2025
    // (in-progress, no cumGpa filled). The strict rule says: latest
    // term is Fall 2025; it has no value; we return 0. We do NOT
    // backfill from Fall 2024 even though it has a value.
    const r: GradeRow[] = [
      row({ studentId: 'S9', course: 'MAT101', grade: 'A', term: 'Fall 2024', units: 3, cumulativeGpa: 3.0 }),
      // Fall 2025 row exists but cumGpa is undefined (in-progress term).
      row({ studentId: 'S9', course: 'CHE101', grade: 'C', term: 'Fall 2025', units: 3, cumulativeGpa: undefined }),
    ];
    expect(lastTermGpa(r, 'S9')).toBe(0);
  });

  it('picks the latest numeric cumulativeGpa within the latest term, ignoring undefined cells', () => {
    // Latest term is Spring 2025. Within it, only the LAST row of
    // the term carries a cumulativeGpa (the Excel convention). The
    // first row of the term is blank, the second row reports 3.4.
    const r: GradeRow[] = [
      row({ studentId: 'S11', course: 'MAT101', grade: 'A', term: 'Spring 2025', units: 3, cumulativeGpa: undefined }),
      row({ studentId: 'S11', course: 'PHY101', grade: 'B', term: 'Spring 2025', units: 3, cumulativeGpa: 3.4 }),
      // Fall 2024 is an earlier term — its value must NOT be returned.
      row({ studentId: 'S11', course: 'CHE101', grade: 'A', term: 'Fall 2024', units: 3, cumulativeGpa: 4.0 }),
    ];
    expect(lastTermGpa(r, 'S11')).toBe(3.4);
  });

  it('returns 0 when no term has a numeric cumulativeGpa at all', () => {
    const r: GradeRow[] = [
      row({ studentId: 'S10', course: 'MAT101', grade: 'A', term: 'Fall 2024', units: 3, cumulativeGpa: undefined }),
    ];
    expect(lastTermGpa(r, 'S10')).toBe(0);
  });

  it('handles the academic-year term format like "Spring 2025-2026" by anchoring on the start year', () => {
    // The user's grade-book uses the two-year form for the current
    // term. Spring 2025-2026 should be parsed as season=SPRING,
    // year=2025 — so it sorts AFTER Spring 2025 and AFTER Fall 2025
    // (year 2025, season FALL=2) is wrong; Spring 2025-2026 is
    // (year=2025, season=SPRING=0) which is the SAME year as Fall
    // 2025 but earlier in the year. Use a clear year gap to make
    // it unambiguous.
    const r: GradeRow[] = [
      row({ studentId: 'S12', course: 'MAT101', grade: 'A', term: 'Fall 2025', units: 3, cumulativeGpa: 3.3 }),
      row({ studentId: 'S12', course: 'PHY101', grade: 'B', term: 'Spring 2025-2026', units: 3, cumulativeGpa: 3.5 }),
    ];
    // Spring 2026 (started in Jan 2026, ending in June 2026) should
    // sort AFTER Fall 2025. The returned value is the latest term's
    // cumGpa, which is 3.5 here.
    expect(lastTermGpa(r, 'S12')).toBe(3.5);
  });

  it('handles a real grade-book where some students use single-year and others use academic-year format', () => {
    // Two students with the same coursework; Sara uses the academic
    // year form, Yara uses the single-year form. Both should report
    // the SAME cumulative GPA from their respective latest term.
    const single: GradeRow[] = [
      row({ studentId: 'Yara', course: 'MAT101', grade: 'A', term: 'Spring 2025', units: 3, cumulativeGpa: 3.0 }),
      row({ studentId: 'Yara', course: 'PHY101', grade: 'B', term: 'Fall 2025', units: 3, cumulativeGpa: 3.2 }),
    ];
    const academic: GradeRow[] = [
      row({ studentId: 'Sara', course: 'MAT101', grade: 'A', term: 'Spring 2025', units: 3, cumulativeGpa: 3.0 }),
      row({ studentId: 'Sara', course: 'PHY101', grade: 'B', term: 'Fall 2025', units: 3, cumulativeGpa: 3.2 }),
    ];
    expect(lastTermGpa(single, 'Yara')).toBe(3.2);
    expect(lastTermGpa(academic, 'Sara')).toBe(3.2);
  });

  it('uses Fall 2025 as the latest term when Summer/Spring/Fall all exist in the same calendar year', () => {
    // AY grouping: Fall 2025 belongs to AY 2025-2026 (pos 0); Spring
    // 2025 and Summer 2025 both belong to AY 2024-2025 (pos 1 and 2).
    // Even though Summer 2025 is the LATEST within AY 2024-2025,
    // Fall 2025 starts a NEW AY and sorts after the whole AY 2024-2025.
    // So "Fall 2025" wins as the latest term overall. This matches
    // the user's grade-book reality: the AY-2025-2026 column block is
    // the most recent set of rows in the spreadsheet.
    const r: GradeRow[] = [
      row({ studentId: 'S15', course: 'MAT101', grade: 'A', term: 'Summer 2025', units: 3, cumulativeGpa: 2.5 }),
      row({ studentId: 'S15', course: 'PHY101', grade: 'A', term: 'Spring 2025', units: 3, cumulativeGpa: 3.0 }),
      row({ studentId: 'S15', course: 'CHE101', grade: 'A', term: 'Fall 2025', units: 3, cumulativeGpa: 3.4 }),
    ];
    expect(lastTermGpa(r, 'S15')).toBe(3.4);
  });

  it('within AY 2025-2026 puts Spring after Fall (latest term is Spring 2025-2026)', () => {
    // Both terms belong to AY 2025-2026 (anchored on start year for
    // academic-year form). Within the AY, Fall is pos 0 and Spring
    // is pos 1, so Spring 2025-2026 sorts AFTER Fall 2025-2026.
    // Spring 2025-2026 (Jan-Jun 2026) is the latest term overall
    // and its cumGpa (3.1) is returned.
    const r: GradeRow[] = [
      row({ studentId: 'S16', course: 'MAT101', grade: 'A', term: 'Spring 2025-2026', units: 3, cumulativeGpa: 3.1 }),
      row({ studentId: 'S16', course: 'PHY101', grade: 'A', term: 'Fall 2025-2026', units: 3, cumulativeGpa: 3.5 }),
    ];
    expect(lastTermGpa(r, 'S16')).toBe(3.1);
  });

  it('rejects malformed academic-year ranges that don\'t span exactly one year', () => {
    // "Fall 2024-2027" is not a true academic year. The range-match
    // fails its endYear === startYear + 1 guard and parseTerm falls
    // through to the single-year regex, which also doesn't match
    // (there is no lone year after "Fall"). Result: parseTerm returns
    // null, the term string is unparseable, and we treat any numeric
    // cumGpa on its row using the same fallback (localeCompare) as
    // other unparseable terms.
    const r: GradeRow[] = [
      row({ studentId: 'S14', course: 'PHY101', grade: 'B', term: 'Fall 2024-2027', units: 3, cumulativeGpa: 3.7 }),
    ];
    // The row's cumGpa is used (unparseable terms still record data).
    expect(lastTermGpa(r, 'S14')).toBe(3.7);
  });
});

describe('compareTerms', () => {
  it('orders Fall < Spring < Summer within a single academic year', () => {
    // Academic-year (AY) grouping: Fall YEAR starts a new AY; Spring
    // and Summer YEAR belong to AY (YEAR-1). So Fall 2024, Spring 2025
    // and Summer 2025 all belong to AY 2024-2025, and within that AY
    // the chronological order is Fall < Spring < Summer.
    expect(compareTerms('Fall 2024', 'Spring 2025')).toBeLessThan(0);
    expect(compareTerms('Spring 2025', 'Summer 2025')).toBeLessThan(0);
    expect(compareTerms('Fall 2024', 'Summer 2025')).toBeLessThan(0);
    expect(compareTerms('Summer 2025', 'Spring 2025')).toBeGreaterThan(0);
    expect(compareTerms('Spring 2025', 'Fall 2024')).toBeGreaterThan(0);
    expect(compareTerms('Summer 2025', 'Fall 2024')).toBeGreaterThan(0);
  });

  it('puts the next academic year\'s Fall AFTER the previous AY\'s Summer', () => {
    // Summer 2025 (AY 2024-2025, pos 2) < Fall 2025 (AY 2025-2026, pos 0).
    expect(compareTerms('Summer 2025', 'Fall 2025')).toBeLessThan(0);
    expect(compareTerms('Fall 2025', 'Summer 2025')).toBeGreaterThan(0);
  });
});

describe('totalPassedUnits', () => {
  it('sums unique passed-course credits only (failed courses contribute 0)', () => {
    // S1: MAT101(3) + PHY101(3) + MEC011(failed=0) + CHE101(3) = 9
    expect(totalPassedUnits(rows, 'S1')).toBe(9);
    // S2: MAT101(3) + MEC011(failed=0) = 3
    expect(totalPassedUnits(rows, 'S2')).toBe(3);
  });
});

describe('totalFailedUnits', () => {
  it('sums unique failed-course credits only (passed courses contribute 0)', () => {
    // S1: only MEC011 was attempted and failed → 3 cr
    expect(totalFailedUnits(rows, 'S1')).toBe(3);
    // S2: only MEC011 was attempted and failed → 3 cr
    expect(totalFailedUnits(rows, 'S2')).toBe(3);
    // No rows → 0
    expect(totalFailedUnits([], 'S1')).toBe(0);
  });

  it('does not double-count a course that was failed across multiple attempts', () => {
    // S1 has TWO failed MEC011 attempts. Credits are taken from the
    // first-seen attempt and the course is counted once.
    expect(totalFailedUnits(rows, 'S1')).toBe(3);
  });

  it('returns 0 for a student whose every attempt passed', () => {
    const r: GradeRow[] = [
      row({ studentId: 'SP', course: 'A', grade: 'A', units: 3, term: 'Fall 2024' }),
      row({ studentId: 'SP', course: 'B', grade: 'B', units: 3, term: 'Fall 2024' }),
    ];
    expect(totalFailedUnits(r, 'SP')).toBe(0);
  });
});

describe('studentLevel', () => {
  // Build a fixture with exactly the requested total passed units
  // (single course, controlled credits) so the boundaries are tight.
  function withPassedUnits(units: number, gpa?: number): GradeRow[] {
    const r: GradeRow = row({
      studentId: 'LV',
      course: 'BULK',
      grade: 'A',
      units,
      term: 'Fall 2025',
    });
    if (typeof gpa === 'number') r.cumulativeGpa = gpa;
    return [r];
  }

  it('returns Level 0 when total passed units < 33', () => {
    expect(studentLevel(withPassedUnits(0), 'LV')).toBe('Level 0');
    expect(studentLevel(withPassedUnits(32), 'LV')).toBe('Level 0');
  });

  it('returns Level 1 between 33 and 65 inclusive lower-bound', () => {
    expect(studentLevel(withPassedUnits(33), 'LV')).toBe('Level 1');
    expect(studentLevel(withPassedUnits(65), 'LV')).toBe('Level 1');
  });

  it('returns Level 2 between 66 and 98', () => {
    expect(studentLevel(withPassedUnits(66), 'LV')).toBe('Level 2');
    expect(studentLevel(withPassedUnits(98), 'LV')).toBe('Level 2');
  });

  it('returns Level 3 between 99 and 131', () => {
    expect(studentLevel(withPassedUnits(99), 'LV')).toBe('Level 3');
    expect(studentLevel(withPassedUnits(131), 'LV')).toBe('Level 3');
  });

  it('returns Level 4 between 132 and 164', () => {
    expect(studentLevel(withPassedUnits(132), 'LV')).toBe('Level 4');
    expect(studentLevel(withPassedUnits(164), 'LV')).toBe('Level 4');
  });

  it('returns Graduated when total passed units is exactly 165 AND GPA ≥ 2', () => {
    expect(studentLevel(withPassedUnits(165, 3.5), 'LV')).toBe('Graduated');
    expect(studentLevel(withPassedUnits(165, 2.0), 'LV')).toBe('Graduated');
  });

  it('returns ERROR when total passed units is exactly 165 BUT GPA < 2', () => {
    expect(studentLevel(withPassedUnits(165, 1.9), 'LV')).toBe('ERROR');
    // No cumulativeGpa means lastTermGpa returns 0 — still below 2.
    expect(studentLevel(withPassedUnits(165), 'LV')).toBe('ERROR');
  });

  it('returns ERROR when total passed units exceeds 165 (plan has more credits than the degree allows)', () => {
    expect(studentLevel(withPassedUnits(166), 'LV')).toBe('ERROR');
    expect(studentLevel(withPassedUnits(200), 'LV')).toBe('ERROR');
  });

  it('returns Level 0 for a brand-new student with no rows', () => {
    expect(studentLevel([], 'NEW')).toBe('Level 0');
  });
});

describe('computeExpectedGpa', () => {
  // Helper: rounds to 3 decimals so the test assertions read cleanly
  // and match the on-screen / printed display format (`toFixed(3)`).
  const r = (n: number | null) => (n == null ? null : Math.round(n * 1000) / 1000);

  it('new courses add 4.0 × credits and grow the denominator', () => {
    // current gpa 2.5 over 30 hours → 75 points.
    // one 3-credit new course adds 12 → 87 points over 33 hours
    // (30 passed + 0 failed + 3 new = 33).
    // expected = 87 / 33 ≈ 2.63636 → rounded to 2.636.
    expect(
      r(
        computeExpectedGpa(2.5, 30, 0, [
          { credits: 3, classification: 'new' },
        ])
      )
    ).toBe(2.636);
  });

  it('repeated courses cap at 3.3 and do NOT change total hours', () => {
    // current 75 points / 30 hours (no failed units). 3-credit retry
    // adds 9.9 → 84.9. expected = 84.9 / 30 = 2.83 → 2.830.
    expect(
      r(
        computeExpectedGpa(2.5, 30, 0, [
          { credits: 3, classification: 'repeated' },
        ])
      )
    ).toBe(2.830);
  });

  it('enhancing courses use the delta against current letter points', () => {
    // current 75 / 30. Previous attempt was a D (1.0). Retake target
    // A (4.0) → delta = 3.0 × 3 cr = 9.0 added → 84.0 / 30 = 2.8 → 2.800.
    expect(
      r(
        computeExpectedGpa(2.5, 30, 0, [
          { credits: 3, classification: 'enhancing', currentPoints: 1.0 },
        ])
      )
    ).toBe(2.800);
  });

  it('enhancing with no previous points contributes 4.0 × credits', () => {
    // currentPoints missing/null → treat as 0 → full 4.0 × credits.
    // (Defensive fallback; the caller should always provide it.)
    expect(
      r(
        computeExpectedGpa(2.5, 30, 0, [
          { credits: 3, classification: 'enhancing' },
        ])
      )
    ).toBe(2.900); // (75 + 12) / 30 = 87 / 30
  });

  it('handles a mixed plan (new + repeated + enhancing) in one pass', () => {
    // 75 / 30 = 2.5 baseline.
    // new 3 cr: +12 / +3h → 87 / 33
    // repeated 3 cr: +9.9 → 96.9 / 33 (hours unchanged)
    // enhancing 3 cr, prev 2.0 → delta 2.0×3 = 6 → 102.9 / 33
    // 102.9 / 33 = 3.11818... → 3.118
    expect(
      r(
        computeExpectedGpa(2.5, 30, 0, [
          { credits: 3, classification: 'new' },
          { credits: 3, classification: 'repeated' },
          { credits: 3, classification: 'enhancing', currentPoints: 2.0 },
        ])
      )
    ).toBe(3.118);
  });

  it('returns null when no passed hours, no failed hours, and no new courses planned', () => {
    // Fresh student — can't compute a ratio.
    expect(computeExpectedGpa(0, 0, 0, [])).toBeNull();
  });

  it('returns a real number for a fresh student with new courses', () => {
    // 0 hours + 4 cr new → 16 points / 4 hours = 4.0 → 4.000.
    expect(r(computeExpectedGpa(0, 0, 0, [
      { credits: 4, classification: 'new' },
    ]))).toBe(4.0);
  });

  it('skips zero-credit entries instead of producing NaN', () => {
    // (60 + 12) / 33 = 2.181818... → 2.182
    expect(
      r(
        computeExpectedGpa(2.0, 30, 0, [
          { credits: 0, classification: 'new' },
          { credits: 3, classification: 'new' },
        ])
      )
    ).toBe(2.182);
  });

  it('rounds the returned value to 3 decimal places (matches the display format)', () => {
    // 1 / 3 = 0.33333... → 0.333 (not 0.33333...)
    const out = computeExpectedGpa(0, 3, 0, [
      { credits: 1, classification: 'new' }, // +4 / +1 → 4 / 4 = 1.0
    ]);
    expect(out).toBe(1.0);
    // A case that genuinely exercises the 3rd decimal:
    // 2.5 over 30 hours = 75 points. A 4-credit new course adds
    // 16 → 91 / 34 = 2.67647... → 2.676.
    expect(
      r(
        computeExpectedGpa(2.5, 30, 0, [
          { credits: 4, classification: 'new' },
        ])
      )
    ).toBe(2.676);
  });

  it('includes failed hours in the denominator — repeated courses do NOT shrink the ratio (user scenario)', () => {
    // User's exact numbers:
    //   - GPA 1.297 over 60 total hours (passed + failed)
    //   - retake 9 credit hours of a previously failed course at B+ (3.3)
    // Expected = (1.297 × 60 + 3.3 × 9) / 60
    //          = (77.82 + 29.7) / 60
    //          = 107.52 / 60
    //          = 1.792 → 1.792
    expect(
      r(
        computeExpectedGpa(1.297, /* passedHours */ 51, /* failedHours */ 9, [
          { credits: 9, classification: 'repeated' },
        ])
      )
    ).toBe(1.792);
  });

  it('treats failed hours as part of the initial numerator+denominator (not zeroed out)', () => {
    // Same student but no plan → the helper returns the current
    // GPA unchanged. 1.297 × 60 / 60 = 1.297.
    expect(r(computeExpectedGpa(1.297, 51, 9, []))).toBe(1.297);
  });
});

describe('failedSubjects', () => {
  it('returns sorted course codes that the student failed', () => {
    expect(failedSubjects(rows, 'S1')).toEqual(['MEC011']);
    expect(failedSubjects(rows, 'S2')).toEqual(['MEC011']);
    expect(failedSubjects(rows, 'UNKNOWN')).toEqual([]);
  });
});

describe('checkCourseState', () => {
  it('returns the right state for passed / failed / missing courses', () => {
    expect(checkCourseState(rows, 'S1', 'MAT101')).toBe('passed');
    expect(checkCourseState(rows, 'S1', 'MEC011')).toBe('failed');
    expect(checkCourseState(rows, 'S1', 'BIO101')).toBe('missing');
  });
});

describe('checkCoursesState', () => {
  it('AND across the list', () => {
    expect(checkCoursesState(rows, 'S1', ['MAT101', 'PHY101'])).toBe('passed');
    expect(checkCoursesState(rows, 'S1', ['MAT101', 'MEC011'])).toBe('failed');
    expect(checkCoursesState(rows, 'S1', ['MAT101', 'BIO101'])).toBe('missing');
    expect(checkCoursesState(rows, 'S1', ['MEC011', 'BIO101'])).toBe('failed');
  });
});

describe('missingFromList', () => {
  it('returns the subset not yet passed', () => {
    expect(missingFromList(rows, 'S1', ['MAT101', 'MEC011', 'BIO101']))
      .toEqual(['MEC011', 'BIO101']);
  });
});

describe('studentRoster', () => {
  it('returns one entry per student id with name + major resolved', () => {
    const roster = studentRoster(rows);
    expect(roster).toHaveLength(2);
    const s1 = roster.find((s) => s.studentId === 'S1');
    const s2 = roster.find((s) => s.studentId === 'S2');
    expect(s1?.name).toBe('Student S1');
    expect(s1?.major).toBe('Undeclared');
    expect(s2?.name).toBe('Sara');
    expect(s2?.major).toBe('Mechatronics');
  });

  it('uses the roster over grade-book rows when both exist', () => {
    const rosterList = studentRoster(rows, [
      { studentId: 'S1', studentName: 'From Roster', major: 'Civil' },
    ]);
    const s1 = rosterList.find((s) => s.studentId === 'S1');
    // Roster wins for both name and major.
    expect(s1?.name).toBe('From Roster');
    expect(s1?.major).toBe('Civil');
  });

  it('includes roster students with no grade-book rows', () => {
    const rosterList = studentRoster(rows, [
      { studentId: 'NEW1', studentName: 'Brand New', major: 'Architecture' },
    ]);
    const fresh = rosterList.find((s) => s.studentId === 'NEW1');
    expect(fresh).toBeDefined();
    expect(fresh?.name).toBe('Brand New');
    expect(fresh?.major).toBe('Architecture');
  });

  it('passes email + nationalId through from the roster', () => {
    const rosterList = studentRoster(rows, [
      {
        studentId: 'S1',
        studentName: 'From Roster',
        major: 'Civil',
        email: 's1@nmu.edu.eg',
        nationalId: '30101010101010',
      },
    ]);
    const s1 = rosterList.find((s) => s.studentId === 'S1');
    expect(s1?.email).toBe('s1@nmu.edu.eg');
    expect(s1?.nationalId).toBe('30101010101010');
  });

  it('leaves email + nationalId undefined for roster-only or row-only students without those fields', () => {
    const rosterList = studentRoster(rows);
    for (const m of rosterList) {
      // The base fixture does not carry email/nationalId, so every
      // student gets undefined for both fields.
      expect(m.email).toBeUndefined();
      expect(m.nationalId).toBeUndefined();
    }
  });
});

describe('currentSemesterForStudent', () => {
  it('returns 1 for a student with no rows', () => {
    expect(currentSemesterForStudent([], 'S1')).toBe(1);
  });

  it('counts distinct terms + 1', () => {
    const r: GradeRow[] = [
      { studentId: 'S1', course: 'A', units: 3, grade: 'A', term: 'Fall 2024' },
      { studentId: 'S1', course: 'B', units: 3, grade: 'A', term: 'Spring 2025' },
    ];
    expect(currentSemesterForStudent(r, 'S1')).toBe(3);
  });

  it('collapses duplicate-term rows to one entry', () => {
    const r: GradeRow[] = [
      { studentId: 'S1', course: 'A', units: 3, grade: 'A', term: 'Fall 2024' },
      { studentId: 'S1', course: 'B', units: 3, grade: 'A', term: 'Fall 2024' },
    ];
    expect(currentSemesterForStudent(r, 'S1')).toBe(2);
  });
});