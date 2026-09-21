import { useEffect, useRef } from 'react';
import { isTypingTarget } from '@/lib/keys';

/**
 * Global keyboard-shortcut registry.
 *
 * Why this exists: 10+ `window.addEventListener('keydown', …)` registrations
 * scattered across overlays, panels, and hooks would compete for the same
 * keystrokes (Esc, arrows, Space) — whoever React mounted first won, and
 * `isTypingTarget()` checks drifted between call sites. This hook funnels
 * everything through one listener that:
 *
 *  - Skips when the target is a typing element (inputs, textareas,
 *    contenteditable) unless the consumer opts out via `skipTyping: false`.
 *  - Sorts active consumers by `priority` (higher fires first). Overlays
 *    register with higher priority than the panels behind them so e.g. ←/→
 *    in the metadata gallery doesn't also step the history selection.
 *  - Stops at the first handler that returns truthy / undefined. Return
 *    `false` from a handler to let the next-lower-priority match also run.
 *
 * Key spec strings: lowercase modifiers joined by `+`, last token is the key.
 *   'Escape', 'ArrowLeft', 'cmd+Enter', 'shift+ArrowRight', 'meta+s'
 *
 * `cmd` / `meta` are aliases for the Meta key on macOS, Ctrl on Windows /
 * Linux — both match either modifier so callers don't have to branch.
 */

export type ShortcutOptions = {
  /** When false, fire even inside inputs/textareas/contenteditable. Default true. */
  skipTyping?: boolean;
  /** Higher priority handlers fire first. Default 0. Use the constants below. */
  priority?: number;
  /** When `when()` returns false, the shortcut is skipped at fire time —
   *  cheaper than re-registering when an overlay opens/closes. */
  when?: () => boolean;
};

/** Priority bands — pick the closest match instead of inventing numbers. */
export const ShortcutPriority = {
  /** Topmost overlays (confirm dialog, fullscreen image viewer). */
  TopOverlay: 100,
  /** Full-screen feature overlays (Comfy, Collections, ModelMetadata). */
  Overlay: 80,
  /** Mobile drawers / popovers (AddLayerMenu). */
  Drawer: 50,
  /** Panel-level (HistoryPanel arrows). */
  Panel: 30,
  /** Page / app shortcuts (Generate, fit-to-view). */
  Global: 10,
} as const;

type ParsedSpec = {
  /** Lowercased `e.key` to match against. */
  key: string;
  cmd: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
};

function parseSpec(s: string): ParsedSpec {
  // Don't trim each token — a bare ' ' (Space) would become empty. Split on
  // '+', take the last as the key, everything else as modifier tokens.
  const tokens = s.split('+');
  let key = (tokens.pop() ?? '').toLowerCase();
  // Accept 'space' as a synonym for ' ' to make the spec readable.
  if (key === 'space') key = ' ';
  const mods = tokens.map(t => t.trim().toLowerCase());
  return {
    key,
    cmd: mods.includes('cmd') || mods.includes('meta'),
    ctrl: mods.includes('ctrl'),
    shift: mods.includes('shift'),
    alt: mods.includes('alt'),
  };
}

function matches(e: KeyboardEvent, spec: ParsedSpec): boolean {
  if (e.key.toLowerCase() !== spec.key) return false;
  // cmd/meta accepts EITHER metaKey (macOS) or ctrlKey (Windows/Linux) so
  // a single 'cmd+Enter' spec works cross-platform.
  if (spec.cmd && !(e.metaKey || e.ctrlKey)) return false;
  if (!spec.cmd && spec.ctrl && !e.ctrlKey) return false;
  if (spec.shift !== e.shiftKey) return false;
  if (spec.alt !== e.altKey) return false;
  return true;
}

type Consumer = {
  specs: ParsedSpec[];
  handlerRef: { current: (e: KeyboardEvent) => boolean | void };
  skipTyping: boolean;
  priority: number;
  when: (() => boolean) | undefined;
};

const consumers = new Set<Consumer>();
let listenerInstalled = false;

function ensureListener() {
  if (listenerInstalled || typeof window === 'undefined') return;
  listenerInstalled = true;
  window.addEventListener('keydown', (e) => {
    const sorted = [...consumers].sort((a, b) => b.priority - a.priority);
    for (const c of sorted) {
      if (c.skipTyping && isTypingTarget(e.target)) continue;
      if (c.when && !c.when()) continue;
      if (!c.specs.some(spec => matches(e, spec))) continue;
      const r = c.handlerRef.current(e);
      if (r !== false) break; // any non-false return ends the chain
    }
  });
}

/**
 * Register a keyboard shortcut for the lifetime of the component. The handler
 * can return `false` to allow lower-priority handlers to also run.
 */
export function useShortcut(
  keys: string | string[],
  handler: (e: KeyboardEvent) => boolean | void,
  opts: ShortcutOptions = {},
) {
  const handlerRef = useRef(handler);
  useEffect(() => { handlerRef.current = handler; });

  const keyList = Array.isArray(keys) ? keys : [keys];
  // Stable join so deps below catch list changes but not spec-object identity.
  const keysKey = keyList.join('|');
  const { skipTyping = true, priority = 0, when } = opts;

  useEffect(() => {
    ensureListener();
    const specs = keyList.map(parseSpec);
    const consumer: Consumer = { specs, handlerRef, skipTyping, priority, when };
    consumers.add(consumer);
    return () => { consumers.delete(consumer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysKey, skipTyping, priority, when]);
}
