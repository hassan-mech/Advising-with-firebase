/**
 * PrintStatCard / PrintStatRow — the print-tree counterpart to
 * StatsCard / StatsRow. Same shape, but inline-styled (no Tailwind
 * classes) because print.css is loaded outside the Tailwind content
 * scan and so would otherwise not get included in the bundle.
 *
 * The colour values come from PRINT_COLOR_DARK / PRINT_COLOR_LIGHT
 * via the ColorToken type, so a future palette tweak is still a
 * one-file change in colorTokens.ts.
 */

import type { ReactNode } from 'react';
import type { ColorToken } from './colorTokens';
import { PRINT_COLOR_DARK, PRINT_COLOR_LIGHT } from './colorTokens';

export interface PrintStatTheme {
  fg: string;
  fgDim: string;
  fgMuted: string;
  cardBg: string;
  cardBorder: string;
}

export const PRINT_THEME_DARK: PrintStatTheme = {
  fg: '#f1f5f9',
  fgDim: '#cbd5e1',
  fgMuted: '#64748b',
  cardBg: 'rgba(255, 255, 255, 0.04)',
  cardBorder: 'rgba(255, 255, 255, 0.1)',
};

export const PRINT_THEME_LIGHT: PrintStatTheme = {
  fg: '#0f172a',
  fgDim: '#64748b',
  fgMuted: '#475569',
  cardBg: 'rgba(241, 245, 249, 0.6)',
  cardBorder: 'rgba(15, 23, 42, 0.18)',
};

/** Resolve a ColorToken to a hex string for the active print theme. */
function printColor(token: ColorToken, theme: 'dark' | 'light'): string {
  return theme === 'light' ? PRINT_COLOR_LIGHT[token] : PRINT_COLOR_DARK[token];
}

export function PrintStatRow({
  label,
  value,
  valueColor,
  hint,
  theme,
}: {
  label: string;
  value: string;
  valueColor: ColorToken;
  hint?: string;
  theme: 'dark' | 'light';
}) {
  const t = theme === 'light' ? PRINT_THEME_LIGHT : PRINT_THEME_DARK;
  return (
    <div className="pmaps-stat-row">
      <span className="pmaps-stat-label">{label}</span>
      <span className="pmaps-stat-value-wrap">
        {hint && <span className="pmaps-stat-hint">{hint}</span>}
        <span
          className="pmaps-stat-value"
          style={{ color: printColor(valueColor, theme) }}
        >
          {value}
        </span>
      </span>
    </div>
  );
}

export function PrintStatCard({
  title,
  children,
  theme,
}: {
  title: string;
  children: ReactNode;
  theme: 'dark' | 'light';
}) {
  const t = theme === 'light' ? PRINT_THEME_LIGHT : PRINT_THEME_DARK;
  return (
    <div
      className="pmaps-stat-card"
      style={{ backgroundColor: t.cardBg, borderColor: t.cardBorder, color: t.fg }}
    >
      <div className="pmaps-stat-title" style={{ color: t.fgDim }}>
        {title}
      </div>
      {children}
    </div>
  );
}
