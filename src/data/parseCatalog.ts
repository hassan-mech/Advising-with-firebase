/**
 * Course-catalog Excel parser — v2.
 *
 * Reads the first worksheet of an Excel file and returns a
 * CourseCatalog. The schema is permissive: only `code`, `title`,
 * and `credits` are required; everything else (including
 * `prerequisites`) is optional and lives in the loose bag on the
 * CatalogCourse.
 *
 * Recognised columns (case-insensitive, tolerant of synonyms):
 *   - code, title, credits, prerequisites
 *   - department, level, category, description
 *   - semesters     (JSON array, e.g. "[1,1,1,1,1,1]"; one entry per major)
 *   - majors        (delimited string, e.g. "Math;Physics" — one major
 *                    per entry, positionally aligned with `semesters`)
 *   - semester_<key> (per-major column pattern, e.g. "semester_petrol",
 *                    "semester_arch", … — one cell per major, a single
 *                    number indicating which semester the course belongs
 *                    to for that major; see MAJOR_PLAN_COLUMNS below.
 *                    Recognised suffixes: petrol, arch, aero, civil,
 *                    mechatronics, biomed, media, productdev, energy.)
 *
 * When `semester_<key>` columns are present they take precedence over
 * the combined `semesters` cell: the parser joins them into a positional
 * `(semesters, majors)` pair so downstream code keeps working unchanged.
 *
 * Prerequisites may arrive as a single cell with delimiters. We try
 * `;`, `|`, `,`, in that order, and fall back to whitespace.
 */

import * as XLSX from 'xlsx';
import type { CatalogCourse, CourseCatalog } from './types';
import { normalizeCourseCodeLoose } from './normalize';

/**
 * Synonyms for each canonical column. The first member is the
 * preferred spelling (used when the original header is missing).
 */
const HEADER_SYNONYMS: Record<string, string[]> = {
  code: ['code', 'course_code', 'coursecode', 'course id'],
  title: ['title', 'name', 'course_title'],
  credits: ['credits', 'credit_hours', 'units'],
  prerequisites: ['prerequisites', 'prereqs', 'pre'],
  department: ['department', 'dept'],
  level: ['level'],
  category: ['category'],
  description: ['description', 'desc'],
  semesters: ['semesters', 'semester', 'terms'],
  majors: ['majors', 'major'],
};

/**
 * Per-major semester columns. Each entry maps the column-suffix (the
 * part after `semester_`) to the canonical major name. The order here
 * defines the positional alignment of `semesters[i]` with `majors[i]`,
 * so order matters — keep it stable.
 */
const MAJOR_PLAN_COLUMNS: Record<string, string> = {
  petrol: 'Petrol and Gas Engineering',
  arch: 'Environmental Architecture',
  aero: 'Aerospace Engineering',
  civil: 'Civil Engineering',
  mechatronics: 'Mechatronics Engineering',
  biomed: 'Biomedical Engineering',
  media: 'Media and Communication Engineering',
  productdev: 'Product Design and Development Engineering',
  energy: 'Energy and Power Engineering',
};

/**
 * Parse the first worksheet of an Excel ArrayBuffer into a CourseCatalog.
 */
export function parseCatalog(buffer: ArrayBuffer): CourseCatalog {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { courses: [] };
  const sheet = workbook.Sheets[sheetName];
  const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
  });

  const courses: CatalogCourse[] = [];
  for (const row of jsonRows) {
    const course = mapCatalogRow(row);
    if (course) courses.push(course);
  }
  return { courses };
}

