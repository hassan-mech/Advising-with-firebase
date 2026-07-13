/**
 * Shared helpers for the failure-stats leaderboard rows (on-screen
 * in AdvisingPanel and the print tree in FailureReportPrint).
 *
 * The screen + print trees use different CSS so we don't share a
 * `<LeaderboardRow>` component — but the data prep (looking up a
 * student name from a roster by id) is identical and was previously
 * hand-rolled in two places.
 */

import type { RosterEntry } from '../../data/types';

/** Look up a display name for every student id, falling back to
 *  `"Student <id>"` when the roster has no entry (or no name) for
 *  that id. Returned array is the same length and same order as
 *  the input. */
export function resolveStudentNames(
  ids: string[],
  roster: RosterEntry[]
): string[] {
  return ids.map(
    (id) =>
      roster.find((r) => r.studentId === id)?.studentName?.trim() ||
      `Student ${id}`
  );
}
