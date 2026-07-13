/**
 * Shared major-resolution helpers.
 *
 * `prereqMap.ts` and `advising.ts` both need to know which catalog
 * major applies to a given student so they can read the per-major
 * `semesters[]` column. Centralising the resolution here means a
 * single source of truth — a new alias added once, used everywhere.
 */

export interface MajorResolution {
  /** Index into `CatalogCourse.majors[]` / `CatalogCourse.semesters[]`. */
  index: number;
  /** The canonical major string we resolved to (null = catalog has no majors). */
  resolved: string | null;
  /** True when the catalog has majors but the student's didn't match exactly. */
  mismatch: boolean;
}

/** Canonical ordering of majors used to resolve `semesters[i]` for a given major name. */
export const MAJOR_ALIASES: Array<{ match: RegExp; canonical: string }> = [
  { match: /petrol|petroleum|gas/i, canonical: 'Petrol and Gas Engineering' },
  { match: /arch|architecture/i, canonical: 'Environmental Architecture' },
  { match: /aerospace|aero/i, canonical: 'Aerospace Engineering' },
  { match: /civil/i, canonical: 'Civil Engineering' },
  { match: /mechatronics|mecha/i, canonical: 'Mechatronics Engineering' },
  { match: /biomed|biomedical/i, canonical: 'Biomedical Engineering' },
  { match: /media|communication/i, canonical: 'Media and Communication Engineering' },
  { match: /product/i, canonical: 'Product Design and Development Engineering' },
  { match: /energy|power/i, canonical: 'Energy and Power Engineering' },
];

/** Catalog rows have up to 10 semester columns. */
export const MAX_SEMESTER = 10;

/**
 * Pick the catalog-major index for the given student major. Falls back
 * to 0 if neither the canonical name nor an alias matches — that way
 * the consumer still renders, just with the first major's plan.
 */
export function resolveMajorIndex(
  studentMajor: string | undefined,
  catalogMajors: string[] | undefined
): MajorResolution {
  if (!catalogMajors || catalogMajors.length === 0) {
    return { index: 0, resolved: null, mismatch: false };
  }
  if (!studentMajor) {
    return { index: 0, resolved: catalogMajors[0], mismatch: true };
  }
  // 1) Exact (case-insensitive) match.
  for (let i = 0; i < catalogMajors.length; i++) {
    if (catalogMajors[i].toLowerCase().trim() === studentMajor.toLowerCase().trim()) {
      return { index: i, resolved: catalogMajors[i], mismatch: false };
    }
  }
  // 2) Alias match.
  for (const { match, canonical } of MAJOR_ALIASES) {
    if (match.test(studentMajor)) {
      const idx = catalogMajors.findIndex(
        (m) => m.toLowerCase() === canonical.toLowerCase()
      );
      if (idx >= 0) return { index: idx, resolved: canonical, mismatch: false };
    }
  }
  // 3) Best-effort partial match.
  for (let i = 0; i < catalogMajors.length; i++) {
    if (catalogMajors[i].toLowerCase().includes(studentMajor.toLowerCase().slice(0, 4))) {
      return { index: i, resolved: catalogMajors[i], mismatch: true };
    }
  }
  return { index: 0, resolved: catalogMajors[0], mismatch: true };
}

/**
 * Pull the per-major `semesters[]` list off a catalog row, or an
 * empty array when the row has no majors[] column.
 */
export function catalogMajorsFor(row: { majors?: unknown } | undefined): string[] | undefined {
  return Array.isArray(row?.majors) ? (row!.majors as string[]) : undefined;
}

/**
 * Pick the semester number (1..10) for the chosen major, or 0 when
 * the course is not on that major's plan.
 *
 * Catalog rows have a per-row `majors[]` array paired with a
 * `semesters[]` array. Two shapes appear in the wild:
 *   - "wide" rows: `majors` and `semesters` both list every catalog
 *     major. `semesters[majorIdx]` (where `majorIdx` is the index in
 *     the *catalog*'s majors[]) is the semester for the chosen major.
 *   - "narrow" rows: `majors` lists just the majors the course belongs
 *     to (often one), and `semesters` is the same length. In this case
 *     `semesters[0]` means "the semester for the (single) listed
 *     major" — not "the semester for the first catalog major".
 *
 * Resolution algorithm:
 *   1. Look up the major name at `catalogMajors[majorIdx]`.
 *   2. If the row has a `majors[]` column, find that name *inside the
 *      row's own majors[]*:
 *        - found → use that index into `semesters[]`.
 *        - not found → the course is off-plan for this major → 0.
 *   3. If the row has no `majors[]` column (legacy / older catalogs),
 *      use the catalog-major index directly into `semesters[]`.
 */
export function semesterForMajor(
  row: { majors?: unknown; semesters?: unknown },
  majorIdx: number,
  catalogMajors?: string[]
): number {
  const semList = (row.semesters as number[] | undefined) ?? [];
  if (majorIdx < 0) return 0;
  // We can only do the name-based lookup when the caller gave us the
  // catalog's majors[] list. Without it, fall back to the legacy
  // direct-index behaviour (used by tests + a few imports in the
  // current codebase).
  if (catalogMajors && catalogMajors[majorIdx] !== undefined) {
    const majorName = String(catalogMajors[majorIdx]).toLowerCase().trim();
    if (Array.isArray(row.majors)) {
      // Row has a per-row majors[] column. Resolve by name so narrow
      // rows (e.g. MEC242 with majors:['Mechatronics Engineering'],
      // semesters:[7]) still get the right semester for the picked
      // major.
      const found = (row.majors as unknown[]).findIndex(
        (m) =>
          typeof m === 'string' &&
          String(m).toLowerCase().trim() === majorName
      );
      if (found < 0) return 0; // off-plan for this major
      const raw = semList[found];
      return typeof raw === 'number' && raw >= 1 && raw <= MAX_SEMESTER ? raw : 0;
    }
    // No per-row majors[] column (legacy catalog) — fall back to
    // direct indexing by the catalog-major index.
    const raw = semList[majorIdx];
    return typeof raw === 'number' && raw >= 1 && raw <= MAX_SEMESTER ? raw : 0;
  }
  // No catalog majors given — preserve the legacy behaviour so existing
  // tests don't need to be rewritten.
  const raw = semList[majorIdx];
  return typeof raw === 'number' && raw >= 1 && raw <= MAX_SEMESTER ? raw : 0;
}