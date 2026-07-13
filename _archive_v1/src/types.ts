/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface MajorSemester {
  id: string;
  name: string;
  level: number;
  courses: string[];
}

export interface MajorPlan {
  major: string;
  semesters: MajorSemester[];
}

export interface Course {
  code: string;
  title: string;
  credits: number;
  department: string;
  prerequisites: string[];
  description: string;
  level: string;
  category: string;
}

export type ScreenType = 'setup' | 'catalog' | 'explorer' | 'planner' | 'group';

export interface PlannerTerm {
  id: string;
  name: string;
  courses: string[]; // array of course codes
}

export interface PlannerState {
  completedCourses: string[]; // array of course codes completed in Setup
  plannedTerms: PlannerTerm[]; // semesters in Term Plan Builder
}

export interface CourseHistoryItem {
  courseCode: string;
  term: string;
  grade: string;
  credits: number;
  points?: number;
}

export interface Student {
  id: string;
  name: string;
  avatar: string;
  major: string;
  year: number; // 1, 2, 3, 4 (Freshman, Sophomore, Junior, Senior)
  creditsEarned: number;
  totalCreditsRequired: number;
  status: 'FINALIZED' | 'IN-PROGRESS' | 'MISSING REQS' | 'DRAFT';
  completedCourses: string[];
  plannedTerms: PlannerTerm[];
  gpa?: number;
  courseHistory?: CourseHistoryItem[];
}

