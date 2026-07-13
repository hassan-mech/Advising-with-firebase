# Per-Student Prerequisite Map — Fix Notes

## 1. The Problem

You have a Python script that reads a raw grade-book Excel file and computes, for every student:

- `get_student_info(id)` — filter rows for one student
- `get_cumaltive_gpa(id)` — last-term cumulative GPA
- `get_total_units(id)` — total earned units (deduped by course)
- `get_failed_subject(id)` — courses where **every** attempt started with `F`
- `get_failed_student(df)` — IDs of students who have at least one such course
- `check_course_state(id, course)` — passed / failed for a single course
- `check_courses_state(id, courses)` — AND across a list
- `get_course_failed_from_list(id, courses)` — subset of prereqs still missing

You then wanted each student to see a **personalized prerequisite map** in the
React/TypeScript app (`academic-planner`) once that Excel was imported.

Two things were blocking that flow:

1. **`handleImportPlan` in `App.tsx` only understood the *Term-Plan* shape**
   (`Student_ID, Term_ID, Term_Name, Course_Code`). It never read the
   *grade-book* columns you used in Python (`student_id`, `course`, `units`,
   `grade`, `term`, `cumulative_gpa`). So `courseHistory` and
   `completedCourses` were never populated from the Excel, and
   `Student.courseHistory` stayed empty.

2. **The Python logic itself never ran inside the browser.** The app only had
   `src/utils/studentMetrics.ts` which already covers the *passed/failed*
   semantics, but it operated on the empty `courseHistory`. The other helpers
   (GPA extraction, unit counting, bulk failed-student detection) had no
   TypeScript counterpart, so even a perfectly imported file would not drive
   the UI.

The Explorer ("Prerequisite Map") screen **does** already render one map per
selected student — `ExplorerScreen.tsx` reads `activeStudent.completedCourses`
and `activeStudent.courseHistory` through `isCoursePassed`. The chain only
breaks because the import never feeds it real data.

---

## 2. The Fix (file-by-file)

### 2.1 `src/utils/studentMetrics.ts` — extended, not replaced

The existing file already has the right semantics for "did the student pass
this course?" (`isCoursePassed`) and for `calculateGPA`. We added:

| New export             | Python equivalent               | Purpose                                                                                                |
| ---------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `studentMetricsFromExcel` | `get_student_info` / friends   | Pure transform: take the raw Excel rows and produce the per-student derived numbers (GPA, units, fails). |
| `buildStudentFromExcelRows` | entire Python pipeline         | One-call helper that takes the array of Excel rows plus the catalogue of courses and produces a fully populated `Student` (with `courseHistory`, `completedCourses`, `gpa`, `creditsEarned`). |
| `extractFailedStudents` | `get_failed_student`           | Bulk helper that returns the IDs of every student who still has a failed course (every attempt starts with `F`). |
| `missingPrereqsForCourse` | `check_course_state` + list     | Returns the subset of a course's prereqs the student has not yet passed (used by the prereq map to colour nodes red). |

All "passed" rules follow the original Python rules:

- A course is **passed** iff **at least one attempt's grade does NOT start with `F`** (the `F`, `FD`, `FA` cases from Python).
- A course is **failed** iff it has attempts and **all of them** start with `F` — same rule Python uses inside `get_failed_subject`.
- `cumulative_gpa` is read from the **last term** the student appears in (matches `get_cumaltive_gpa`).
- `total_units` is summed across **unique course codes** with numeric `units`, matching `get_total_units`.

### 2.2 `src/App.tsx` — `handleImportPlan` rewritten

The old importer ignored everything except Term/Course columns. The new
importer:

1. Auto-detects which sheet shape is present:
   - **Grade-book shape** (has `student_id` / `course` / `grade` / `units` / `term` / `cumulative_gpa` columns) → builds `courseHistory` and `completedCourses` per student via `buildStudentFromExcelRows`.
   - **Term-plan shape** (`Student_ID, Term_ID, Term_Name, Course_Code`) → kept as-is for backwards compatibility.
2. Creates a `Student` record for any new `student_id` not already in the cohort, using:
   - name = `Student_Name` (if present) or `Student {id}`
   - major = the existing student's major (if the ID was already known) or `"Undeclared"`
   - year = derived from `completedCourses.length`
3. Logs (via `console.info`) the per-student GPA, total units and list of
   failed courses so you can confirm the Python numbers are reproduced.

After import, `students` contains a `courseHistory` array per student, which
is exactly what `ExplorerScreen` and `PlannerScreen` need to draw the
prerequisite map and validate plans.

### 2.3 `src/components/ExplorerScreen.tsx` — already personal

