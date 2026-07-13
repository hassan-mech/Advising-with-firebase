/**
 * RegistrationFormPrint — print-only DOM tree.
 *
 * One A4 portrait page per (student × term) pair, matching the NMU
 * "Academic Registration Form" template (red banner + bilingual
 * student info + per-course table with NEW/Enhancing/Repeated
 * checkmarks + notes/recap section + signature rows).
 *
 * ── Changes from the previous version ──────────────────────────────
 * 1. Header: two logo cells (university seal + faculty seal), both
 *    on the left, title centered, "FACULTY OF ENGINEERING" text on
 *    the right — matches reg-top-banner's flex layout in print.css.
 * 2. Added a dedicated Level/Term banner row (red "Level N" box next
 *    to the red term ribbon) instead of tucking "Level 1" under h2.
 *    Level comes straight from `metric.level` (StudentLevel).
 * 3. Student info table flipped to VALUE → LABEL column order,
 *    matching the source spreadsheet (A=value, D=label, F=value,
 *    I=label). Email / national ID now pull from roster/metrics
 *    (both types already carry these fields) instead of rendering
 *    blank. Phone and warning count still have no home in your data
 *    model, so those two cells stay blank for the office to fill in
 *    by hand — same as the paper form leaves them.
 * 4. Course table total row shows per-column subtotals for
 *    New/Enhancing/Repeated CH instead of one merged label.
 * 5. Removed the "Financial Receivables" table — it isn't part of
 *    the target form.
 * 6. Added the ملاحظات (notes) block: CGPA / Total Earned CHs /
 *    Total Earned Points line, plus two recap lists — courses loaded
 *    this term, and failed courses (sourced straight from
 *    `metric.failedCourseCodes`, no guessing required).
 *
 * Total Earned Points isn't a field on StudentMetrics yet, so it's
 * computed here from the raw grade rows using the standard 4.0 scale
 * (A=4, A-=3.7, B+=3.3, ... F=0), summed as units × gradePoint across
 * every row for the student. This mirrors the source spreadsheet's
 * formula but does NOT deduplicate retakes — if your registrar rule
 * only counts the latest attempt of a repeated course, adjust
 * `computeTotalPoints()` accordingly.
 */

import { useMemo } from 'react';
import type {
  CatalogCourse,
  CourseCatalog,
  DataState,
  GradeRow,
  RosterEntry,
  StudentMetrics,
} from '../data/types';
import { normalizeCourseCodeLoose } from '../data/normalize';

export interface RegistrationFormPrintProps {
  state: DataState;
  catalogIndex: Map<string, CatalogCourse>;
  roster: RosterEntry[];
  /** When set, only render this student's form (per-student print). */
  studentId?: string;
  /** When set, restrict the bulk view to this term. */
  termId?: string;
  /** Per-student metrics from DataContext. */
  metricsByStudent?: Record<string, StudentMetrics>;
  /**
   * Phone / academic-warning count per student. Neither field exists
   * on RosterEntry or StudentMetrics today — pass this in once you
   * have a source for them; until then both cells render blank.
   */
  extraInfoByStudent?: Record<string, { phone?: string; warningsCount?: number }>;
  uniLogoSrc?: string;
  facultyLogoSrc?: string;
}

interface FormRow {
  courseCode: string;
  courseTitle: string;
  credits: number;
  prereq: string;
  status: 'new' | 'enhancing' | 'repeated';
}

interface FormGroup {
  studentId: string;
  studentName: string;
  major: string;
  termName: string;
  rows: FormRow[];
  totalCH: number;
  totalsByStatus: { new: number; enhancing: number; repeated: number };
}

/** "Summer2026" -> "Summer 2026"; pass through anything that doesn't match. */
function formatTermName(termName: string): string {
  const m = termName.match(/^([A-Za-z]+)(\d{4})$/);
  return m ? `${m[1]} ${m[2]}` : termName;
}

