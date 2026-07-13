/**
 * StatsCard / StatsRow — the on-screen variant of the stat strip
 * used in StudentDetailModal's metric grid and the PlanStats strip
 * on the prereq map.
 *
 * The print tree has its own PrintStatCard / PrintStatRow pair
 * (same shape, but inline-styled because the print CSS lives in
 * print.css and Tailwind's scanner never visits it). Both consume
 * `ColorToken` from colorTokens.ts so the actual color values live
 * in one place.
 */

import type { ReactNode } from 'react';
import type { ColorToken } from './colorTokens';
import { SCREEN_COLOR_CLASS } from './colorTokens';

const BORDER_ACCENT: Record<ColorToken, string> = {
  emerald: 'border-emerald-500/30',
  amber: 'border-amber-500/30',
  rose: 'border-rose-500/30',
  slate: 'border-white/10',
  blue: 'border-blue-500/30',
  cyan: 'border-cyan-500/30',
  violet: 'border-violet-500/30',
  orange: 'border-orange-500/30',
  fuchsia: 'border-fuchsia-500/30',
};

/** One labelled row inside a StatsCard. */
export function StatsRow({
  label,
  value,
  accent,
  hint,
  valueSize = 'md',
}: {
  label: string;
  value: ReactNode;
  /** Foreground colour of the value. Falls back to slate-200. */
  accent?: ColorToken;
  /** Small grey label rendered just before the value (e.g. "+0.123
   *  vs current"). Used by the Expected-GPA row. */
  hint?: string;
  /** `sm` = text-base (the PlanStats strip), `lg` = text-2xl
   *  (StudentDetailModal's metric grid), `xl` = text-3xl. */
  valueSize?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const sizeClass =
    valueSize === 'xl'
      ? 'text-3xl'
      : valueSize === 'lg'
        ? 'text-2xl'
        : valueSize === 'sm'
          ? 'text-sm'
          : 'text-base';
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-slate-400 uppercase tracking-wider font-bold text-[9px]">
        {label}
      </span>
      <span className="flex items-baseline gap-2">
        {hint && (
          <span className="text-[9px] text-slate-500 normal-case tracking-normal">
            {hint}
          </span>
        )}
        <span
          className={`font-mono font-extrabold ${sizeClass} ${
            accent ? SCREEN_COLOR_CLASS[accent] : 'text-slate-200'
          }`}
        >
          {value}
        </span>
      </span>
    </div>
  );
}

/** Card shell for one of the stat panels. */
export function StatsCard({
  title,
  children,
  accent,
  bordered = true,
}: {
  title: string;
  children: ReactNode;
  /** Optional accent border colour around the card. */
  accent?: ColorToken;
  /** When false the card is borderless (used by StudentDetailModal's
   *  small metric cells, which rely on the page background instead). */
  bordered?: boolean;
}) {
  const borderClass = bordered
    ? accent
      ? BORDER_ACCENT[accent]
      : 'border-white/10'
    : 'border-white/5';
  return (
    <div className={`rounded-xl border ${borderClass} bg-white/5 p-3`}>
      <div className="text-[10px] uppercase tracking-wider font-extrabold text-slate-400 mb-2">
        {title}
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}