No changes required. The screen already:

- Picks `activeStudent` from the `StudentSelector`.
- Reads `completedCourses` and `courseHistory` for that student.
- Uses `isCoursePassed(activeStudent, code)` to colour nodes.
- Draws one map per student.

After the import fix, opening the Explorer for any imported student shows
their map with **completed** edges highlighted in emerald, **locked** edges
dashed-grey, and **planned** nodes in blue — exactly the behaviour you
described.

### 2.4 `src/components/PlannerScreen.tsx` — already validates prereqs

The planner validates each term against the active student's
`completedCourses`. Because the import now populates those, the validator
will produce real warnings for any imported student who is planning a course
whose prereqs they have not passed.

---

## 3. Expected Excel Shape (grade-book)

The importer accepts the exact columns your Python script uses:

| Column            | Required | Notes                                  |
| ----------------- | -------- | -------------------------------------- |
| `student_id`      | ✅       | matches `Student.id` (string)          |
| `course`          | ✅       | course code, e.g. `MEC011`             |
| `units`           | optional | numeric; blank rows are skipped        |
| `grade`           | ✅       | `A`, `B+`, `F`, `FD`, `FA`, `U`, ...   |
| `term`            | optional | used to pick the "last term" for GPA   |
| `cumulative_gpa`  | optional | last-term value overrides `calculateGPA` |
| `Student_Name`    | optional | used when creating new student records |
| `Major`           | optional | used when creating new student records |

Header matching is case-insensitive and tolerates common variants
(`student_id` / `Student_ID` / `ID`, `course` / `Course_Code`, etc.).

---

## 4. How to Verify

1. Run `npm run dev` (or `npm run build`) — no new dependencies were added.
2. In the app, go to **Cohort Overview** → import your grade-book Excel.
3. Pick any student from the `StudentSelector`.
4. Open **Prerequisite Map** — the nodes for passed courses are emerald,
   planned courses are blue, and every course whose prereqs include a
   failed course is rendered as locked/dashed.
5. Open **Term Builder** → click **Validate Plan** — you should see real
   prerequisite errors for that student's plan (or "Verification Succeeded"
   if their plan is valid).
6. Open the browser DevTools console — you'll see one `INFO` line per
   imported student: `Imported {id} → GPA=…, units=…, failed=[…]`. These
   numbers should match what your Python pipeline prints.

---

## 5. Files Changed

- `src/utils/studentMetrics.ts` — added four exports (kept existing API).
- `src/App.tsx` — replaced `handleImportPlan` with a grade-book-aware importer;
  no other handlers touched.

No other files needed changes — the Prerequisite Map, the Planner validator
and the Detail Sidebar were already wired to read `courseHistory` /
`completedCourses`. They simply had no data before this fix.

---

## 6. Follow-up Changes (color + credit-hours fix)

### 6.1 Failed courses now show as **red** on the Prerequisite Map

- New export `getFailedCoursesForStudent(student)` in
  `src/utils/studentMetrics.ts` returns the list of course codes where every
  attempt starts with a failing grade (`F` / `FD` / `FA` / `FL`). It mirrors
  Python's `get_failed_subject(id)` but operates on the React `Student`
  shape instead of raw rows, so the Explorer (which only has the built
  `Student`) can call it directly.
- `ExplorerScreen.tsx → getNodeStatus(code)` now checks the failed-set
  **first**. A failed course wins over `completed` / `planned` / `locked` /
  `available` so the warning is always visible.
- Failed node styling: `border-red-500 bg-red-500/15 text-red-300 ring-1 ring-red-500/40`,
  the badge uses a red background, the icon becomes `AlertTriangle`, and a
  small **FAILED** label appears next to the credit count.
- The legend at the top of the map gained a **Failed** swatch so the colour
  is documented in-app.

### 6.2 `creditsEarned` is now passed-courses-only

Previously the importer set `Student.creditsEarned` to the sum of units
across **all** rows (including failed attempts). The fix in
`buildStudentFromExcelRows` now:

1. Builds `passedSet` — same rule as before (at least one attempt not
   starting with `F`).
2. Sums `credits` **only** for courses in `passedSet`, deduplicated by course
   code. Failed courses contribute 0 to `creditsEarned`.

So a student who registered for a 3-credit course and failed it contributes
0 to earned credits, not 3 — which matches the intuition behind "credits
*earned*". Python's `get_total_units` returns the same number for a student
who passed everything; for a student who failed a course, the Python
pipeline's number was off by exactly the failed-course credits, which is
why your spreadsheet showed 76 instead of 70.

