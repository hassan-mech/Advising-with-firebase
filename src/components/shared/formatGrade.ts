/**
 * Grade-format helpers used on both the on-screen prereq-map card
 * and the printed prereq-map page. Kept tiny so the call sites stay
 * readable.
 */

import { letterToPoints } from '../../data/metrics';
import type { ColorToken } from './colorTokens';

/**
 * Format a letter grade together with its 4.0-scale point value as
 * `"X.X - A"` (e.g. `"4.0 - A"`, `"3.3 - B+"`, `"0.0 - F"`). The
 * point value always uses one decimal place so column widths stay
 * uniform on the card and on the printed handout.
 *
 * Letter-only grades (`U`, `FL`, `FD`, `FA`, `P`) carry no standard
 * point value, so we render the letter alone (e.g. `"U"`) and let
 * the colour convention flag them as failing.
 */
export function formatGradeWithPoints(grade: string): string {
  const letter = grade.trim().toUpperCase();
  const points = letterToPoints(grade);
  if (points == null) return letter || '—';
  return `${points.toFixed(1)} - ${letter}`;
}

/** Map a letter grade to a color token. Matches the convention
 *  used everywhere in the app: emerald ≥ B, amber C/D, rose F/U,
 *  slate for empty / non-letter grades. */
export function gradeTextToken(grade: string): ColorToken {
  const g = grade.trim().toUpperCase();
  if (!g) return 'slate';
  if (g.startsWith('F') || g.startsWith('U')) return 'rose';
  if (g.startsWith('D') || g === 'C' || g === 'C-' || g === 'C+') return 'amber';
  return 'emerald';
}
