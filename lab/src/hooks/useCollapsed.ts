import { useCallback, useState } from 'react';
import { loadCollapsed, saveCollapsed } from '@/lib/storage';

/**
 * Persisted collapsed state for a section. `key` is the localStorage subkey
 * (under `COLLAPSE_KEY`); `defaultCollapsed` is used on the first-ever load.
 * Returns `[collapsed, toggle, set]` so callers can both toggle and force a
 * specific state (e.g. expand-on-add).
 */
export function useCollapsed(key: string, defaultCollapsed: boolean): [boolean, () => void, (next: boolean) => void] {
  const [collapsed, setCollapsedState] = useState<boolean>(() => loadCollapsed(key, defaultCollapsed));

  const set = useCallback((next: boolean) => {
    setCollapsedState(next);
    saveCollapsed(key, next);
  }, [key]);

  const toggle = useCallback(() => {
    setCollapsedState(prev => {
      const next = !prev;
      saveCollapsed(key, next);
      return next;
    });
  }, [key]);

  return [collapsed, toggle, set];
}
