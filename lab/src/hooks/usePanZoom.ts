import { useEffect, useRef, useState, type RefObject } from 'react';
import { THROW_MIN_DISTANCE, createVelocityTracker, runInertia } from '@/lib/momentum';

const ZOOM_MIN = 1;
const ZOOM_MAX = 8;
const SWIPE_THRESHOLD = 80; // px of horizontal flick (at zoom ~1) to navigate
const CLICK_BUFFER = 6;     // px of travel under which a press counts as a tap

type Options = {
  /** When this changes, zoom/offset reset and any running throw stops. */
  resetKey: unknown;
  /** Horizontal flick at zoom ~1 — `dir` is -1 (previous) or +1 (next). */
  onSwipe?: (dir: -1 | 1) => void;
  /** A press that didn't drag (a tap). */
  onTap?: () => void;
};

export type PanZoom = {
  zoom: number;
  offset: { x: number; y: number };
  /** True for ~250ms after a zoom-out snap-to-fit — the consumer can use
   *  this to add a CSS transition so the reframe animates instead of jumps. */
  reframing: boolean;
  handlers: {
    onWheel: (e: React.WheelEvent) => void;
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onClick: (e: React.MouseEvent) => void;
  };
};

/**
 * Pan + pinch-zoom + wheel-zoom + release momentum for a CSS-transformed
 * element. Pure gesture mechanics built on `lib/momentum` — the consumer
 * supplies `onSwipe` for un-zoomed horizontal flicks and `onTap` for plain
 * presses, and applies the returned `zoom`/`offset` as a transform.
 */
