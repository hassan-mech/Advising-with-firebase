/**
 * useClickOutside — closes a popover when the user clicks outside of
 * it. Used by the combobox dropdowns. When `active` is false the
 * listener is not registered, so we don't pay the cost on closed
 * dropdowns.
 *
 * The hook returns a ref to attach to the container element. The
 * listener uses `mousedown` (not `click`) so a click that started
 * inside the popover (e.g. dragging a selection across the boundary)
 * doesn't fire the close handler.
 */

import { useEffect, useRef } from 'react';

export function useClickOutside<T extends HTMLElement>(
  active: boolean,
  onOutside: () => void
): React.RefObject<T> {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onOutside();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [active, onOutside]);

  return ref;
}
