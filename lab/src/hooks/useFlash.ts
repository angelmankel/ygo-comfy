import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Short-lived boolean flag — the "Saved!" / "Sent!" / "Copied!" pulse pattern.
 * Call `flash()` to set it true; it clears itself after `timeoutMs`. Calling
 * again before the timer fires extends the indicator rather than flashes.
 *
 * For clipboard-specific flows use `useCopyToClipboard` — it wraps both the
 * navigator.clipboard call AND a flash in one hook.
 */
export function useFlash(timeoutMs = 1200): readonly [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback(() => {
    setOn(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOn(false), timeoutMs);
  }, [timeoutMs]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return [on, flash] as const;
}