The `totalUnits` reported to the console (`Imported {id} → GPA=…, units=…, failed=[…]`)
is the same earned-only number, so the console log will now match what the
Python pipeline should have been reporting.

---

## 7. Follow-up #2 — Failed courses no longer counted as complete + cleaner edges

### 7.1 Failed courses are no longer counted as "completed"

`ExplorerScreen.tsx` now derives a **filtered** completed set before doing
any of the node / edge work:

```ts
const failedCourseSet = new Set(getFailedCoursesForStudent(activeStudent));
const completedCourses = rawCompletedCourses.filter((c) => !failedCourseSet.has(c));
```

Because every other check (`getNodeStatus`, edge `isSourceCompleted` /
`isTargetCompleted`, the "all prereqs met" check, the header count) reads
from this filtered `completedCourses`, a failed course can never satisfy a
prerequisite. So a downstream course whose prereq was failed no longer
shows emerald / "Completed Path" — it stays locked.

`getNodeStatus` still checks `failedCourseSet` first, so the failed node
itself is always red.

### 7.2 Prerequisite edges now point at the actual card border

The old connection code used a hardcoded 40-pixel vertical offset for both
the source and the target, which sliced through the middle of every card
regardless of its real height and never landed cleanly on the prereq card.

The new code computes a **port** on each card based on the relative
position of source vs target:

- If the target is mostly to the **right** of the source, the line exits
  the **right edge midpoint** of the prereq card and enters the **left edge
  midpoint** of the dependent card.
- If the target is mostly **above or below** the source (i.e. cards in the
  same column row), the line exits the **bottom edge** of the prereq and
  enters the **top edge** of the dependent.
- The card height used for the midpoint is **96px** for a plain card and
  **116px** when the FAILED label is shown, so the line still lands in the
  middle of the visual card even when the red label pushes the height up.

The cubic-Bézier control points are also recomputed along the chosen axis
(horizontal handles when going left→right, vertical handles when going
top→bottom), so the curve bends naturally instead of as a flat horizontal
arc.

The arrowhead marker itself was tightened: `refX` is now `10` (the full
width) instead of `9`, and `markerUnits="userSpaceOnUse"` was added so the
arrow tip is exactly at the path endpoint with no 1-px gap.

---

## 8. Follow-up #3 — Summer 2025/2026 styling for Excel-imported students

Only **Excel-imported students** get the new Summer treatment — the seeded
mock students are unchanged.

### 8.1 Default Summer terms pre-seeded on import

`buildStudentFromExcelRows` in `src/utils/studentMetrics.ts` now returns a
default plan skeleton of two empty terms (`Summer 2025`, `Summer 2026`)
when the student record is **brand-new** (i.e. did not exist in the
cohort before the import). Existing planned terms are preserved on
re-import / merge, so users who already customised a plan are not
overwritten.

### 8.2 Pink/yellow styling

A new `isSummerTerm(input)` helper in `src/utils/studentMetrics.ts`
matches any term whose id or name contains `summer` (case-insensitive).
Both the Planner (`PlannerScreen.tsx`) and the Explorer
(`ExplorerScreen.tsx`) consume it:

- **Planner** — the entire Summer column is wrapped in a pink-accent
  border + soft pink/yellow gradient; the column header shows a `Summer`
  pill badge; the total-credits footer uses pink/yellow text. Every
  course card placed in a Summer term gets a yellow background, yellow
  border, yellow code badge, and a yellow "Summer" satisfied pill instead
  of the regular emerald "Satisfied".
- **Explorer** — a course that is planned in a Summer term is rendered
  with a yellow border + yellow icon instead of the default blue
  "Planned". The legend gained a `Summer Planned` swatch.
- The warning border still wins over the Summer styling if the
  prereqs are missing.

---

## 9. Follow-up #4 — Export / Import Student Data + Plans

A new section was added to the Cohort Overview → **Settings** tab
(`src/components/CohortScreen.tsx`) titled **"Imported Student Data +
Plans"**. It lives next to the existing "Export Workspace Configuration"
section and is independent of it — you can use either or both.

### 9.1 Export — `Export Students + Plans (.xlsx)`

Produces a two-sheet workbook:

- **`Students`** — one row per student with: `Student_ID`, `Student_Name`,
  `Major`, `Year`, `Credits_Earned`, `Total_Credits_Required`, `Status`,
  `GPA`, `Failed_Courses` (pipe-separated course codes), and
  `Completed_Courses` (pipe-separated). The failed list is computed via
  `extractFailedStudents(rows)` so it matches the Python pipeline.
- **`Plans`** — one row per (student, term, course), plus rows with an
  empty `Course_Code` to record empty terms the student already has in
  their plan. Columns: `Student_ID`, `Student_Name`, `Major`, `Term_ID`,
  `Term_Name`, `Course_Code`.