function mapCatalogRow(row: Record<string, unknown>): CatalogCourse | null {
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

  const code = get(...HEADER_SYNONYMS.code);
  if (!code) return null;

  // Loose-normalize once at parse time so "MEC 11" in the grade-book
  // and "MEC011" in the catalog both land on the same canonical key
  // and every join succeeds.
  const codeNormalized = normalizeCourseCodeLoose(code);
  const title = get(...HEADER_SYNONYMS.title) || codeNormalized;
  const creditsRaw = get(...HEADER_SYNONYMS.credits);
  const credits = parseNumber(creditsRaw);

  const prerequisitesRaw = get(...HEADER_SYNONYMS.prerequisites);
  const prerequisites = splitPrerequisites(prerequisitesRaw).map(normalizeCourseCodeLoose);

  const department = get(...HEADER_SYNONYMS.department) || undefined;
  const level = get(...HEADER_SYNONYMS.level) || undefined;
  const category = get(...HEADER_SYNONYMS.category) || undefined;
  const description = get(...HEADER_SYNONYMS.description) || undefined;

  const semestersRaw = get(...HEADER_SYNONYMS.semesters);
  const majorsRaw = get(...HEADER_SYNONYMS.majors);

  // Per-major columns (`semester_petrol`, `semester_arch`, …) take
  // precedence over the combined `semesters` cell because they're
  // explicit and positional. We build the pair in `MAJOR_PLAN_COLUMNS`
  // order so the indices stay aligned across all courses.
  const perMajor = readPerMajorColumns(row);

  const semesters = perMajor?.semesters ?? parseSemesters(semestersRaw);
  const majors = perMajor?.majors ?? splitMajors(majorsRaw);

  // Anything the parser doesn't recognise is kept verbatim in `extras`
  // so the user doesn't lose data when their Excel has extra columns
  // (e.g. "lecture_hours", "lab_hours"). Recognised columns are
  // excluded so we don't duplicate them.
  const extras: Record<string, unknown> = {};
  const allKnown = new Set<string>();
  for (const synonyms of Object.values(HEADER_SYNONYMS)) {
    for (const s of synonyms) allKnown.add(s);
  }
  // Per-major columns are recognised too — exclude every variant we
  // might encounter in the wild so they don't fall into `extras`.
  for (const key of Object.keys(MAJOR_PLAN_COLUMNS)) {
    allKnown.add(`semester_${key}`);
  }
  for (const [key, value] of Object.entries(row)) {
    const normalized = key.toLowerCase().trim();
    if (allKnown.has(normalized)) continue;
    extras[key] = value;
  }

  return {
    code: codeNormalized,
    title,
    credits,
    prerequisites,
    ...(department ? { department } : {}),
    ...(level ? { level } : {}),
    ...(category ? { category } : {}),
    ...(description ? { description } : {}),
    ...(semesters ? { semesters } : {}),
    ...(majors ? { majors } : {}),
    ...extras,
  };
}

/**
 * Parse the `semesters` cell. Accepts JSON arrays (`[1,1,1,1,1,1]`)
 * or comma-separated values (`1,1,1,1,1,1`). Returns undefined when
 * the cell is empty or unparseable.
 */
export function parseSemesters(raw: string): number[] | undefined {
  if (!raw) return undefined;
  // JSON array?
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.every((n) => typeof n === 'number' && Number.isFinite(n))) {
        return parsed;
      }
    } catch {
      // fall through to CSV path
    }
  }
  // Comma-separated.
  const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;
  const nums = parts.map((p) => Number(p)).filter((n) => Number.isFinite(n));
  return nums.length === parts.length ? nums : undefined;
}

/**
 * Split a delimited string into a list. Accepts `;`, `|`, or `,` as
 * the primary delimiter and falls back to whitespace when none of
 * those are present.
 */
export function splitDelimitedList(raw: string): string[] | undefined {
  if (!raw) return undefined;
  const parts = raw
    .split(/[;|]/)
    .flatMap((p) => p.split(','))
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  if (parts.length === 1 && /\s/.test(raw)) {
    return raw.split(/\s+/).map((p) => p.trim()).filter(Boolean);
  }
  return parts;
}

function splitPrerequisites(raw: string): string[] {
  return splitDelimitedList(raw) ?? [];
}

/**
 * Split a `majors` cell. Unlike prerequisites, major names can contain
 * spaces (e.g. "Petrol and Gas Engineering"), so we never fall back to
 * whitespace — only `;`, `|`, or `,` are accepted as delimiters.
 */
export function splitMajors(raw: string): string[] | undefined {
  if (!raw) return undefined;
  const parts = raw
    .split(/[;|]/)
    .flatMap((p) => p.split(','))
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length === 0 ? undefined : parts;
}

function parseNumber(input: string | number | undefined | null): number {
  if (input === undefined || input === null || input === '') return 0;
  if (typeof input === 'number') return input;
  const n = Number(input);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Read `semester_<key>` columns (one cell per major) into a positional
 * `(semesters, majors)` pair. Returns `undefined` when no per-major
 * columns are present so the caller can fall back to the combined
 * `semesters` + `majors` cells. Cells that aren't finite numbers are
 * silently skipped — they're treated as "this major has no planned
 * term for this course" rather than aborting the whole row.
 */
function readPerMajorColumns(
  row: Record<string, unknown>,
): { semesters: number[]; majors: string[] } | undefined {
  const semesters: number[] = [];
  const majors: string[] = [];
  let foundAny = false;
  for (const [suffix, majorName] of Object.entries(MAJOR_PLAN_COLUMNS)) {
    const columnKey = `semester_${suffix}`;
    if (!(columnKey in row)) continue;
    foundAny = true;
    const raw = row[columnKey];
    if (raw === null || raw === undefined || raw === '') continue;
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(n)) continue;
    semesters.push(n);
    majors.push(majorName);
  }
  return foundAny ? { semesters, majors } : undefined;
}
