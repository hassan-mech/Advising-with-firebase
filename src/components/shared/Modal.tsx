/**
 * Modal — shared shell for the centred card dialogs (student detail,
 * term manager). Standardises the backdrop, click-outside, escape
 * close, and the right-aligned X button.
 *
 * The header is a thin prop (`header`) so each caller can build
 * whatever left-side content it needs (icon + title + subtitle,
 * plain title, no header, …) without forking the shell. The footer
 * is similarly a slot.
 *
 * Why an `open` prop instead of letting the caller mount/unmount
 * the modal directly:
 *   - keeps the backdrop + X button in the DOM only while visible
 *     (avoids stray focus / click-outside listeners when closed)
 *   - centralises the escape-key + click-outside wiring
 *
 * Callers that need to keep DOM around (e.g. the print tree) still
 * mount their own dialog; this is for the on-screen popovers.
 */

import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Tailwind max-width class. Default 'max-w-2xl'. */
  maxWidth?: string;
  /** Optional right-side content for the header (icons, badges, …). */
  headerExtra?: ReactNode;
  /** Card body. */
  children: ReactNode;
  /** Optional footer row (e.g. the TermManagerModal's create form). */
  footer?: ReactNode;
}

/** Escape key closes the modal. Wired only while `open` is true. */
function useEscapeClose(active: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [active, onClose]);
}

export default function Modal({
  open,
  onClose,
  maxWidth = 'max-w-2xl',
  headerExtra,
  children,
  footer,
}: ModalProps) {
  useEscapeClose(open, onClose);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4"
      onClick={onClose}
    >
      <div
        className={`relative w-full ${maxWidth} bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden text-slate-100 flex flex-col max-h-[90vh]`}
        onClick={(e) => e.stopPropagation()}
      >
        {headerExtra && (
          <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1.5">
            {headerExtra}
            <button
              onClick={onClose}
              title="Close"
              aria-label="Close"
              className="p-1.5 hover:bg-white/15 rounded-full transition-colors cursor-pointer text-slate-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer && (
          <div className="px-5 py-4 border-t border-white/10">{footer}</div>
        )}
      </div>
    </div>
  );
}