### 9.2 Import — `Import Students + Plans (.xlsx)`

Reads the same two-sheet format. Behaviour:

- **New students** (id not in the cohort) are added with the imported
  fields and an avatar derived from the last two digits of the id.
- **Existing students** have their `name`, `major`, `year`, credits,
  status, GPA and completed courses overwritten with the imported values
  (so the file is the source of truth), but their `courseHistory` and
  any user-edited data not in the file is preserved.
- The `Plans` sheet (if present) **replaces** each student's
  `plannedTerms` with what's in the file — terms are grouped by
  `(Term_ID, Term_Name)` and courses inside each term are deduped.

The existing `Export Configuration` / `Restore Configuration` JSON
buttons remain untouched, so nothing else in the workspace is affected.

---

## 10. Follow-up #5 — Prev/Next student nav respects filters and stays in place

Two small but annoying issues with the Prev/Next student buttons on the
Prerequisite Map were addressed.

### 10.1 The buttons moved when a student's name was long

The header bar was a single `flex-col sm:flex-row` containing both the
title (`"Viewing Prerequisite Map: {name}"`) and the controls. On wide
viewports, a long student name pushed the dropdown + nav cluster sideways
(or down onto a second row on tighter widths).

The header is now a two-row layout on small screens and a two-column
layout on `xl+`. The title block has `min-w-0 flex-1` and uses
`truncate`, so a long name is clipped with an ellipsis instead of
pushing the controls. The controls row has `shrink-0 self-start
xl:self-center` so it sits in the top-right corner regardless of the
title's length.

### 10.2 The buttons ignored the StudentSelector's filters

The dropdown's search box and metric filters (`minGpa`, `minCredits`,
`hasFailures`) were local state inside `StudentSelector`, so the
prev/next buttons walked the full `students` array. A user who typed
"Anna" in the search box and clicked next would jump to someone
*outside* the filtered list.

**`StudentSelector.tsx`** now supports controlled filter state
(`searchQuery`, `filters`, `setSearchQuery`, `setFilters`) while still
falling back to local state when those props are omitted — so the
other call site (`PlannerScreen`) keeps working unchanged. The filter
logic itself was extracted into a reusable `applyStudentFilters`
helper exported from the same file.

**`ExplorerScreen.tsx`** lifts the filter state, computes the filtered
cohort via `applyStudentFilters`, and the prev/next buttons walk
*that* list (with wrap-around). The position counter (`3 / 12`) now
shows the position inside the filtered list, not the full cohort.

A small inline hint appears under the bar when the active student is
hidden by the current filter, and a rose warning appears when no
students match.

---

## 11. Follow-up #6 — "Add to Plan" defaults to the active student's first term (yellow on Excel students)

### 11.1 The bug

When opening a course from the **Catalog** or **Prerequisite Map** and
clicking **Add to Plan**, the new card never turned yellow even for
Excel-imported students — whose default planned terms are Summer
2025 / Summer 2026 and therefore should have triggered the yellow
summer styling on the card immediately.

Root cause: two defaults were hard-coded to `fall-2026`:

1. `App.tsx → handleAddToPlanner(code, termId = 'fall-2026')` — used
   by CatalogScreen and ExplorerScreen via the Detail Sidebar's
   `onAddToPlanner` callback.
2. `DetailSidebar.tsx → const [selectedTermId, setSelectedTermId] =
   useState('fall-2026')` — the term picker's initial value.

So even though the Detail Sidebar's `<select>` let the user choose a
different term, the default on first paint was always Fall 2026 — a
non-summer term — and the add went there.

### 11.2 The fix

**`App.tsx → handleAddToPlanner`** now derives the target term from
the active student's plan when no explicit `termId` is passed:

```ts
const targetTermId =
  termId && termId.length > 0
    ? termId
    : targetStudent?.plannedTerms?.[0]?.id || 'fall-2026';
```

For Excel-imported students this resolves to `'summer-2025'`
(yellow); for mock students it resolves to `'summer-2026'` (also
yellow, since their first seeded term in `data.ts` is Summer 2026);
the hard-coded `'fall-2026'` only kicks in when the student has no
planned terms at all.

**`DetailSidebar.tsx`** initialises `selectedTermId` lazily from
`plannedTerms?.[0]?.id`, removing the brief window where the picker
showed Fall 2026 before the `useEffect` ran.

The Term Builder's own "Add" button (in the Course Bank sidebar) and
its `handleAddFromPanel` already used `plannedTerms[0]?.id` and were
unchanged — they were already routing to a Summer term.