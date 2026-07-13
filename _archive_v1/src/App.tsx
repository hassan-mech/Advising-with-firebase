/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { AlertTriangle } from 'lucide-react';
import { COURSES as INITIAL_COURSES, getFullCohortStudents } from './data';
import { Course, ScreenType, PlannerTerm, Student, MajorPlan } from './types';
import SetupScreen from './components/SetupScreen';
import CatalogScreen from './components/CatalogScreen';
import ExplorerScreen from './components/ExplorerScreen';
import PlannerScreen from './components/PlannerScreen';
import CohortScreen from './components/CohortScreen';
import {
  buildStudentFromExcelRows,
  ExcelGradeRow,
  studentMetricsFromExcel,
} from './utils/studentMetrics';

export default function App() {
  // Set default initial screen to 'group' (Cohort Overview) for an administrative feel
  const [currentScreen, setCurrentScreen] = useState<ScreenType>('group');
  
  // Manage full list of students as the Single Source of Truth - start empty as requested
  const [students, setStudents] = useState<Student[]>([]);
  
  // Manage courses to allow editing/import/export
  const [allCourses, setAllCourses] = useState<Course[]>(INITIAL_COURSES);

  // Manage major plans for visual maps
  const [majorPlans, setMajorPlans] = useState<MajorPlan[]>([]);

  
  // Track active student being managed/edited - start empty as requested
  const [activeStudentId, setActiveStudentId] = useState<string>('');

  // Retrieve current active student's data block
  const activeStudent = students.find((s) => s.id === activeStudentId) || students[0];

  // Auto-select first student when empty list becomes populated or active student becomes invalid
  React.useEffect(() => {
    if (students.length > 0) {
      if (!activeStudentId || !students.some(s => s.id === activeStudentId)) {
        setActiveStudentId(students[0].id);
      }
    } else {
      setActiveStudentId('');
    }
  }, [students, activeStudentId]);

  // Derived states from the active student
  const completedCourses = activeStudent?.completedCourses || [];
  const unsortedPlannedTerms = activeStudent?.plannedTerms || [];

  const plannedTerms = [...unsortedPlannedTerms].sort((a, b) => {
    const termOrder: Record<string, number> = { 'Summer': 0, 'Fall': 1, 'Spring': 2 };
    const [aTerm, aYearS] = a.name.split(' ');
    const [bTerm, bYearS] = b.name.split(' ');
    const aYear = parseInt(aYearS || '0');
    const bYear = parseInt(bYearS || '0');

    if (aYear !== bYear) return aYear - bYear;
    return (termOrder[aTerm] ?? 3) - (termOrder[bTerm] ?? 3);
  });
  const plannedCourses = plannedTerms.flatMap((term) => term.courses);

  // Writer functions to update the Single Source of Truth
  const setCompletedCourses = (codes: string[]) => {
    setStudents((prev) => {
      const targetId = activeStudentId || (prev[0]?.id || '');
      return prev.map((s) => {
        if (s.id === targetId) {
          return {
            ...s,
            completedCourses: codes,
            creditsEarned: codes.length * 3, // assume standard 3cr average
            status: s.status === 'DRAFT' ? 'DRAFT' : 'IN-PROGRESS'
          };
        }
        return s;
      });
    });
  };

  const setPlannedTerms = (
    value: PlannerTerm[] | ((prev: PlannerTerm[]) => PlannerTerm[])
  ) => {
    setStudents((prev) => {
      const targetId = activeStudentId || (prev[0]?.id || '');
      return prev.map((s) => {
        if (s.id === targetId) {
          const nextTerms = typeof value === 'function' ? value(s.plannedTerms) : value;
          return {
            ...s,
            plannedTerms: nextTerms,
            status: s.status === 'FINALIZED' ? 'FINALIZED' : 'IN-PROGRESS'
          };
        }
        return s;
      });
    });
  };

  // Shared selected course state for Detail Panel
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [isDetailOpen, setDetailOpen] = useState(false);

  const handleNavigate = (screen: ScreenType) => {
    setCurrentScreen(screen);
    // Auto-close details panel on navigation to avoid clutter
    setDetailOpen(false);
  };

  const handleSelectCourse = (course: Course) => {
    setSelectedCourse(course);
  };

  const handleAddToPlanner = (code: string, termId?: string) => {
    const targetStudent = students.find((s) => s.id === activeStudentId) || students[0];
    const targetId = targetStudent?.id || '';

    // Default to the active student's first planned term — for Excel-imported
    // students this is "Summer 2025" (so the new card picks up the yellow
    // styling immediately), and for mock students it is "Summer 2026".
    // Falls back to 'fall-2026' only if the student has no planned terms yet.
    const targetTermId =
      termId && termId.length > 0
        ? termId
        : targetStudent?.plannedTerms?.[0]?.id || 'fall-2026';

    setStudents((prev) =>
      prev.map((s) => {
        if (s.id === targetId) {
          const updatedTerms = s.plannedTerms.map((term) => {
            if (term.id === targetTermId) {
              if (term.courses.includes(code)) return term;
              return { ...term, courses: [...term.courses, code] };
            }
            return term;
          });
          return {
            ...s,
            plannedTerms: updatedTerms,
            status: s.status === 'FINALIZED' ? 'FINALIZED' : 'IN-PROGRESS'
          };
        }
        return s;
      })
    );

    const targetTermName = targetStudent?.plannedTerms.find(t => t.id === targetTermId)?.name || 'Planned Term';
    alert(`${code} successfully added to ${targetTermName} Plan for ${targetStudent?.name || 'Student'}!`);
    setDetailOpen(false);
  };

  const handleSavePlan = () => {
    const exportData = [];
    students.forEach(student => {
      student.plannedTerms.forEach(term => {
        term.courses.forEach(courseCode => {
          exportData.push({
            Student_ID: student.id,
            Student_Name: student.name,
            Major: student.major,
            Term_ID: term.id,
            Term_Name: term.name,
            Course_Code: courseCode,
          });
        });
      });
    });

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Term Plans');
    XLSX.writeFile(workbook, 'Student_Term_Plans.xlsx');
  };

  const handleImportPlan = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result;
      if (!result) return;
      const workbook = XLSX.read(result, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet);

      // Detect whether the file is the raw grade-book shape (mirrors the
      // Python dataframe with student_id / course / units / grade / term /
      // cumulative_gpa) or the existing term-plan shape
      // (Student_ID / Term_ID / Term_Name / Course_Code).
      const isGradeBook = jsonData.length > 0 && jsonData.some((row) => {
        const keys = Object.keys(row).map((k) => k.toLowerCase());
        return keys.some((k) => k === 'student_id' || k === 'id')
          && keys.some((k) => k === 'course')
          && keys.some((k) => k === 'grade');
      });

      if (isGradeBook) {
        // ---- Grade-book shape ----
        type RawExcelRow = ExcelGradeRow & {
          Student_Name?: string;
          Major?: string;
        };

        const excelRows: RawExcelRow[] = jsonData.map((row) => {
          const get = (...names: string[]): string => {
            for (const key of Object.keys(row)) {
              if (names.includes(key.toLowerCase())) {
                const v = row[key];
                if (v === null || v === undefined) return '';
                return String(v);
              }
            }
            return '';
          };
          const unitsKey = get('units', 'credit_hours', 'credits');
          const gpaKey = get('cumulative_gpa', 'cum_gpa', 'gpa');
          return {
            student_id: get('student_id', 'studentid', 'id'),
            course: get('course', 'course_code', 'coursecode'),
            units: unitsKey ? (row[unitsKey] as unknown as number | string) : '',
            grade: get('grade', 'final_grade'),
            term: get('term', 'semester'),
            cumulative_gpa: gpaKey ? (row[gpaKey] as unknown as number | string) : '',
            Student_Name: get('student_name', 'name'),
            Major: get('major', 'department'),
          };
        }).filter((r) => r.student_id && r.course);

        // Group rows by student_id and merge into the existing cohort list.
        const rowsByStudent: Record<string, RawExcelRow[]> = {};
        for (const r of excelRows) {
          if (!rowsByStudent[r.student_id]) rowsByStudent[r.student_id] = [];
          rowsByStudent[r.student_id].push(r);
        }

        setStudents((prevStudents) => {
          const merged: Student[] = [...prevStudents];
          for (const [sid, sRows] of Object.entries(rowsByStudent)) {
            const existing = merged.find((s) => s.id === sid);
            const nameFromRow = sRows.find((r) => r.Student_Name)?.Student_Name;
            const majorFromRow = sRows.find((r) => r.Major)?.Major;

            const partial: Partial<Student> = {
              ...(existing ?? {}),
              ...(nameFromRow ? { name: String(nameFromRow) } : {}),
              ...(majorFromRow ? { major: String(majorFromRow) } : {}),
            };

            const built = buildStudentFromExcelRows(sRows, sid, partial);

            // Always guarantee the Summer 2025 / Summer 2026 terms exist for
            // Excel-imported students, even on re-import / merge. Any terms
            // the user already authored are kept; missing summer terms are
            // appended (so courses already placed in non-summer terms stay
            // where they were). This makes the pink/yellow styling show up
            // the moment the import finishes.
            const existingTerms = existing?.plannedTerms ?? [];
            const ensuredTerms = [...existingTerms];
            for (const seed of built.plannedTerms) {
              const hasMatch = ensuredTerms.some(
                (t) => t.id === seed.id || t.name.toLowerCase() === seed.name.toLowerCase()
              );
              if (!hasMatch) {
                ensuredTerms.push({ ...seed, courses: [...seed.courses] });
              }
            }
            built.plannedTerms = ensuredTerms;

            // Log the same numbers the Python pipeline would have printed.
            const m = studentMetricsFromExcel(sRows, sid);
            // eslint-disable-next-line no-console
            console.info(
              `Imported ${sid} → GPA=${m.gpa.toFixed(2)}, units=${m.totalUnits}, failed=[${m.failedCourses.join(', ')}]`
            );

            if (existing) {
              const idx = merged.findIndex((s) => s.id === sid);
              merged[idx] = { ...existing, ...built };
            } else {
              merged.push(built);
            }
          }
          return merged;
        });

        alert(
          `Imported ${Object.keys(rowsByStudent).length} student(s) from grade-book. Open Prerequisite Map to view personalized maps.`
        );
        return;
      }

      // ---- Term-plan shape (existing behaviour, kept for back-compat) ----
      setStudents(prevStudents => {
        const newStudents = [...prevStudents];
        const studentPlans: Record<string, PlannerTerm[]> = {};

        jsonData.forEach((row: any) => {
          const sId = String(row.Student_ID || row.student_id || row.ID);
          const tId = String(row.Term_ID || row.term_id || row.Term_Name);
          const tName = String(row.Term_Name || row.term_name || tId);
          const cCode = String(row.Course_Code || row.course_code || row.Course);

          if (!sId || !cCode) return;

          if (!studentPlans[sId]) {
            studentPlans[sId] = [];
          }

          let term = studentPlans[sId].find(t => t.id === tId || t.name === tName);
          if (!term) {
            term = { id: tId, name: tName, courses: [] };
            studentPlans[sId].push(term);
          }
          if (!term.courses.includes(cCode)) {
            term.courses.push(cCode);
          }
        });

        return newStudents.map(student => {
          if (studentPlans[student.id]) {
            return {
              ...student,
              plannedTerms: studentPlans[student.id],
              status: 'IN-PROGRESS'
            };
          }
          return student;
        });
      });
      alert('Plan imported successfully!');
    };
    reader.readAsArrayBuffer(file);
  };

  // Bulk Add Course: deploy courseCode to all students enrolled in specified major
  const handleBulkAddCourse = (major: string, courseCode: string) => {
    setStudents((prev) =>
      prev.map((student) => {
        if (student.major === major) {
          // Schedule in the first term ('fall-2026')
          const updatedTerms = student.plannedTerms.map((term) => {
            if (term.id === 'fall-2026') {
              if (term.courses.includes(courseCode)) return term;
              return { ...term, courses: [...term.courses, courseCode] };
            }
            return term;
          });
          return {
            ...student,
            plannedTerms: updatedTerms,
            status: student.status === 'FINALIZED' ? 'FINALIZED' : 'IN-PROGRESS'
          };
        }
        return student;
      })
    );
  };

  const handleResetStudents = () => {
    setStudents(getFullCohortStudents());
    setActiveStudentId('2024-8842');
  };

  // Render correct view based on state route
  return (
    <div className="w-full min-h-screen bg-slate-950 flex flex-col">
      {students.length === 0 && currentScreen !== 'group' && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-6 py-2.5 flex items-center justify-between gap-4 text-xs text-amber-300 z-50">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span><strong>Visitor Mode:</strong> No student records exist yet. To construct or simulate academic plans, please register or import students in the Cohort Overview.</span>
          </div>
          <button 
            onClick={() => setCurrentScreen('group')}
            className="bg-amber-500/20 hover:bg-amber-500 hover:text-slate-950 px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer"
          >
            Go to Cohort Overview
          </button>
        </div>
      )}
      
      {currentScreen === 'group' && (
        <CohortScreen
          students={students}
          setStudents={setStudents}
          allCourses={allCourses}
          setAllCourses={setAllCourses}
          majorPlans={majorPlans}
          setMajorPlans={setMajorPlans}
          activeStudentId={activeStudentId}
          setActiveStudentId={setActiveStudentId}
          onNavigate={handleNavigate}
          onBulkAddCourse={handleBulkAddCourse}
          onResetStudents={handleResetStudents}
        />
      )}

      {currentScreen === 'setup' && (
        <SetupScreen
          allCourses={allCourses}
          completedCourses={completedCourses}
          setCompletedCourses={setCompletedCourses}
          onNavigate={handleNavigate}
        />
      )}

      {currentScreen === 'catalog' && (
        <CatalogScreen
          allCourses={allCourses}
          setAllCourses={setAllCourses}
          completedCourses={completedCourses}
          plannedCourses={plannedCourses}
          onNavigate={handleNavigate}
          onSelectCourse={handleSelectCourse}
          selectedCourse={selectedCourse}
          isDetailOpen={isDetailOpen}
          setDetailOpen={setDetailOpen}
          onAddToPlanner={handleAddToPlanner}
          onSavePlan={handleSavePlan}
          onImportPlan={handleImportPlan}
          students={students}
          activeStudentId={activeStudentId}
          setActiveStudentId={setActiveStudentId}
          majorPlans={majorPlans}
        />
      )}

      {currentScreen === 'explorer' && (
        <ExplorerScreen
          allCourses={allCourses}
          majorPlans={majorPlans}
          students={students}
          activeStudentId={activeStudentId}
          setActiveStudentId={setActiveStudentId}
          onNavigate={handleNavigate}
          onSelectCourse={handleSelectCourse}
          selectedCourse={selectedCourse}
          isDetailOpen={isDetailOpen}
          setDetailOpen={setDetailOpen}
          onAddToPlanner={handleAddToPlanner}
          onSavePlan={handleSavePlan}
        />
      )}

      {currentScreen === 'planner' && (
        <PlannerScreen
          allCourses={allCourses}
          completedCourses={completedCourses}
          plannedTerms={plannedTerms}
          setPlannedTerms={setPlannedTerms}
          onNavigate={handleNavigate}
          onSelectCourse={handleSelectCourse}
          selectedCourse={selectedCourse}
          isDetailOpen={isDetailOpen}
          setDetailOpen={setDetailOpen}
          onSavePlan={handleSavePlan}
          students={students}
          activeStudentId={activeStudentId}
          setActiveStudentId={setActiveStudentId}
          majorPlans={majorPlans}
        />
      )}
    </div>
  );
}