export function usePanZoom(
  containerRef: RefObject<HTMLElement | null>,
  { resetKey, onSwipe, onTap }: Options,
): PanZoom {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [reframing, setReframing] = useState(false);
  const reframeTimerRef = useRef<number | null>(null);

  // Snap back to the initial framing (zoom=ZOOM_MIN, offset=0) and flash the
  // `reframing` flag so the consumer can animate the transition.
  const reframe = () => {
    setZoom(ZOOM_MIN);
    setOffset({ x: 0, y: 0 });
    setReframing(true);
    if (reframeTimerRef.current != null) window.clearTimeout(reframeTimerRef.current);
    reframeTimerRef.current = window.setTimeout(() => setReframing(false), 260);
  };

  const pointersRef = useRef(new Map<number, { x: number; y: number; sx: number; sy: number }>());
  const downPosRef = useRef<{ x: number; y: number } | null>(null);
  const panStartRef = useRef<{ ox: number; oy: number } | null>(null);
  const pinchStartRef = useRef<{ d: number; z: number; ox: number; oy: number; cx: number; cy: number } | null>(null);
  const velocity = useRef(createVelocityTracker());
  const cancelInertiaRef = useRef<(() => void) | null>(null);

  // Latest zoom/offset, so the imperative pointer handlers never read stale state.
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  const offsetRef = useRef(offset); offsetRef.current = offset;

  const stopInertia = () => {
    cancelInertiaRef.current?.();
    cancelInertiaRef.current = null;
  };

  // Reset when the target changes; stop any throw on unmount.
  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setReframing(false);
    if (reframeTimerRef.current != null) window.clearTimeout(reframeTimerRef.current);
    stopInertia();
  }, [resetKey]);
  useEffect(() => () => {
    stopInertia();
    if (reframeTimerRef.current != null) window.clearTimeout(reframeTimerRef.current);
  }, []);

  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    stopInertia();
    const r = containerRef.current?.getBoundingClientRect();
    if (!r) return;
    const mx = e.clientX - r.left - r.width / 2;
    const my = e.clientY - r.top - r.height / 2;
    const factor = Math.exp(-e.deltaY * 0.001);
    const z = zoomRef.current;
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z * factor));
    // Hit the floor → reframe to the original framing.
    if (newZoom <= ZOOM_MIN + 0.001 && z > ZOOM_MIN + 0.001) {
      reframe();
      return;
    }
    const k = newZoom / z - 1;
    setOffset(o => ({ x: o.x - mx * k, y: o.y - my * k }));
    setZoom(newZoom);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    stopInertia();
    e.currentTarget.setPointerCapture(e.pointerId);
    const map = pointersRef.current;
    map.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });

    if (map.size === 1) {
      panStartRef.current = { ox: offsetRef.current.x, oy: offsetRef.current.y };
      pinchStartRef.current = null;
      downPosRef.current = { x: e.clientX, y: e.clientY };
      velocity.current.reset(e.clientX, e.clientY);
    } else if (map.size === 2) {
      downPosRef.current = null;
      const [a, b] = [...map.values()];
      const r = containerRef.current!.getBoundingClientRect();
      pinchStartRef.current = {
        d: dist(a, b),
        z: zoomRef.current,
        ox: offsetRef.current.x,
        oy: offsetRef.current.y,
        cx: (a.x + b.x) / 2 - r.left - r.width / 2,
        cy: (a.y + b.y) / 2 - r.top - r.height / 2,
      };
      panStartRef.current = null;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const map = pointersRef.current;
    const pt = map.get(e.pointerId);
    if (!pt) return;
    pt.x = e.clientX;
    pt.y = e.clientY;

    if (map.size === 1 && panStartRef.current) {
      const only = [...map.values()][0];
      setOffset({
        x: panStartRef.current.ox + (only.x - only.sx),
        y: panStartRef.current.oy + (only.y - only.sy),
      });
      velocity.current.sample(e.clientX, e.clientY);
    } else if (map.size === 2 && pinchStartRef.current) {
      const [a, b] = [...map.values()];
      const r = containerRef.current?.getBoundingClientRect();
      if (!r) return;
      const start = pinchStartRef.current;
      const newD = dist(a, b);
      const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, start.z * newD / start.d));
      // Keep the image-space point under the pinch centroid pinned as it moves,
      // so pan and zoom apply together.
      const ncx = (a.x + b.x) / 2 - r.left - r.width / 2;
      const ncy = (a.y + b.y) / 2 - r.top - r.height / 2;
      const imgPx = (start.cx - start.ox) / start.z;
      const imgPy = (start.cy - start.oy) / start.z;
      setZoom(newZoom);
      setOffset({ x: ncx - newZoom * imgPx, y: ncy - newZoom * imgPy });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const map = pointersRef.current;
    const pt = map.get(e.pointerId);
    if (!pt) return;
    const dx = pt.x - pt.sx;
    const dy = pt.y - pt.sy;
    map.delete(e.pointerId);

    if (map.size === 0) {
      // After a pinch-out below the floor, snap back to the initial framing.
      if (zoomRef.current <= ZOOM_MIN + 0.001 && (offsetRef.current.x !== 0 || offsetRef.current.y !== 0)) {
        reframe();
      } else if (panStartRef.current) {
        const moved = Math.hypot(dx, dy);
        if (zoomRef.current <= 1.05) {
          // Un-zoomed: a horizontal flick navigates; otherwise snap back.
          if (moved > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
            onSwipe?.(dx > 0 ? -1 : 1);
          } else {
            setOffset({ x: 0, y: 0 });
          }
        } else if (moved > THROW_MIN_DISTANCE) {
          // Zoomed in: throw the image with the (idle-decayed) release velocity.
          stopInertia();
          cancelInertiaRef.current = runInertia(velocity.current.release(), (sdx, sdy) =>
            setOffset(o => ({ x: o.x + sdx, y: o.y + sdy })));
        }
      }
      panStartRef.current = null;
      pinchStartRef.current = null;
    } else if (map.size === 1) {
      // Pinch ended, one finger remains — reseat the pan + velocity baseline.
      const remaining = [...map.values()][0];
      remaining.sx = remaining.x;
      remaining.sy = remaining.y;
      panStartRef.current = { ox: offsetRef.current.x, oy: offsetRef.current.y };
      pinchStartRef.current = null;
      velocity.current.reset(remaining.x, remaining.y);
    }
  };

  const onClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    // A press that didn't drag is a tap; a real drag — pan, swipe, throw — isn't.
    const down = downPosRef.current;
    downPosRef.current = null;
    if (!down) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) <= CLICK_BUFFER) onTap?.();
  };

  return { zoom, offset, reframing, handlers: { onWheel, onPointerDown, onPointerMove, onPointerUp, onClick } };
}
