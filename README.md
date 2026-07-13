# Academic Advisor — Project Guide

> A single-file tour of the codebase for **learners** and for **future AI
> sessions** that need to inherit context. Read sections in order; each
> builds on the previous one.

---

## Table of Contents

1. [What this app is](#1-what-this-app-is)
2. [High-level architecture](#2-high-level-architecture)
3. [Directory map](#3-directory-map)
4. [Tech stack & build](#4-tech-stack--build)
5. [The data model (read this first)](#5-the-data-model-read-this-first)
6. [Data layer (`src/data/`)](#6-data-layer-srcdata)
7. [Context + state (`src/data/DataContext.tsx`)](#7-context--state-srcdatadatacontexttsx)
8. [Theme + Print contexts](#8-theme--print-contexts)
9. [Shared reusable modules (`src/components/shared/`)](#9-shared-reusable-modules-srccomponentsshared)
10. [On-screen views (`src/components/*.tsx`)](#10-on-screen-views-srccomponents)
11. [Print trees (the on-demand A4 pages)](#11-print-trees-the-on-demand-a4-pages)
12. [Demo data flow + the empty-state](#12-demo-data-flow--the-empty-state)
13. [Excel import + expected columns](#13-excel-import--expected-columns)
14. [Excel export shapes](#14-excel-export-shapes)
15. [Reading-order checklist for new contributors](#15-reading-order-checklist-for-new-contributors)
16. [Common patterns & idioms](#16-common-patterns--idioms)
17. [How to make changes safely](#17-how-to-make-changes-safely)
18. [Where things can go wrong (gotchas)](#18-where-things-can-go-wrong-gotchas)
19. [Glossary](#19-glossary)

---

## 1. What this app is

**Academic Advisor v2** — a single-page React app that helps an academic
advisor answer four questions about every student in their cohort:

1. *Failed course* — who failed each course?
2. *Blocked next term* — who has courses they can't register for?
3. *Suggest next registration* — for one student, which of their
   catalog courses are open / blocked / failed-prereq?
4. *Planned conflict* — who has put a previously-failed course on a
   future-term plan?

Plus a personal **prereq map** view: a 10-row, semester-by-semester
"what does this student still owe" grid with PASSED / FAILED /
PREREQ-FAILED / BLOCKED / OPEN / PLANNED badges, prereq chains, and
New/Enhancing/Repeated classifications for the active term.

The original system was a Python pipeline (`rewrite_data.js` in the
repo root is the v1 archival port). v2 is a port to React with the
*same* metric rules and formulas; the comments in `metrics.ts`
mirror the Python names (`get_total_units`, `get_failed_subject`, …)
so the codebase stays close to the original mental model.

---

## 2. High-level architecture

```
┌─────────────────────────────────────────────────────────────┐
│  main.tsx → App.tsx                                         │
│                                                              │
│  App.tsx                                                     │
│  ├─ <ThemeProvider>          ← dark/light theme + localStorage│
│  │   └─ <DataProvider>       ← ALL app state lives here      │
│  │       └─ <Shell>                                            │
│  │           ├─ Header (title + ImportButtons + theme toggle)│
│  │           ├─ <main> ← one of:                              │
│  │           │   ├─ RosterTable + AdvisingPanel  ("roster")   │
│  │           │   └─ PrereqMapScreen + PlanPanel ("map")       │
│  │           └─ Print slot ← exactly one PrintTree at a time  │
│  │                                                              │
│  └─ Persistent state: localStorage["ap.v1.data"]              │
└─────────────────────────────────────────────────────────────┘
```

State is **a single React Context** (`DataContext`) — there are no
separate Zustand stores, no Redux. Every component reads and mutates
through `useData()`.

State is **persisted as JSON to `localStorage`** on every mutation
(see `src/data/DataContext.tsx:164`). On reload, `loadData()` in
`src/data/storage.ts` rehydrates, runs a v1→v3 migration, and
seeds a default Term called `"Summer 2025"` if none exists.

Print works by **mounting exactly one print tree at a time** (see
`src/components/PrintContext.tsx`). The on-screen app keeps running;
`print.css` hides everything except the print tree when the browser
fires the print dialog.

---

## 3. Directory map

```
academic-planner/
├── index.html                          ← Vite entry (root div, src/main.tsx)
├── package.json                        ← scripts + deps
├── vite.config.ts                      ← React + Tailwind + path alias '@'
├── tsconfig.json                       ← strict ES2022 + bundler resolution
├── vitest.config.ts                    ← vitest setup
├── README.md                           ← original v2 README (marketing-grade)
├── src/
│   ├── main.tsx                        ← ReactDOM.createRoot
│   ├── App.tsx                         ← Composer: providers + view
│   │
│   ├── data/                           ← PURE TypeScript (no React)
│   │   ├── types.ts                    ← DataState + every record type
│   │   ├── storage.ts                  ← localStorage I/O + JSON export/import
│   │   ├── parseGradeBook.ts           ← Excel → GradeRow[]
│   │   ├── parseCatalog.ts             ← Excel → CourseCatalog
│   │   ├── parseRoster.ts              ← Excel → RosterEntry[]
│   │   ├── normalize.ts                ← course-code canonicalisation
│   │   ├── metrics.ts                  ← GPA/units/level + computed expected GPA
│   │   ├── advising.ts                 ← the four advising queries + failure stats
│   │   ├── filters.ts                  ← pure filter helpers for the prereq map
│   │   ├── majorIndex.ts               ← resolve student major → catalog column index
│   │   ├── prereqMap.ts                ← build the 10-semester map data
│   │   ├── exportPlans.ts              ← Excel writeFile (plans + Failed Courses sheet)
│   │   ├── DataContext.tsx             ← Provider + useData()
│   │   └── *.test.ts                   ← vitest unit tests for each
│   │
│   └── components/
│       ├── Shell.tsx                   ← page chrome + print-tree router
│       ├── ImportButtons.tsx           ← 4 import + 2 export + delete
│       ├── EmptyState.tsx              ← first-load UI + Generate-demo button
│       ├── RosterTable.tsx             ← dense student table
│       ├── AdvisingPanel.tsx           ← 5 tabs of queries
│       ├── StudentDetailModal.tsx      ← course history modal
│       ├── PrereqMapScreen.tsx         ← the on-screen prereq map (the big one)
│       ├── TermManagerModal.tsx        ← CRUD for terms
│       ├── StudentCombobox.tsx         ← searchable student picker
│       ├── CourseCombobox.tsx          ← searchable+filterable course picker
│       │
│       ├── demoData.ts                 ← dev-only "Generate demo rows"
│       │
│       ├── ThemeContext.tsx            ← theme persistence + <html> class
│       ├── PrintContext.tsx            ← which print tree is mounted
│       ├── PrereqMapPrint.tsx          ← print tree: per-student prereq map
│       ├── FailureReportPrint.tsx      ← print tree: leaderboard + distribution + tabular student lists
│       ├── RegistrationFormPrint.tsx   ← print tree: NMU registration form
│       ├── PlanTablePrint.tsx          ← print tree: post-planning tabular roll-up
│       │
│       └── shared/                     ← extracted reusable helpers
│           ├── Modal.tsx               ← centered modal shell (X, esc, click-outside)
│           ├── StatsCard.tsx           ← on-screen stat card (Tailwind)
│           ├── PrintStatCard.tsx       ← print stat card (inline styles, pmaps-* CSS)
│           ├── colorTokens.ts          ← ColorToken + screen/print palettes
│           ├── formatGrade.ts          ← "3.3 - B+" + grade-token helper
│           ├── planStats.ts            ← computePlanStats + buildCreditByCode
│           ├── leaderboardStudents.ts  ← resolveStudentNames helper
│           ├── useClickOutside.ts      ← popover close-on-outside-click hook
│           └── useAutoFocusOnOpen.ts   ← input focus hook
```

`_archive_v1/src/` holds the older prototype; do not import from it.

---

## 4. Tech stack & build

| Tool | Version | Role |
|---|---|---|
| React | 19.x | UI |
| TypeScript | 5.8 strict | types |
| Vite | 6.x | dev server + build |
| Tailwind CSS | 4.x | utility CSS (does **not** see `print.css`) |
| `lucide-react` | — | icons |
| `motion` | 12.x | light animations (used sparingly) |
| `xlsx` (SheetJS) | — | Excel read/write |
| `vitest` | — | unit tests |
| `@google/genai` | — | optional Gemini integration (declared, not actively used in v2) |

Scripts:

```
npm run dev      # vite dev on :3000 (HMR on unless DISABLE_HMR=1)
npm run lint     # tsc --noEmit (strict type-check)
npm test         # vitest run, all tests
npm run build    # vite build → dist/
```

> **HMR note:** `vite.config.ts` respects the env flag `DISABLE_HMR=1`
> so AI-driven edit-and-verify loops don't trigger constant re-renders.
> Set this when you want stable screenshots.

---

## 5. The data model (read this first)

The *one* type every other type refers to is `DataState` in
`src/data/types.ts:174`. Everything else flows from it:

```ts
interface DataState {
  rows: GradeRow[];                         // ← grade-book rows
  catalog: CourseCatalog | null;            // ← course catalog (codes + prereqs)
  roster: RosterEntry[];                    // ← optional name+major lookup
  terms: Term[];                            // ← registration terms
  activeTermId: string | null;              // ← which Term is open in the UI
}
```

### GradeRow
One row from the imported grade-book Excel:

```ts
interface GradeRow {
  studentId: string;            // required; matches RosterEntry.studentId
  course: string;               // required; auto-normalised to canonical form
  units: number;                // credits (0 if blank in the sheet)
  grade: string;                // "A", "B+", "F", "FD", "FL", "U", …
  term: string;                 // "Fall 2024", "Spring 2025-2026", …
  studentName?: string;         // optional; also lives on roster
  major?: string;               // optional; also lives on roster
  cumulativeGpa?: number;       // optional; overrides computed GPA
}
```

### CatalogCourse
One row from the imported course catalog Excel:

```ts
interface CatalogCourse {
  code: string;                 // e.g. "MEC011" — normalised at parse time
  title: string;                // e.g. "Introduction to Mechatronics"
  credits: number;              // numeric (0 if blank)
  prerequisites: string[];      // ["MAT101", "PHY101"]
  [k: string]: unknown;         // ← loose bag: majors[], semesters[],
                                //   semester_mechatronics, etc. live here
}
```

The catalog supports **two shapes** for per-major placement:

*Wide rows* — `majors: ["Civil Eng", "Mechatronics Eng", ...]` +
`semesters: [3, 7, 3, ...]` aligned by index.

*Narrow rows* — `majors: ["Mechatronics Eng"]` + `semesters: [7]`
(only meaningful when there's a single major the course belongs to).

The codebase handles both via `semesterForMajor()` in
`src/data/majorIndex.ts`.

### Term / TermEntry (the v3 plan model)

```ts
interface Term {
  id: string;                   // "term-abc123-xy7z2w"
  name: string;                 // "Summer 2025"
  createdAt: string;            // ISO timestamp
  entries: TermEntry[];         // one entry per student that planned courses
}

interface TermEntry {
  studentId: string;            // exactly one entry per (term, student)
  courseCodes: string[];        // normalised course codes
}
```

The legacy `PlannedTerm[]` shape is still accepted by the storage
migration path (`src/data/storage.ts:54`) so older exports keep
working.

### Other important types

```ts
StudentMetrics {                // derived per-student rollup
  studentId; name; major; gpa;
  totalUnits;                    // sum of unique PASSED credits
  totalFailedUnits;              // sum of unique FAILED credits
  failedCourseCodes;             // ["MEC011"]
  missingPrereqsForNextTerm;     // flattened list across all blocked
  hasPlannedConflict;            // bool: any failed code on any plan?
  currentSemester;               // distinct terms + 1
  level;                         // "Level 0" .. "Level 4" | "Graduated" | "ERROR"
}

AdvisingQuery                   // discriminated union of 4 kinds
CatalogCourseStatus             // per (student, catalog-course): open|blocked|failed-prereq
CourseMapStatus                 // wider variant: +passed|failed|planned
```

---

## 6. Data layer (`src/data/`)

The data layer is **pure TypeScript** (no JSX, no React) so the same
helpers power the UI, the print trees, the tests, and (eventually)
a backend export.

### 6.1 Parsers (Excel → JS)

| File | Input | Output | Tolerates |
|---|---|---|---|
| `parseGradeBook.ts` | `ArrayBuffer` (`.xlsx`) | `GradeRow[]` | synonyms like `Student_ID` / `id` / `student id`; loose course-code normalisation |
| `parseCatalog.ts` | `ArrayBuffer` | `CourseCatalog` | synonyms; `prereqs` cell accepts `;` `,` or ` `; both wide + narrow per-major shapes |
| `parseRoster.ts` | `ArrayBuffer` | `RosterEntry[]` | dedup by id (last row wins); email/nationalId optional |

When in doubt about column detection: `HEADER_SYNONYMS` at the top of
each parser is the source of truth.

### 6.2 `metrics.ts` — the Python-equivalent math

Mirrors the original Python pipeline line-for-line. Functions:

| Function | Returns |
|---|---|
| `letterToPoints(grade)` | 4.0-scale number, or `null` for non-letters |
| `isFailingGrade(grade)` | true for grades starting with F / FD / FL / FA / U |
| `didStudentPassCourse(...)` | any attempt passed? |
| `didStudentFailCourse(...)` | all attempts failed? |
| `rowsForStudent(...)` | filter rows by id |
| `lastTermGpa(...)` | GPA from the most-recent term |
| `compareTerms(a, b)` | academic-year-aware string comparator |
| `parseTerm(str)` | internal: turns "Spring 2025-2026" into `{academicYear:2025, position:1}` |
| `totalPassedUnits(...)` | sum of unique passed-course credits |
| `totalFailedUnits(...)` | sum of unique failed-course credits |
| `studentLevel(...)` | "Level 0"…"Level 4" / "Graduated" / "ERROR" using the user's Excel formula |
| `failedSubjects(...)` | distinct failed codes |
| `checkCourseState(...)` | `'passed' \| 'failed' \| 'missing'` |
| `checkCoursesState(...)` | AND across a list |
| `missingFromList(...)` | courses the student can't take yet |
| `currentSemesterForStudent(...)` | distinct terms + 1 |
| `studentRoster(...)` | merged per-student identity (roster wins over gradebook) |
| `computeExpectedGpa(...)` | the projected GPA after a planned term lands |

### 6.3 `advising.ts` — the four advising queries + the failure-stats leaderboard

Public API:

```ts
catalogStatusForStudent(rows, studentId, catalog, studentMajor?)
  → CatalogCourseStatus[]
  // status ∈ 'open' | 'blocked' | 'failed-prereq'
  // Used by every "what should this student do" answer.

studentsWhoFailedCourse(rows, { courseCode, studentName?, major? }, roster?, catalog?)
  → FailedCourseRow[]

studentsBlockedFromNextTerm(rows, catalog, roster?)
  → BlockedStudentRow[]   // sorted by GPA ASC

suggestNextRegistration(rows, catalog, studentId, studentMajor?)
  → NextRegistrationRow[] // grouped: failed-prereq → blocked → open

studentsWithPlannedConflict(rows, terms)
  → PlannedConflictRow[]

downstreamCoursesFor(catalog, code, majorIdx, catalogMajors?)
  → DownstreamCourse[]    // every catalog row that lists `code` as a prereq

failureStats(rows, catalog?, roster?)
  → FailureStats          // leaderboard + distribution + total counts
```

The `studentsWhoFailedCourse` filter accepts either a string (legacy
single-arg overload) or a `FailedCourseFilter` object — both forms
still work.

### 6.4 `majorIndex.ts` — per-major resolution

Used everywhere a "for this student's major, what semester is X in?"
lookup happens.

```ts
MAJOR_ALIASES   // regex table: "Mechatronics" → "Mechatronics Engineering"
MAX_SEMESTER = 10
catalogMajorsFor(catalogRow)        // → string[] | undefined
resolveMajorIndex(studentMajor, catalogMajors) → { index, resolved, mismatch }
semesterForMajor(course, majorIdx, catalogMajors?) → number (1..10 or 0)
```

`resolveMajorIndex` falls back through three passes:

1. Exact (case-insensitive) match.
2. Regex alias match (catches "Mechatronics" → "Mechatronics Engineering").
3. Best-effort partial match (first 4 chars).

If everything fails it returns `{ index: 0, resolved: catalogMajors[0], mismatch: true }`
so the consumer still renders — the UI just shows
"`major not matched (showing X)`" amber text in the header.

### 6.5 `prereqMap.ts` — the data behind the on-screen map

```ts
buildPrereqMap(catalog, rows, studentId, studentMajor, plan?) → PrereqMapData
```

Returns 10 semester columns with each course classified into one of:

```
'passed'         attempted + passed
'failed'         attempted AND failed
'failed-prereq'  never attempted; one or more prereqs was FAILED
'blocked'        never attempted; one or more prereqs missing (never attempted)
'open'           never attempted; all prereqs passed
'planned'        on the active plan (and never attempted) — wins over open/blocked
'in-program'     off this major's plan (semester[majorIdx] == 0)
```

Also emits a list of prereq edges (`{from, to}[]`) and a major
resolution (`{ resolvedMajor, majorMismatch }`).

### 6.6 `filters.ts` — pure prereq-map filter logic

`MapFilters` shape + `applyMapFilters()` (boolean AND across
search / major / status / progress). Caller passes a callback that
looks up the active term for any given student so the helper stays
free of React state.

### 6.7 `exportPlans.ts` — Excel workbook builder

Builds a multi-sheet workbook:

* one sheet per non-empty `Term`, columns
  `student_id, student_name, email, national_id, major, level, term,
   course_code, course_title, credits, new_ch, enhancing_ch, repeated_ch, status`
* one trailing `Failed Courses` sheet listing every unique failure.

`exportPlansFile(state)` is the browser-side download entrypoint
(uses `XLSX.writeFile`).

### 6.8 `storage.ts` — the localStorage envelope

* `STORAGE_KEY = 'ap.v1.data'`
* `STORAGE_VERSION = 3`
* Payloads are stored as `{ version, state }` — older bare shapes
  are accepted; legacy `plans[]` is migrated into a synthetic
  `Term` named `"Imported"` so no data is lost on upgrade.
* `importDataFile(file)` returns a validated state or a friendly
  error string — the UI surfaces it via `lastError`.

---

## 7. Context + state (`src/data/DataContext.tsx`)

A single `createContext<DataContextValue | null>(null)` plus a
provider + `useData()` hook. **No external state library.**

What `useData()` returns (38 fields/methods, see
`src/data/DataContext.tsx:73-124`):

```ts
{
  // Raw state
  state: DataState;
  // Derived (memoised on state deps)
  metricsByStudent: Record<id, StudentMetrics>;
  catalogIndex: Map<normalisedCode, CatalogCourse>;
  studentCount: number;

  // Mutations
  importGradeBook(file); importCatalog(file); importRoster(file);
  loadDemoRows(rows); loadDemoCatalog(catalog);     // dev-only path
  exportData(); importData(file); deleteData();

  // Query dispatcher — dispatches AdvisingQuery → AdvisingResultRow[]
  query(q);

  // Term actions (all the CRUD + the toggleCourseInActiveTerm helper)
  createTerm(name?); renameTerm(id, name); deleteTerm(id); duplicateTerm(id, name);
  setActiveTerm(id); addCourseToTerm(termId, studentId, code);
  removeCourseFromTerm(...); clearTermForStudent(...);
  toggleCourseInActiveTerm(termId, studentId, code);

  lastError: string | null;
}
```

### Lifecycle

1. **Mount:** reads localStorage → migrates to v3 → seeds `"Summer 2025"`
   term if `terms` is empty.
2. **Persist:** every state change is auto-saved in a `useEffect`.
3. **Memoisation:** `metricsByStudent`, `catalogIndex`, and `roster`
   are `useMemo`'d on the exact deps they need.
4. **Mutations:** use functional setState (`setState(prev => …)`)
   so multiple mutations can run in the same tick without losing data.

### Query dispatcher

`query(q: AdvisingQuery)` is a single function that switches on
`q.kind` and routes to the right pure helper in `data/advising.ts`.
Wrapped in a `useCallback` keyed on `[state.rows, state.catalog,
state.terms, state.roster, metricsByStudent]`.

---

## 8. Theme + Print contexts

### `ThemeContext.tsx`

* `theme: 'dark' | 'light'`, defaulting to the OS preference
  (`prefers-color-scheme`).
* Persists to `localStorage["acadv:theme"]`.
* On every change, sets/removes `<html class="theme-light theme-dark">`
  so `index.css` `:root.theme-light { … }` rules can flip the look.
* Exposes `useTheme()` returning `{ theme, setTheme, toggleTheme }`.

### `PrintContext.tsx`

Only one print tree is ever in the DOM (replaces a previous design
that toggled a `<html>` class — that one raced with the print
dialog).

Kinds: `'prereq-maps' | 'failure-report' | 'reg-form-bulk' |
'reg-form-single' | 'plan-table' | null`. Per-kind payload includes
optional `studentId`, `majorPick`, `theme: 'dark' | 'light'`, and a
monotonically-increasing `version` that becomes the tree's `key`
so a same-button re-click always remounts fresh.

`triggerPrint(setActiveTree, kind, payload)` is the helper:
1. setActiveTree (bumps version)
2. queueMicrotask → 2× `requestAnimationFrame`
3. swap `document.title` to `sanitiseFilename(payload.title)`
4. `window.print()`
5. `afterprint` + 2.5s fallback both restore the title and unmount
   the tree.

The browser's print dialog uses `document.title` as the default
`Save as PDF` filename, hence the swap.

---

## 9. Shared reusable modules (`src/components/shared/`)

Extracted during the v2 refactor. Each one is small and pure.

| File | Purpose | Used by |
|---|---|---|
| `Modal.tsx` | Centered card dialog with backdrop, X, ESC, click-outside. Header is a `headerExtra` slot; body is `children`; footer is `footer`. | `StudentDetailModal`, `TermManagerModal` |
| `StatsCard.tsx` | On-screen "Current standing" / "Plan impact" stat card (Tailwind). | `PrereqMapScreen.PlanStats`, `StudentDetailModal.Stat` |
| `PrintStatCard.tsx` | Print-tree twin of `StatsCard` using inline styles + `pmaps-*` CSS classes. | `PrereqMapPrint` |
| `colorTokens.ts` | `ColorToken = 'emerald' \| 'amber' \| 'rose' \| 'slate' \| 'blue' \| 'cyan' \| 'violet' \| 'orange' \| 'fuchsia'`, plus three maps (`SCREEN_COLOR_CLASS`, `PRINT_COLOR_DARK`, `PRINT_COLOR_LIGHT`) and `gpaToken(gpa)`. **All** colours live here. | every component |
| `formatGrade.ts` | `formatGradeWithPoints(grade)` → `"3.3 - B+"`; `gradeTextToken(grade)` → `ColorToken`. | `PrereqMapScreen`, `PrereqMapPrint` |
| `planStats.ts` | `buildCreditByCode(catalog)` + `computePlanStats(input)` + `classifyPlanCode(code, id, rows)`. | both `PlanStats` strips |
| `leaderboardStudents.ts` | `resolveStudentNames(ids, roster)` → `string[]`. | `AdvisingPanel.LeaderboardRow`, `FailureReportPrint` |
| `useClickOutside.ts` | `useRef<T>` returned from `(active, onOutside)` hook. | both `*Combobox`es |
| `useAutoFocusOnOpen.ts` | `useRef<T>` returned from `(active)` hook. | both `*Combobox`es |

**Important: always reach for the token maps, never the raw class
strings.** `text-emerald-300` should never appear on the screen; use
`SCREEN_COLOR_CLASS[token]` instead.

---

## 10. On-screen views (`src/components/*.tsx`)

### Top level

* `main.tsx` — Vite's `<StrictMode>` + `createRoot` — no logic.
* `App.tsx` — Composes providers, owns the `view: 'roster' | 'map'`
  switch. Two top-level modes; the Shell's "Prereq Map" header button
  flips it.

### Layout

* `Shell.tsx` — sticky header (title, view switch, theme toggle,
  `ImportButtons`), ErrorBanner for `lastError`, and a print-slot
  that mounts exactly one print tree.
* `EmptyState.tsx` — three dropzones (grade-book / roster / catalog)
  + a dev-only `Generate demo rows` button.

### Roster view (default)

* `RosterTable.tsx` — sortable table of every student.
  Click a row → opens `StudentDetailModal`.
* `AdvisingPanel.tsx` — right-hand collapsible panel with 5 tabs:
  * **Failed** — pick a course; see everyone who failed it.
  * **Blocked** — every student with at least one blocked course.
  * **Suggest** — for one student, what should they register? (open
    / blocked / failed-prereq groups).
  * **Failure Stats** — leaderboard + distribution + per-student
    totals with downstream-course cascade for each failed course.
  * **Conflict** — students whose plans include a previously-failed
    course.

### Map view

* `PrereqMapScreen.tsx` — the **largest component** (~1,400 lines).
  Sub-pieces inside it:
  * `PlanStats` — top stat strip (Current standing / Plan impact).
  * `FilterBar` — search + major + progress + status filters.
  * `MapBody` / `SemesterRowView` / `CourseCard` — the actual grid.
  * `PlanPanel` — right-rail term CRUD + course picker for the
    active term.
* `TermManagerModal.tsx` — full CRUD for terms (mounts from
  PrereqMapScreen's term-picker gear icon).

### Comboboxes

* `StudentCombobox.tsx` — used by `PrereqMapScreen` for the
  student picker.
* `CourseCombobox.tsx` — used by `AdvisingPanel` (Failed / Suggest
  tabs) for catalog lookup.

Both use the shared `useClickOutside` + `useAutoFocusOnOpen` hooks.

---

## 11. Print trees (the on-demand A4 pages)

Exactly one of these is mounted by `Shell` at a time, driven by the
`PrintContext`.

| Tree | What it renders | CSS |
|---|---|---|
| `PrereqMapPrint.tsx` | One A4 page per student with the same pass/fail/blocked grid the on-screen map shows. Picks dark or light palette by `payload.theme`. | `pmaps-*` classes + inline styles in `PRINT_COLOR_*` |
| `FailureReportPrint.tsx` | Course leaderboard + distribution + per-course downstream cascade + a tabular `(ID, Student Name, Major)` supplement per failed course + a cohort-wide "All students" roll-up (ID, Name, Major, Total Hours, Failed Courses with code + title, Expected GPA). Always prints light. | `preport-*` classes, mostly inline styles; the two tabular supplements use real `<table>` elements so the cells are drag-selectable |
| `RegistrationFormPrint.tsx` | NMU registration form — one page per student (or one page for one student). | `regform-*` classes |
| `PlanTablePrint.tsx` | Tabular roll-up across every student that planned at least one course on the active term: `ID, Student Name, Major, Current GPA, Total Hours (passed + failed), New / Repeated / Enhancing CH, Expected GPA, New Total Hours`. One A4 page. | `preport-plan-table` class — real `<table>`, monospaced right-aligned numerics, footer row with totals |

Print trees intentionally **don't use Tailwind**: Tailwind's content
scanner doesn't visit `print.css`, so hand-rolled classes plus
inline `style={{…}}` (using the `PRINT_COLOR_DARK` /
`PRINT_COLOR_LIGHT` maps) is the only way to get the right colours.

CSS for print lives in `print.css` at the project root (loaded once
in `index.html`); `@media print` hides the on-screen app and shows
only the active tree, with `[data-print-page]` page-breaks.

---

## 12. Demo data flow + the empty-state

When the user first opens the app, nothing is loaded. The flow:

1. `Shell` renders → `main` shows `EmptyState` (because
   `state.rows.length === 0`).
2. `EmptyState` exposes three file dropzones plus (in DEV mode
   only) a "Generate demo rows" button.
3. Clicking the demo button calls **both** `loadDemoRows(...)` and
   `loadDemoCatalog(...)` (`src/components/demoData.ts`). This
   bootstraps a small but coherent dataset so the user can exercise
   the UI immediately without uploading an Excel.
4. Reload renders the **`Roster` view** (because `state.rows.length
   > 0`).

The demo dataset covers **3 majors** (Mechatronics Engineering /
Civil Engineering / Biomedical Engineering) and intentionally
includes a couple of failures so the advising queries have something
to show.

---

## 13. Excel import + expected columns

Headers are **case-insensitive** and **tolerant of synonyms**
(defined in `HEADER_SYNONYMS` at the top of each parser).

### Grade-book (`.xlsx` / `.xls` / `.csv`)

| Column | Required | Synonyms |
|---|---|---|
| `student_id` | ✅ | `Student_ID`, `id`, `student id` |
| `course` | ✅ | `course_code`, `coursecode` |
| `grade` | ✅ | `final_grade`, `finalgrade` |
| `units` | optional | `unit`, `credit_hours`, `credits`, `credit hours` |
| `term` | optional | `semester` |
| `cumulative_gpa` | optional | `cum_gpa`, `cgpa`, `gpa` |
| `student_name` | optional | `studentname`, `name` |
| `major` | optional | `department` |

### Course catalog (`.xlsx`)

| Column | Required | Notes |
|---|---|---|
| `code` | ✅ | normalised at parse |
| `title` | optional | defaults to the code |
| `credits` | optional | numeric |
| `prerequisites` | optional | accepts `;` or `,` delimiters |
| `majors` | optional | one entry per catalog major |
| `semesters` | optional | one entry per major, JSON array or CSV |
| `semester_<key>` | optional | per-major columns override above; `<key>` ∈ `petrol/arch/aero/civil/mechatronics/biomed` |

### Roster (`.xlsx`)

| Column | Required | Synonyms |
|---|---|---|
| `student_id` | ✅ | `ID`, `student id` |
| `student_name` | optional | `name`, `full_name`, `full name` |
| `major` | optional | `program`, `department` |
| `email` | optional | `e-mail`, `email address` |
| `national_id` | optional | `nationalid`, `national id`, `ssn`, `id number` |

---

## 13a. Data management (CRUD + bulk import/delete)

The header `Manage data` button opens `DataManagerModal`
(`src/components/DataManagerModal.tsx`), a single modal with three tabs
(Grade-book / Catalog / Roster). Each tab is a self-contained
list-with-actions editor: search box, multi-select checkboxes, inline
edit row, "Add row", "Delete selected", "Clear all", and "Append from
file".

### Mutators on `useData()`

Added in `src/data/DataContext.tsx`, all build state immutably and
persist via the same `useEffect → saveData` channel as the rest of
the app.

| Mutator | Behaviour |
|---|---|
| `addGradeRow(row)` | Reject if `(studentId, course, term)` collides |
| `updateGradeRow(key, patch)` | No-op if key missing |
| `deleteGradeRows(keys[])` | Bulk by key, silent skip on misses |
| `clearGradeRows()` | Empty the grade-book (caller should `confirm`) |
| `importGradeBookAppend(file)` | Parse → merge, skip duplicate keys |
| `addCatalogCourse(c)` | Reject if normalised `code` already exists |
| `updateCatalogCourse(code, patch)` | Match by normalised code |
| `deleteCatalogCourses(codes[])` | Bulk by normalised code |
| `clearCatalog()` | Empty the catalog |
| `importCatalogAppend(file)` | Append by normalised code |
| `addRosterEntry(r)` | Reject if `studentId` already exists |
| `updateRosterEntry(id, patch)` | Match by studentId |
| `deleteRosterEntries(ids[])` | Bulk by studentId |
| `clearRoster()` | Empty the roster |
| `importRosterAppend(file)` | Append by studentId |

The `GradeRowKey` type lives in `src/data/types.ts` as
`{ studentId; course; term }` — kept as a tuple (not a stringified key)
so callers can `Set` and `.map()` it cleanly.

### Replace vs. append semantics

| Trigger | Mode |
|---|---|
| Header `Grade-book` / `Roster` / `Catalog` buttons | **Replace** (wholesale) |
| Header `Import` (JSON) button | **Replace** (wholesale) |
| Modal "Append from file" | **Append** (skip duplicates) |
| Modal per-row Add / Edit / Delete | Per-row mutation |

The two paths share the same parsers (`parseGradeBook`,
`parseCatalog`, `parseRoster`); only the merge step differs.

### Confirmation patterns

- **Destructive actions** (`Clear all`, `Delete selected`, per-row
  `Delete`) use `window.confirm` — same pattern as the existing
  header `Delete` and the `TermManagerModal` delete.
- **Append-import** is non-destructive and surfaces a count message
  ("Appended N, skipped M") via the existing `lastError` channel so
  the on-screen `ErrorBanner` displays it.

---

## 14. Excel export shapes

### `Export data` → `Export plans` button (`exportPlansFile`)

Produces a single workbook `plans-YYYY-MM-DD.xlsx` containing:

| Sheet | Contents |
|---|---|
| One sheet per non-empty Term | rows of `(student_id, student_name, email, national_id, major, level, term, course_code, course_title, credits, new_ch, enhancing_ch, repeated_ch, status)` |
| `Failed Courses` (trailing) | One row per `(student, course)` failed attempt anywhere in the grade-book. Columns: same identity set + `term`, `grade`, `status='failed'`. |

Sheets named after terms, with illegal Windows chars stripped and
truncated to 31 chars.

### `Export` button (`exportDataFile`)

Triggers a download of the **entire** `DataState` as
`academic-advisor-data-YYYY-MM-DD.json` (envelope: `{ version, state }`).
Re-importable via the **Import** button in the header.

---

## 15. Reading-order checklist for new contributors

If you're new to the codebase, read the files in this order:

1. `src/main.tsx` — entry.
2. `src/App.tsx` — provider topology + view switch.
3. `src/data/types.ts` — the type vocabulary.
4. `src/data/DataContext.tsx` — the state mutator zoo.
5. `src/data/storage.ts` — localStorage + migration.
6. `src/data/parseGradeBook.ts` then `src/data/parseCatalog.ts` —
   what the import buttons ultimately call.
7. `src/data/normalize.ts` — the one true "MEC011 vs MEC 11" path.
8. `src/data/metrics.ts` — the Python-mirror math.
9. `src/data/advising.ts` — every answer the panel can give.
10. `src/data/majorIndex.ts` + `src/data/prereqMap.ts` — what makes
    the prereq-map work.
11. `src/components/Shell.tsx` — the chrome.
12. `src/components/ImportButtons.tsx` + `src/components/EmptyState.tsx` —
    the user-facing top of the funnel.
13. `src/components/RosterTable.tsx` + `src/components/AdvisingPanel.tsx`
    — the two halves of the roster view.
14. `src/components/PrereqMapScreen.tsx` — the main event (~1,400
    lines; skim the section headers, deep-read the bits you need).
15. `src/components/PrereqMapPrint.tsx` + `src/components/Shared/`
    modules — see how the same logic is rendered two different ways.

If you're uncertain about a specific feature, the **test files**
(every `*.test.ts` next to `data/*.ts`) are your friend — they pin
the contract without React noise.

---

## 16. Common patterns & idioms

These show up in many files; learning them once means the rest
of the codebase reads easily.

### 16.1 Course-code normalisation — never raw compare

Course codes from the catalog ("MEC011") and the gradebook ("MEC 11"
/ "MEC-011" / "mec011") all look different but mean the same course.
**Always** pass strings through `normalizeCourseCodeLoose()` from
`src/data/normalize.ts` before comparison, lookup, or join.

### 16.2 Major resolution — don't do it by hand

Use `resolveMajorIndex(studentMajor, catalogMajors)` from
`src/data/majorIndex.ts`. Three-pass resolution handles every common
typo (`Mech` vs `Mechatronics` vs `Mechatronics Engineering`).

### 16.3 Status palette — only via tokens

```ts
import { SCREEN_COLOR_CLASS, gpaToken } from '../components/shared/colorTokens';
import { gradeTextToken } from '../components/shared/formatGrade';

<span className={SCREEN_COLOR_CLASS[gpaToken(gpa)]}>{gpa.toFixed(2)}</span>
```

For a print tree:

```ts
import { PRINT_COLOR_DARK } from '../components/shared/colorTokens';
<span style={{ color: PRINT_COLOR_DARK[gpaToken(gpa)] }}>{gpa.toFixed(2)}</span>
```

### 16.4 Memoised computations — `useMemo` on stable keys

The big screens memo `metricsByStudent` and `mapData` directly on
their deps. When adding a new field to those computations, add the
new dep at the same time.

### 16.5 Custom hooks for popovers

Both comboboxes share the same close-on-outside-click and
autofocus-on-open behaviour via:

```ts
const containerRef = useClickOutside<HTMLDivElement>(open, () => setOpen(false));
const inputRef = useAutoFocusOnOpen<HTMLInputElement>(open);
```

### 16.6 Modal: render-mounted, ESC-closable, X-closable

All centered dialogs use `<Modal open={…} onClose={…}>`. Mounting
adds the backdrop and ESC handler automatically.

### 16.7 Print fires via PrintContext

Whenever you need to "open the print dialog with a specific tree
mounted", call `triggerPrint(setActiveTree, kind, payload)` — never
set state manually. The trigger handles the RAF wait, the title
swap, and the cleanup.

### 16.8 One print tree at a time

`Shell.tsx` renders exactly one of `PrereqMapPrint` /
`FailureReportPrint` / `RegistrationFormPrint` at a time, keyed by
`payload.version`. Don't add a new print tree without updating all
three: `PrintTreeKind`, the conditional in `Shell`, and (if it
needs payload fields) the `PrintPayload` interface.

### 16.9 Term-relative operations

A student's planned courses live on **a specific term**. Most
plan-mutating helpers take a `termId` + `studentId` + `courseCode`
explicitly. The single-active-term shortcut is
`toggleCourseInActiveTerm(termId, studentId, code)` from
`DataContext`.

### 16.10 Imports: paths, not aliases

The `@/*` alias exists in `vite.config.ts` but **the codebase uses
relative imports** consistently (`./shared/Modal`, `../data/...`).
Match that convention.

---

## 17. How to make changes safely

### Touching a metric or advising rule

1. Edit the pure function in `src/data/<file>.ts`.
2. Add or update a test in `src/data/<file>.test.ts` next to it.
3. Run `npm test` — vitest runs every `*.test.ts` in `src/data/` and
   `src/components/`.
4. Run `npm run lint` — strict type-check.
5. `npm run build` — make sure the bundle still compiles.

### Touching the screen

`src/components/*.tsx`. Tailwind v4 utility classes are accepted
everywhere EXCEPT inside print trees. If you change a screen
status colour, update `shared/colorTokens.ts` instead of inlining.

### Touching a print tree

`src/components/<Tree>Print.tsx` + `print.css` at the repo root.
Tailwind classes do **not** work inside print CSS — they'll silently
ship without a Tailwind output. Use either inline `style={{}}` or
`pmaps-*` / `preport-*` / `regform-*` classes.

### Adding a print tree

1. Add the kind to `PrintTreeKind` in `PrintContext.tsx`.
2. If it needs new payload fields, extend `PrintPayload`.
3. Add the component to `components/<Tree>Print.tsx`.
4. Mount it from `Shell.tsx` behind a new branch of the
   `activeTree === …` switch.
5. Wire a button to call `triggerPrint(setActiveTree, newKind, payload)`.

### Adding a new advising query

1. Add the case to `AdvisingQuery` in `src/data/types.ts`.
2. Add the pure function in `src/data/advising.ts` and wire it into
   the `query()` dispatcher in `DataContext.tsx`.
3. Add the tab UI in `AdvisingPanel.tsx`.
4. Add tests in `src/data/advising.test.ts`.

### Adding a new shared colour

Avoid this — extend the `ColorToken` union instead:

1. Add `'mycolor'` to `ColorToken` in `colorTokens.ts`.
2. Add the Tailwind class to `SCREEN_COLOR_CLASS`.
3. Add the two hexes to `PRINT_COLOR_DARK` / `PRINT_COLOR_LIGHT`.
4. Search the codebase — anything that needs it is one token away.

---

## 18. Where things can go wrong (gotchas)

### 18.1 Course codes silently misjoin

The gradebook uses "MEC 11", the catalog uses "MEC011". The app
normalises both to `MEC011`. **If you bypass `normalizeCourseCodeLoose`
even once in a comparison, the join silently misses and the user sees
zero results.** Always pipe strings through it.

### 18.2 The print tree shows everything if you toggle <html> classes

We *used* to toggle a class on `<html>` around `window.print()`. That
races with the print dialog in Firefox (`afterprint` fires before the
dialog closes) and Chrome on Linux (no `afterprint` event). The
current design mounts only one print tree at a time. Don't go back
to a class-toggle.

### 18.3 Empty state without a catalog = empty map

When the user clicks "Generate demo rows", the dev path must populate
**both** `rows` AND `catalog` (`loadDemoRows` + `loadDemoCatalog`).
The prereq map reads from `catalog` and silently renders empty if
the catalog is null. (This bug existed at one point — the demo button
now seeds both.)

### 18.4 Active term gone after delete

`deleteTerm(id)` re-picks the most recently created remaining term,
or sets `activeTermId` to `null` if none remain. UI components
that read `activeTerm` should always treat it as `Term | undefined`.

### 18.5 Term picker disabled when no terms

The header's term-`<select>` is disabled when `state.terms.length
=== 0`. Tests should seed a Term first.

### 18.6 `cross-listed` narrow vs wide rows

A row with `majors: ["Mechatronics Engineering"], semesters: [7]`
is the narrow shape; it sits in semester 7 for Mechatronics students
and is *off-plan* for every other major. The resolver handles this
via name-based lookup (`semesterForMajor`). Don't break it by
falling back to direct indexing by the catalog-major index.

### 18.7 Strict mode double-mount

React 19 StrictMode (enabled in `main.tsx`) double-invokes effects in
dev. Don't write to `window.localStorage` directly from a component
body — rely on the `useEffect(() => saveData(state), [state])` in
`DataContext`.

### 18.8 `terms` is empty after `loadDemoRows` only

A second "empty after load" trap: importing gradebook rows via
`loadDemoRows` does NOT create a default Term — only the very first
app boot does that (in `DataProvider`'s `useState` initializer).
Clicking "Generate demo rows" then opening the prereq map works
because the *initial* mount still created a term on first-ever launch.
For future code paths that seed state without unmounting, manually
push a term into `state.terms` first.

### 18.9 Print filenames on Windows

The "Save as PDF" dialog uses `document.title`. Windows silently
rejects filenames containing `< > : " / \ | ? *`; the dialog just
disappears with no error. Use `sanitiseFilename()` from
`PrintContext.tsx` when picking a title (the helper is already
called inside `triggerPrint`).

### 18.10 PrereqMap status `'in-program'` is computed but never rendered

The classification exists in `prereqMap.ts` because the early spec
called for showing "not on your plan" chips. Today, off-plan courses
are simply filtered out of `semesters[number].courses` because they
don't have a semester number for this major. If you add a future
"see my other-major courses" toggle, the status slot is ready.

---

## 19. Glossary

| Term | Meaning |
|---|---|
| **Active term** | The `Term` whose `id === state.activeTermId`. The prereq map reads/writes against it; the picker in the header switches it. |
| **Classification** | For a course on the active plan: `new` (never attempted), `enhancing` (already passed), `repeated` (already failed and being retried). |
| **Credits / units / hours** | All synonyms for the same thing — the integer credit weight of a course. Search the code for any of them. |
| **Gradebook row** | One `GradeRow` — a (student × course × term × grade) tuple from the Excel. |
| **In-program** | A catalog row whose `semesters[majorIdx] >= 1` for the active student's major. Off-program rows are filtered out of the map. |
| **Major plan** | The per-major `semesters[]` column on every catalog row. Resolution uses `semesterForMajor`. |
| **MAP** | Prerequisite MAP — the on-screen grid view. |
| **Normalised code** | The result of `normalizeCourseCodeLoose()` — uppercase, no separators, digit tail padded to 3. |
| **Plan** | The set of `courseCodes` on a `Term` for a single student. |
| **Prereq** | A course listed in another course's `prerequisites[]`. |
| **Planned conflict** | A student has put a course on a term that they've previously failed. Surface in the Conflict tab. |
| **Roster** | Optional Excel of `(studentId, studentName, major)`. The grade-book is the source of truth for grades; the roster is the source of truth for friendly names + majors. |
| **Term** | A named registration period (e.g. "Summer 2025"). One term holds many students; each student has at most one entry per term. |
| **Wide vs narrow catalog row** | Wide: `majors[]` and `semesters[]` list every catalog major. Narrow: both list only the majors this row belongs to. Resolved inside `semesterForMajor`. |
| **`STORAGE_VERSION`** | Bumped 1 → 2 → 3 over time. `loadData` migrates older shapes silently. |

---

## AI-context cheat sheet

For any future AI session working on this codebase:

* **Stack:** React 19 + TS 5.8 + Vite 6 + Tailwind 4 + xlsx +
  lucide-react. Single-Context state, localStorage-backed.
* **The single source of truth for state is `src/data/DataContext.tsx`.**
  Every component reads via `useData()` and never receives props from
  its peers.
* **Print trees are deliberately NOT React-routed.** They mount into
  a slot inside `Shell.tsx`, controlled by `PrintContext`. Always go
  through `triggerPrint()` — do not call `setActiveTree` directly or
  you'll lose the title-swap + RAF + cleanup behaviour.
* **All colours live in `src/components/shared/colorTokens.ts`.** Three
  maps keyed by the same `ColorToken` union. Never inline a hex or a
  Tailwind colour class.
* **Course codes never compare raw.** Always `normalizeCourseCodeLoose()`.
* **Pure modules are under `src/data/`.** Test them with vitest.
  Don't push React or DOM references into them.
* **Tests live next to their module** (`metrics.test.ts` next to
  `metrics.ts`). Run with `npm test`.
* **The "Generate demo rows" button seeds BOTH rows and the catalog**
  — if you rework the empty-state, preserve both calls or the prereq
  map will be empty.
* **The user-explicit goals** (in order of importance to the user):
  1. The prereq map must render as soon as data exists.
  2. Print must produce a paper artefact that mirrors the screen.
  3. The Excel import must accept the user's exact column names.

If you only have time to read one file, read `src/data/types.ts`.
If you only have time to read two, also read `src/data/DataContext.tsx`.
