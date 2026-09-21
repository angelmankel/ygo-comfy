import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Tracks "just copied this text" state for any number of buttons sharing the
 * hook. Returns a `copy(text, key?)` function and an `isCopied(key?)` predicate
 * — pass a key string when you have multiple copy buttons (e.g. positive +
 * negative prompts) so each can light up independently.
 *
 * The default key is the constant `''` (one button = no key needed). The
 * `copied` flag clears itself after `timeoutMs`. Calling `copy` again
 * cancels the previous timer so the indicator extends rather than flashes.
 */
export function useCopyToClipboard(timeoutMs = 1200) {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(async (text: string, key = '') => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard API can fail in insecure contexts — swallow; the caller's
      // status indicator just won't light up.
      return;
    }
    setCopied(key);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), timeoutMs);
  }, [timeoutMs]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const isCopied = useCallback((key = '') => copied === key, [copied]);

  return { copy, copied, isCopied };
}
