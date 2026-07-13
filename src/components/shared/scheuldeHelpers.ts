
import type { ClassSession } from '../../data/types';
import { doTimeSlotsOverlap } from '../../data/types';

export function findValidCombination(
  courseSessions: ClassSession[],
  plannedSessions: ClassSession[],
  studentGroup: string
): ClassSession[] | null {
  // 1. Group sessions by type (LEC, LAB, TUT)
  const byType = new Map<string, ClassSession[]>();
  for (const s of courseSessions) {
    const t = s.sessionType;
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t)!.push(s);
  }

  const typeGroups = Array.from(byType.values());
  if (typeGroups.length === 0) return null;

  // 2. Cartesian product over all types
  const cartesian = (arrays: ClassSession[][]): ClassSession[][] => {
    if (arrays.length === 0) return [[]];
    const [first, ...rest] = arrays;
    const restProduct = cartesian(rest);
    return first.flatMap(s => restProduct.map(comb => [s, ...comb]));
  };

  const allCombos = cartesian(typeGroups);

  // 3. Overlap helper
  const hasOverlap = (comb: ClassSession[]) =>
    comb.some(s => plannedSessions.some(p => doTimeSlotsOverlap(s.time, p.time)));

  // 4. Priority 1: combinations where EVERY session targets the student's group
  const groupCombos = allCombos.filter(comb =>
    comb.every(s => s.targetGroups.includes(studentGroup))
  );
  for (const comb of groupCombos) {
    if (!hasOverlap(comb)) return comb;
  }

  // 5. Priority 2: any combination (fallback to other groups)
  for (const comb of allCombos) {
    if (!hasOverlap(comb)) return comb;
  }

  return null; // no valid combination
}



export function getAllCombinationsForCourse(
  sessions: ClassSession[],
  studentGroup: string
): ClassSession[][] {
  // Group sessions by type (LEC / LAB / TUT)
  const byType = new Map<string, ClassSession[]>();
  for (const s of sessions) {
    const t = s.sessionType;
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t)!.push(s);
  }

  const typeGroups = Array.from(byType.values());
  if (typeGroups.length === 0) return [];

  // Cartesian product helper
  const cartesian = (arrays: ClassSession[][]): ClassSession[][] => {
    if (arrays.length === 0) return [[]];
    const [first, ...rest] = arrays;
    const restProduct = cartesian(rest);
    return first.flatMap(s => restProduct.map(comb => [s, ...comb]));
  };

  const allCombos = cartesian(typeGroups);

  // Filter out combos that have internal overlaps (same course shouldn't clash with itself)
  const selfConsistent = allCombos.filter(comb => {
    for (let i = 0; i < comb.length; i++) {
      for (let j = i + 1; j < comb.length; j++) {
        if (doTimeSlotsOverlap(comb[i].time, comb[j].time)) return false;
      }
    }
    return true;
  });

  // Sort: combos where ALL sessions target the student group come first
  const groupFirst = selfConsistent.filter(comb =>
    comb.every(s => s.targetGroups.includes(studentGroup))
  );
  const rest = selfConsistent.filter(comb =>
    !comb.every(s => s.targetGroups.includes(studentGroup))
  );
  return [...groupFirst, ...rest];
}



/**
 * Check whether all courses can be scheduled without time conflicts.
 *
 * Strategy (matches user requirement):
 *   Pass 1 — try to build a conflict-free timetable using ONLY combos
 *             where every session targets the student's own group.
 *   Pass 2 — if pass 1 fails (or group has no combos), allow any combo
 *             as a fallback so the course can still be added.
 *
 * `combos` inside each course entry should already be sorted
 * group-first by `getAllCombinationsForCourse`.
 */
export function canScheduleAll(
  courses: { code: string; combos: ClassSession[][] }[],
  studentGroup: string,
  assigned: ClassSession[] = [],
  index: number = 0,
  groupOnly: boolean = true
): boolean {
  if (index === courses.length) return true; // all courses assigned

  const { combos } = courses[index];

  // In groupOnly pass, skip combos that don't fully belong to the group.
  const toTry = combos; // combos are already sorted: group-specific first

  for (let ci = 0; ci < toTry.length; ci++) {
    const combo = toTry[ci];

    // In groupOnly pass, stop as soon as we reach a non-group combo.
    // A combo is "group-specific" if every session has targetGroups set.
    // We rely on the invariant from getAllCombinationsForCourse:
    // group combos come before other combos.
    // We break here if we encounter a non-group combo while in groupOnly mode.
    if (groupOnly && !combo.every(s => s.targetGroups.includes(studentGroup))) {
      break;
    }

    // Check if this combo overlaps with any already assigned session
    const overlap = combo.some(s =>
      assigned.some(a => doTimeSlotsOverlap(s.time, a.time))
    );
    if (!overlap) {
      if (canScheduleAll(courses, studentGroup, [...assigned, ...combo], index + 1, groupOnly)) {
        return true;
      }
    }
  }

  // If we're in group-only pass, try ALL combos for this course
  // (including the first one already tried above) in the full pass.
  if (groupOnly) {
    return canScheduleAll(courses, studentGroup, assigned, index, false);
  }

  return false;
}