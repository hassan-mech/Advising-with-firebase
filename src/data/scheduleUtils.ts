// scheduleUtils.ts
import type { ClassSession } from './types';
import { doTimeSlotsOverlap } from './types';
import { normalizeCourseCodeLoose } from './normalize';

/**
 * Return all self‑consistent session combinations for a course.
 * When a studentGroup is given, combos fully in that group are listed first.
 */
export function getAllCombinationsForCourse(
  sessions: ClassSession[],
  studentGroup?: string
): ClassSession[][] {
  const byType = new Map<string, ClassSession[]>();
  for (const s of sessions) {
    const t = s.sessionType;
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t)!.push(s);
  }

  const typeGroups = Array.from(byType.values());
  if (typeGroups.length === 0) return [];

  const cartesian = (arrays: ClassSession[][]): ClassSession[][] => {
    if (arrays.length === 0) return [[]];
    const [first, ...rest] = arrays;
    const restProduct = cartesian(rest);
    return first.flatMap(s => restProduct.map(comb => [s, ...comb]));
  };

  const allCombos = cartesian(typeGroups);

  // filter internal overlaps
  const selfConsistent = allCombos.filter(comb => {
    for (let i = 0; i < comb.length; i++) {
      for (let j = i + 1; j < comb.length; j++) {
        if (doTimeSlotsOverlap(comb[i].time, comb[j].time)) return false;
      }
    }
    return true;
  });

  if (!studentGroup) return selfConsistent;

  const groupFirst = selfConsistent.filter(comb =>
    comb.every(s => s.targetGroups.includes(studentGroup))
  );
  const rest = selfConsistent.filter(comb =>
    !comb.every(s => s.targetGroups.includes(studentGroup))
  );
  return [...groupFirst, ...rest];
}

/** Backtracking search: can all courses be scheduled without overlap? */
export function canScheduleAll(
  courses: { code: string; combos: ClassSession[][] }[],
  assigned: ClassSession[] = [],
  index = 0
): boolean {
  if (index === courses.length) return true;
  const { combos } = courses[index];
  for (const combo of combos) {
    if (!combo.some(s => assigned.some(a => doTimeSlotsOverlap(s.time, a.time)))) {
      if (canScheduleAll(courses, [...assigned, ...combo], index + 1)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Return the first valid assignment (one combo per course) for a set of courses,
 * or null if impossible. The result is an array of ClassSession[] parallel to the input.
 */
export function findValidAssignment(
  courses: { code: string; combos: ClassSession[][] }[]
): ClassSession[][] | null {
  const result: ClassSession[][] = [];

  function backtrack(assigned: ClassSession[], idx: number): boolean {
    if (idx === courses.length) return true;
    for (const combo of courses[idx].combos) {
      if (!combo.some(s => assigned.some(a => doTimeSlotsOverlap(s.time, a.time)))) {
        result.push(combo);
        if (backtrack([...assigned, ...combo], idx + 1)) return true;
        result.pop();
      }
    }
    return false;
  }

  return backtrack([], 0) ? result : null;
}