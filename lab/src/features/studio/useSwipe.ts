/**
 * Horizontal swipe between Studio's phone panes.
 *
 * Only a gesture that starts clearly horizontal is claimed: a drag that begins vertically belongs
 * to whatever is scrolling underneath, and stealing it makes a long parameter list unusable. The
 * decision is made once, at the point the finger has moved far enough to have an opinion, and
 * never revisited for that gesture.
 */
import { useEffect } from 'react';

const COMMIT_PX = 10;     // far enough to tell horizontal from vertical
const THRESHOLD_PX = 64;  // far enough to count as a swipe rather than a wobble

export function useSwipe(
  onSwipe: (direction: 'left' | 'right') => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    let start: { x: number; y: number } | null = null;
    let axis: 'h' | 'v' | null = null;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { start = null; return; }
      // A control the finger landed on owns the gesture: dragging a slider must not page away.
      if ((e.target as HTMLElement | null)?.closest('input,textarea,select,[role="slider"],[data-no-swipe]')) {
        start = null; return;
      }
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      axis = null;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const dx = e.touches[0].clientX - start.x;
      const dy = e.touches[0].clientY - start.y;
      if (!axis && Math.hypot(dx, dy) > COMMIT_PX) axis = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    };
    const onEnd = (e: TouchEvent) => {
      if (!start || axis !== 'h') { start = null; return; }
      const dx = e.changedTouches[0].clientX - start.x;
      if (Math.abs(dx) > THRESHOLD_PX) onSwipe(dx < 0 ? 'left' : 'right');
      start = null; axis = null;
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', () => { start = null; }, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    };
  }, [onSwipe, enabled]);
}
