/**
 * Color tokens — single source of truth for the small palette the app
 * uses for stat values, GPA accents, and grade chips. The same
 * logical name (e.g. 'emerald') maps to BOTH a Tailwind class (for
 * the on-screen UI) and a hex value (for the print trees, which use
 * inline styles because print.css is loaded but Tailwind's content
 * scanner never visits it).
 *
 * Always reach for the SCREEN_COLOR_CLASS / PRINT_COLOR_* maps instead
 * of writing `text-emerald-300` or `'#6ee7b7'` inline so a future
 * palette tweak happens in one place.
 */

export type ColorToken =
  | 'emerald'
  | 'amber'
  | 'rose'
  | 'slate'
  | 'blue'
  | 'cyan'
  | 'violet'
  | 'orange'
  | 'fuchsia';

/** Tailwind class for the on-screen foreground colour. */
export const SCREEN_COLOR_CLASS: Record<ColorToken, string> = {
  emerald: 'text-emerald-300',
  amber: 'text-amber-300',
  rose: 'text-rose-300',
  slate: 'text-slate-200',
  blue: 'text-blue-300',
  cyan: 'text-cyan-300',
  violet: 'text-violet-300',
  orange: 'text-orange-300',
  fuchsia: 'text-fuchsia-300',
};

/** Hex foreground for the print tree on the dark theme. Pale -200
 *  shades designed for slate-950. */
export const PRINT_COLOR_DARK: Record<ColorToken, string> = {
  emerald: '#6ee7b7',
  amber: '#fde68a',
  rose: '#fca5a5',
  slate: '#cbd5e1',
  blue: '#bfdbfe',
  cyan: '#a5f3fc',
  violet: '#c4b5fd',
  orange: '#fed7aa',
  fuchsia: '#f5d0fe',
};

/** Hex foreground for the print tree on the light theme. Saturated
 *  700 shades designed for white. */
export const PRINT_COLOR_LIGHT: Record<ColorToken, string> = {
  emerald: '#047857',
  amber: '#b45309',
  rose: '#b91c1c',
  slate: '#334155',
  blue: '#1d4ed8',
  cyan: '#0e7490',
  violet: '#6d28d9',
  orange: '#c2410c',
  fuchsia: '#a21caf',
};

/** Map a GPA number to a colour token. Matches the on-screen
 *  convention: emerald ≥ 3.5, amber 2.0..3.5, rose < 2.0, slate when
 *  the value is non-finite. */
export function gpaToken(gpa: number): ColorToken {
  if (!Number.isFinite(gpa)) return 'slate';
  if (gpa >= 3.5) return 'emerald';
  if (gpa >= 2.0) return 'amber';
  return 'rose';
}
