/**
 * Controller support, for a phone clipped into a gamepad.
 *
 * The Gamepad API has no event for button presses — only a snapshot you poll — so this runs a
 * rAF loop while a pad is connected and turns edges into callbacks. It idles completely when no
 * pad is attached: the loop is not even started until a `gamepadconnected` event arrives, so a
 * phone with no controller pays nothing.
 *
 * Analog sticks are treated as a repeating d-pad rather than a cursor. Nudging a value is what a
 * stick is for here; a free-floating pointer on a touch UI would be worse than the touch UI.
 */
import { useEffect, useRef, useState } from 'react';

export type PadButton =
  | 'a' | 'b' | 'x' | 'y'
  | 'lb' | 'rb' | 'lt' | 'rt'
  | 'back' | 'start'
  | 'up' | 'down' | 'left' | 'right';

/** Standard-mapping indices, which every modern pad reports on Android and desktop alike. */
const BUTTONS: Record<number, PadButton> = {
  0: 'a', 1: 'b', 2: 'x', 3: 'y',
  4: 'lb', 5: 'rb', 6: 'lt', 7: 'rt',
  8: 'back', 9: 'start',
  12: 'up', 13: 'down', 14: 'left', 15: 'right',
};

const DEADZONE = 0.5;
/** Hold-to-repeat, matching a key repeat: a long first gap, then quick ones. */
const REPEAT_FIRST_MS = 420, REPEAT_NEXT_MS = 90;

export interface GamepadHandlers {
  /** A button went down. Repeats are delivered for the d-pad and sticks only. */
  onPress?: (button: PadButton) => void;
  onRelease?: (button: PadButton) => void;
}

/**
 * Returns whether a pad is currently connected, so the UI can show its hints only when they mean
 * something. Handlers are read through a ref, so passing fresh closures every render is fine.
 */
export function useGamepad(handlers: GamepadHandlers, enabled = true): boolean {
  const [connected, setConnected] = useState(false);
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !navigator.getGamepads) return;

    let raf = 0;
    let running = false;
    const down = new Map<PadButton, number>();   // button → when it next repeats

    const fire = (b: PadButton, repeatable: boolean, now: number) => {
      const next = down.get(b);
      if (next === undefined) {
        down.set(b, repeatable ? now + REPEAT_FIRST_MS : Number.POSITIVE_INFINITY);
        ref.current.onPress?.(b);
      } else if (repeatable && now >= next) {
        down.set(b, now + REPEAT_NEXT_MS);
        ref.current.onPress?.(b);
      }
    };

    const poll = () => {
      const pads = navigator.getGamepads?.() ?? [];
      const now = performance.now();
      const seen = new Set<PadButton>();

      for (const pad of pads) {
        if (!pad) continue;
        pad.buttons.forEach((btn, i) => {
          const name = BUTTONS[i];
          // Triggers are analog: `pressed` can stay false through a soft pull.
          if (!name || !(btn.pressed || btn.value > 0.5)) return;
          seen.add(name);
          fire(name, name === 'up' || name === 'down' || name === 'left' || name === 'right', now);
        });
        // Left stick doubles as the d-pad, so either input drives the same actions.
        const [ax = 0, ay = 0] = pad.axes;
        const axis: [number, PadButton, PadButton][] = [[ax, 'left', 'right'], [ay, 'up', 'down']];
        for (const [v, neg, pos] of axis) {
          if (v < -DEADZONE) { seen.add(neg); fire(neg, true, now); }
          else if (v > DEADZONE) { seen.add(pos); fire(pos, true, now); }
        }
      }

      for (const b of [...down.keys()]) {
        if (!seen.has(b)) { down.delete(b); ref.current.onRelease?.(b); }
      }
      raf = requestAnimationFrame(poll);
    };

    const start = () => { if (!running) { running = true; setConnected(true); raf = requestAnimationFrame(poll); } };
    const stop = () => {
      if (!(navigator.getGamepads?.() ?? []).some(Boolean)) {
        running = false; setConnected(false); cancelAnimationFrame(raf); down.clear();
      }
    };

    window.addEventListener('gamepadconnected', start);
    window.addEventListener('gamepaddisconnected', stop);
    // A pad paired before the page loaded reports nothing until it is touched, but Chrome does
    // list it — so check once rather than waiting for an event that already happened.
    if ((navigator.getGamepads?.() ?? []).some(Boolean)) start();

    return () => {
      window.removeEventListener('gamepadconnected', start);
      window.removeEventListener('gamepaddisconnected', stop);
      cancelAnimationFrame(raf);
    };
  }, [enabled]);

  return connected;
}
