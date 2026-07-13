/**
 * useAutoFocusOnOpen — focuses an input element the moment `active`
 * flips to true. Used by the combobox dropdowns to autofocus the
 * search box the first time the popover opens. After the initial
 * focus, React keeps the input focused through normal interaction,
 * so the effect re-running on subsequent re-renders is harmless.
 */

import { useEffect, useRef } from 'react';

export function useAutoFocusOnOpen<T extends HTMLElement>(
  active: boolean
): React.RefObject<T> {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (active) ref.current?.focus();
  }, [active]);

  return ref;
}
