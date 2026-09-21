/**
 * Shared "throw" / inertia primitives for drag interactions — used by both the
 * infinite canvas controller and the fullscreen viewer's pan-zoom.
 *
 * The hard part these solve: a pointer fires no `pointermove` events while held
 * still, so "drag fast, stop, then release" leaves a stale (fast) velocity. The
 * velocity tracker timestamps every sample and decays the reported velocity by
 * how long the pointer sat idle before release.
 */

/** A drag only "throws" if it covered at least this much total travel (px). */
export const THROW_MIN_DISTANCE = 14;
/** Idle time (ms) within which a release still counts as a live flick. */
export const THROW_GRACE_MS = 24;
/** Idle time (ms) past which the release velocity is treated as fully stale. */
export const THROW_STALE_MS = 90;

/** Velocity multiplier for a release after `idleMs` of no movement: 1 → 0. */
export function freshness(idleMs: number): number {
  if (idleMs <= THROW_GRACE_MS) return 1;
  return Math.max(0, 1 - (idleMs - THROW_GRACE_MS) / (THROW_STALE_MS - THROW_GRACE_MS));
}

export type Vec = { x: number; y: number };

/**
 * Smoothed pointer-velocity tracker in screen px/ms. Call `reset()` on pointer
 * down, `sample()` on every move, and `release()` on up to get the idle-decayed
 * velocity to hand to an inertia animation.
 */
export function createVelocityTracker() {
  let last: { x: number; y: number; t: number } | null = null;
  let vx = 0;
  let vy = 0;

  return {
    reset(x: number, y: number) {
      last = { x, y, t: performance.now() };
      vx = 0;
      vy = 0;
    },
    sample(x: number, y: number) {
      const now = performance.now();
      if (last) {
        const dt = now - last.t;
        if (dt > 0) {
          vx = vx * 0.7 + ((x - last.x) / dt) * 0.3;
          vy = vy * 0.7 + ((y - last.y) / dt) * 0.3;
        }
      }
      last = { x, y, t: now };
    },
    /** Velocity decayed by however long the pointer sat idle since the last sample. */
    release(): Vec {
      const idle = last ? performance.now() - last.t : Infinity;
      const f = freshness(idle);
      return { x: vx * f, y: vy * f };
    },
  };
}

/**
 * Run a decaying inertia animation. `onStep` receives the per-frame delta to
 * apply (already velocity × dt). Returns a `cancel()` handle.
 */
export function runInertia(
  velocity: Vec,
  onStep: (dx: number, dy: number) => void,
  opts: { minSpeed?: number; stopSpeed?: number; decayPerFrame?: number } = {},
): () => void {
  const minSpeed = opts.minSpeed ?? 0.04;
  const stopSpeed = opts.stopSpeed ?? 0.012;
  const decayPerFrame = opts.decayPerFrame ?? 0.94;
  let { x: vx, y: vy } = velocity;
  if (Math.hypot(vx, vy) < minSpeed) return () => { /* nothing started */ };

  let raf = 0;
  let last = performance.now();
  const tick = (now: number) => {
    const dt = Math.min(40, now - last);
    last = now;
    onStep(vx * dt, vy * dt);
    const decay = Math.pow(decayPerFrame, dt / 16);
    vx *= decay;
    vy *= decay;
    if (Math.hypot(vx, vy) > stopSpeed) {
      raf = requestAnimationFrame(tick);
    } else {
      raf = 0;
    }
  };
  raf = requestAnimationFrame(tick);
  return () => { if (raf) cancelAnimationFrame(raf); };
}
