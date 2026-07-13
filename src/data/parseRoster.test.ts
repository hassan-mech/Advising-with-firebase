/**
 * Unit tests for parseRoster. Pins: required student_id, optional
 * student_name + major, header synonyms, lowercase headers, dedup
 * by id (last row wins), empty workbook.
 */

import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseRoster } from './parseRoster';

function buildBuffer(rows: Array<Record<string, unknown>>): ArrayBuffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Roster');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('parseRoster', () => {
  it('reads a clean roster', () => {
    const buf = buildBuffer([
      { student_id: 'S1', student_name: 'Sara', major: 'Civil' },
      { student_id: 'S2', student_name: 'Omar', major: 'Mechatronics' },
    ]);
    const roster = parseRoster(buf);
    expect(roster).toHaveLength(2);
    expect(roster[0]).toEqual({
      studentId: 'S1',
      studentName: 'Sara',
      major: 'Civil',
      email: undefined,
      nationalId: undefined,
    });
    expect(roster[1].studentId).toBe('S2');
  });

  it('tolerates lowercase + alternate headers', () => {
    const buf = buildBuffer([
      { ID: 'A1', Full_Name: 'Lina', Program: 'Biomedical Engineering' },
    ]);
    expect(parseRoster(buf)).toEqual([
      {
        studentId: 'A1',
        studentName: 'Lina',
        major: 'Biomedical Engineering',
        email: undefined,
        nationalId: undefined,
      },
    ]);
  });

  it('drops rows without a student_id', () => {
    const buf = buildBuffer([
      { student_name: 'NoId1', major: 'Civil' },
      { student_id: 'S2', student_name: 'Omar', major: 'Mechatronics' },
    ]);
    const roster = parseRoster(buf);
    expect(roster).toHaveLength(1);
    expect(roster[0].studentId).toBe('S2');
  });

  it('deduplicates by id (last row wins)', () => {
    const buf = buildBuffer([
      { student_id: 'S1', student_name: 'First Read', major: 'Civil' },
      { student_id: 'S1', student_name: 'Correct Name', major: 'Architecture' },
    ]);
    const roster = parseRoster(buf);
    expect(roster).toHaveLength(1);
    expect(roster[0]).toEqual({
      studentId: 'S1',
      studentName: 'Correct Name',
      major: 'Architecture',
      email: undefined,
      nationalId: undefined,
    });
  });

  it('handles missing optional columns', () => {
    const buf = buildBuffer([{ student_id: 'S1' }]);
    expect(parseRoster(buf)).toEqual([
      {
        studentId: 'S1',
        studentName: undefined,
        major: undefined,
        email: undefined,
        nationalId: undefined,
      },
    ]);
  });

  it('reads the optional email + nationalId columns', () => {
    const buf = buildBuffer([
      {
        student_id: 'S1',
        student_name: 'Hassan',
        major: 'Civil',
        email: 'hassan@nmu.edu.eg',
        national_id: '30101010101010',
      },
    ]);
    const [row] = parseRoster(buf);
    expect(row.email).toBe('hassan@nmu.edu.eg');
    expect(row.nationalId).toBe('30101010101010');
  });

  it('tolerates synonyms for email + nationalId headers', () => {
    const buf = buildBuffer([
      {
        StudentID: 'S2',
        Name: 'Sara',
        Program: 'Civil',
        'E-mail': 'sara@example.com',
        'National ID': '30202020202020',
      },
    ]);
    const [row] = parseRoster(buf);
    expect(row.email).toBe('sara@example.com');
    expect(row.nationalId).toBe('30202020202020');
  });

  it('leaves email + nationalId undefined when columns are absent', () => {
    const buf = buildBuffer([
      { student_id: 'S3', student_name: 'Omar', major: 'Mechatronics' },
    ]);
    const [row] = parseRoster(buf);
    expect(row.email).toBeUndefined();
    expect(row.nationalId).toBeUndefined();
  });

  it('returns [] for an empty workbook', () => {
    const ws = XLSX.utils.json_to_sheet<Record<string, unknown>>([]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Roster');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    expect(parseRoster(buf)).toEqual([]);
  });
});