/** Escape any string for safe interpolation into HTML. */
function escapeHtml(s: string): string {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/** Pre-built catalog index, lookup-tolerant of "MEC 11" vs "MEC011". */
function lookupCourse(
  catalogIndex: Map<string, CatalogCourse>,
  code: string
): CatalogCourse | undefined {
  const direct = catalogIndex.get(code.trim().toUpperCase());
  if (direct) return direct;
  const norm = normalizeCourseCodeLoose(code);
  for (const [k, v] of catalogIndex) {
    if (normalizeCourseCodeLoose(k) === norm) return v;
  }
  return undefined;
}

/** Standard 4.0-scale grade-point map, matching the source workbook. */
function gradeToPoint(grade: string): number {
  const g = grade.trim().toUpperCase();
  if (g.startsWith('F')) return 0; // F, FD, FA, FL
  const table: Record<string, number> = {
    'A+': 4, A: 4, 'A-': 3.7,
    'B+': 3.3, B: 3, 'B-': 2.7,
    'C+': 2.3, C: 2, 'C-': 1.7,
    'D+': 1.3, D: 1,
  };
  return table[g] ?? 0;
}

/** Σ(units × gradePoint) across every grade row for the student. */
function computeTotalPoints(rows: GradeRow[], studentId: string): number {
  return rows
    .filter((r) => r.studentId === studentId)
    .reduce((sum, r) => sum + (r.units || 0) * gradeToPoint(r.grade || ''), 0);
}

/** Build the per-student FormGroup for a given term entry. */
function buildFormGroup(
  studentId: string,
  studentName: string,
  major: string,
  termName: string,
  courseCodes: string[],
  rows: GradeRow[],
  catalogIndex: Map<string, CatalogCourse>
): FormGroup {
  const attempted = new Set(
    rows
      .filter((r) => r.studentId === studentId)
      .map((r) => normalizeCourseCodeLoose(r.course))
  );

  const formRows: FormRow[] = courseCodes.map((code) => {
    const cat = lookupCourse(catalogIndex, code);
    const credits = typeof cat?.credits === 'number' ? cat.credits : 0;
    const prereq =
      cat && Array.isArray(cat.prerequisites) && cat.prerequisites.length > 0
        ? cat.prerequisites.join(', ')
        : '-';
    const status: FormRow['status'] = attempted.has(normalizeCourseCodeLoose(code))
      ? 'repeated'
      : 'new';
    return { courseCode: code, courseTitle: cat?.title?.trim() || '(course not in catalog)', credits, prereq, status };
  });

  const totalsByStatus = formRows.reduce(
    (acc, r) => {
      acc[r.status] += r.credits || 0;
      return acc;
    },
    { new: 0, enhancing: 0, repeated: 0 }
  );

  return {
    studentId,
    studentName,
    major,
    termName,
    rows: formRows,
    totalCH: formRows.reduce((sum, r) => sum + (r.credits || 0), 0),
    totalsByStatus,
  };
}

export default function RegistrationFormPrint({
  state,
  catalogIndex,
  roster,
  studentId,
  termId,
  metricsByStudent,
  extraInfoByStudent,
  uniLogoSrc = '/assets/nmu-seal.png',
  facultyLogoSrc = '/assets/engineering-seal.png',
}: RegistrationFormPrintProps) {
  // Name + major + email + nationalId, roster wins, falls back to the
  // first matching grade-book row for name/major only (email/national
  // ID aren't on GradeRow).
  const infoById = useMemo(() => {
    const m = new Map<
      string,
      { name: string; major: string; email?: string; nationalId?: string }
    >();
    for (const r of roster) {
      m.set(r.studentId, {
        name: r.studentName?.trim() || `Student ${r.studentId}`,
        major: r.major?.trim() || 'Undeclared',
        email: r.email,
        nationalId: r.nationalId,
      });
    }
    for (const row of state.rows) {
      if (!m.has(row.studentId)) {
        m.set(row.studentId, {
          name: row.studentName?.trim() || `Student ${row.studentId}`,
          major: row.major?.trim() || 'Undeclared',
        });
      }
    }
    return m;
  }, [roster, state.rows]);

  const term = useMemo(
    () => state.terms.find((t) => t.id === termId),
    [state.terms, termId]
  );

  const groups = useMemo<FormGroup[]>(() => {
    if (!term) return [];
    const out: FormGroup[] = [];
    if (studentId) {
      const entry = term.entries.find((e) => e.studentId === studentId);
      const meta = infoById.get(studentId);
      out.push(
        buildFormGroup(
          studentId,
          meta?.name ?? `Student ${studentId}`,
          meta?.major ?? 'Undeclared',
          term.name,
          entry?.courseCodes ?? [],
          state.rows,
          catalogIndex
        )
      );
      return out;
    }
    const sortedEntries = [...term.entries].sort((a, b) =>
      a.studentId.localeCompare(b.studentId)
    );
    for (const entry of sortedEntries) {
      if (entry.courseCodes.length === 0) continue;
      const meta = infoById.get(entry.studentId);
      out.push(
        buildFormGroup(
          entry.studentId,
          meta?.name ?? `Student ${entry.studentId}`,
          meta?.major ?? 'Undeclared',
          term.name,
          entry.courseCodes,
          state.rows,
          catalogIndex
        )
      );
    }
    return out;
  }, [term, studentId, infoById, state.rows, catalogIndex]);

  if (!term || groups.length === 0) {
    return <div data-print="registration-forms" />;
  }

  return (
    <div data-print="registration-forms">
      {groups.map((g) => (
        <StudentFormPage
          key={`${g.studentId}-${term.id}`}
          group={g}
          metric={metricsByStudent?.[g.studentId]}
          extra={extraInfoByStudent?.[g.studentId]}
          info={infoById.get(g.studentId)}
          allRows={state.rows}
          catalogIndex={catalogIndex}
          uniLogoSrc={uniLogoSrc}
          facultyLogoSrc={facultyLogoSrc}
        />
      ))}
    </div>
  );
}

function StudentFormPage({
  group,
  metric,
  extra,
  info,
  allRows,
  catalogIndex,
  uniLogoSrc,
  facultyLogoSrc,
}: {
  group: FormGroup;
  metric?: StudentMetrics;
  extra?: { phone?: string; warningsCount?: number };
  info?: { email?: string; nationalId?: string };
  allRows: GradeRow[];
  catalogIndex: Map<string, CatalogCourse>;
  uniLogoSrc: string;
  facultyLogoSrc: string;
}) {
  const today = new Date().toLocaleDateString('en-GB');

  const cgpaText = metric && Number.isFinite(metric.gpa) ? metric.gpa.toFixed(3) : '—';
  const earnedHrText =
    metric && Number.isFinite(metric.totalUnits) ? String(metric.totalUnits) : '—';
  const earnedPtsText = metric
    ? computeTotalPoints(allRows, group.studentId).toFixed(2)
    : '—';
  const levelText = metric?.level ?? '—';

  const warningsText =
    extra && typeof extra.warningsCount === 'number' ? String(extra.warningsCount) : '';
  const phoneText = extra?.phone ?? '';
  const emailText = info?.email ?? metric?.email ?? '';
  const nationalIdText = info?.nationalId ?? metric?.nationalId ?? '';

  const loadedCourses = group.rows;

  // Straight from StudentMetrics — no scanning/guessing needed.
  const failedCourses = useMemo(() => {
    const codes = metric?.failedCourseCodes ?? [];
    return codes.map((code) => {
      const cat = lookupCourse(catalogIndex, code);
      return {
        code,
        title: cat?.title?.trim() || '',
        credits: typeof cat?.credits === 'number' ? cat.credits : 0,
      };
    });
  }, [metric, catalogIndex]);

  return (
    <div data-print-page className="reg-page">
      <header className="reg-top-banner">
        <div className="reg-logo-group">
          <div className="reg-logo-cell">
            <img src={uniLogoSrc} alt="" />
          </div>
          <div className="reg-logo-cell">
            <img src={facultyLogoSrc} alt="" />
          </div>
        </div>
        <div className="reg-titles">
          <h1>Academic Registration Form</h1>
          <h2>Academic Year 2025-2026</h2>
        </div>
        <div className="reg-faculty">
          FACULTY OF
          <br />
          ENGINEERING
        </div>
      </header>

      <div className="reg-level-term-row">
        <div className="reg-level-box">{escapeHtml(levelText)}</div>
        <div className="reg-term-banner">{escapeHtml(formatTermName(group.termName))}</div>
      </div>

      <table className="reg-info-table">
        <tbody>
          <tr>
            <td className="reg-value reg-ltr">{escapeHtml(group.studentId)}</td>
            <td className="reg-label">الرقم الأكاديمي:</td>
            <td className="reg-value reg-rtl">{escapeHtml(group.studentName)}</td>
            <td className="reg-label reg-rtl">الاسم:</td>
          </tr>
          <tr>
            <td className="reg-value reg-ltr">{escapeHtml(today)}</td>
            <td className="reg-label">التاريخ:</td>
            <td className="reg-value reg-rtl">{escapeHtml(group.major)}</td>
            <td className="reg-label">البرنامج:</td>
          </tr>
          <tr>
            <td className="reg-value reg-ltr">{escapeHtml(warningsText) || '\u00A0'}</td>
            <td className="reg-label">عدد الإنذارات:</td>
            <td className="reg-value reg-ltr">{escapeHtml(phoneText) || '\u00A0'}</td>
            <td className="reg-label">التليفون:</td>
          </tr>
          <tr>
            <td className="reg-value reg-ltr">{escapeHtml(emailText) || '\u00A0'}</td>
            <td className="reg-label">الإيميل:</td>
            <td className="reg-value reg-ltr">{escapeHtml(nationalIdText) || '\u00A0'}</td>
            <td className="reg-label">الرقم القومي:</td>
          </tr>
        </tbody>
      </table>

      <table className="reg-course-table">
        <thead>
          <tr>
            <th rowSpan={2}>No.</th>
            <th rowSpan={2}>Course Code</th>
            <th rowSpan={2}>Course Title</th>
            <th rowSpan={2}>Pre-requisite</th>
            <th colSpan={3}>CHs</th>
            <th rowSpan={2}>Total CHs</th>
          </tr>
          <tr>
            <th>New<br />CHs</th>
            <th>Enhancing<br />CHs</th>
            <th>Repeated<br />CHs</th>
          </tr>
        </thead>
        <tbody>
          {group.rows.map((r, i) => (
            <tr key={`${r.courseCode}-${i}`}>
              <td className="reg-center">{i + 1}</td>
              <td className="reg-center reg-mono">{escapeHtml(r.courseCode)}</td>
              <td>{escapeHtml(r.courseTitle)}</td>
              <td className="reg-center">{escapeHtml(r.prereq)}</td>
              <td className="reg-center">{r.status === 'new' ? r.credits || '' : ''}</td>
              <td className="reg-center">{r.status === 'enhancing' ? r.credits || '' : ''}</td>
              <td className="reg-center">{r.status === 'repeated' ? r.credits || '' : ''}</td>
              <td className="reg-center">{r.credits || ''}</td>
            </tr>
          ))}
          <tr className="reg-total-row">
            <td colSpan={4} className="reg-right">Total CHs</td>
            <td className="reg-center">{group.totalsByStatus.new || 0}</td>
            <td className="reg-center">{group.totalsByStatus.enhancing || 0}</td>
            <td className="reg-center">{group.totalsByStatus.repeated || 0}</td>
            <td className="reg-center">{group.totalCH}</td>
          </tr>
        </tbody>
      </table>

      <div className="reg-notes-block">
        <div className="reg-notes-title" dir="rtl">ملاحظات</div>
        <div className="reg-metrics-row">
          <div className="reg-metrics-cell">CGPA = {cgpaText}</div>
          <div className="reg-metrics-cell">Total Earned CHs = {earnedHrText}</div>
          <div className="reg-metrics-cell">Total Earned Points = {earnedPtsText}</div>
        </div>

        <table className="reg-recap-table" dir="rtl">
          <thead>
            <tr>
              <th>المواد المحمل بها الطالب طبقاً للخطة الدراسية للطالب</th>
              <th>المواد الراسب بها الطالب</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: Math.max(loadedCourses.length, failedCourses.length, 1) }).map(
              (_, i) => (
                <tr key={i}>
                  <td>
                    {loadedCourses[i]
                      ? `${escapeHtml(loadedCourses[i].courseCode)} ${escapeHtml(
                          loadedCourses[i].courseTitle
                        )} — ${loadedCourses[i].credits} CH`
                      : '\u00A0'}
                  </td>
                  <td>
                    {failedCourses[i]
                      ? `${escapeHtml(failedCourses[i].code)} ${escapeHtml(
                          failedCourses[i].title
                        )}${failedCourses[i].credits ? ` — ${failedCourses[i].credits} CH` : ''}`
                      : '\u00A0'}
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>

      <div className="reg-signatures">
        <div className="reg-sig-row">
          <div className="reg-sig-col">
            <span>التاريخ:&nbsp;&nbsp;/&nbsp;&nbsp;/</span>
          </div>
          <div className="reg-sig-col">
            <span>توقيع الطالب:&nbsp;</span>
            <span className="reg-line" />
          </div>
        </div>
        <div className="reg-sig-row">
          <div className="reg-sig-col reg-rtl">
            <div>مدير البرامج الهندسية</div>
            <div className="reg-sig-name">أ.م.د/ سارة البهلول</div>
          </div>
          <div className="reg-sig-col reg-rtl">
            <div>توقيع المرشد الأكاديمي</div>
            <div className="reg-sig-name">م.م/ صلاح السطوحي</div>
          </div>
        </div>
      </div>

      <footer className="reg-footer">
        <div>
          <div>National Costal Road, New Mansoura City</div>
          <div>https://www.nmu.edu.eg/ | Email: info@nmu.edu.eg</div>
        </div>
        <div className="reg-rtl">
          <div>وزارة التعليم العالي والبحث العلمي</div>
          <div className="reg-ltr">Ministry of Higher Education and Scientific Research</div>
        </div>
      </footer>
    </div>
  );
}

export type { StudentMetrics };