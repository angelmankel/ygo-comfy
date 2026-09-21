/**
 * Brush tip texture cache.
 *
 * A brush tip is a small Texture of a soft white circle whose alpha falls
 * off radially from center to edge. Per-stamp color/opacity are applied by
 * the engine via Sprite.tint + Sprite.alpha; the tip itself is always white.
 *
 * Why CPU canvas2d (not a fragment shader): we generate the tip ONCE per
 * hardness value at high resolution (256×256), then stamp it unfiltered
 * during a stroke. The "low-quality blur" problem people hit with naive
 * canvas-based brushes is from re-running `filter: blur()` on every stamp,
 * not from radial gradients themselves. A `createRadialGradient` with
 * smoothstep-shaped stops is mathematically identical to what a fragment
 * shader would output, and avoids the cross-backend (WebGL/WebGPU/Canvas)
 * complexity of authoring + maintaining shader code. If we ever want
 * GPU-side procedural variation (per-stamp seed, randomness, etc.) the
 * engine consumes a Texture from this module, so swapping in a shader-based
 * generator later is a one-file change.
 */
import { Texture } from 'pixi.js';

/** Resolution at which every tip is rasterised. Larger = smoother edges at
 *  big brush sizes (we never upscale beyond this without artifacts), at the
 *  cost of GPU memory per cached hardness value (≈ 256KB each). */
const TIP_RES = 256;

/** Number of gradient stops used to approximate the smoothstep falloff.
 *  smoothstep is cubic; 16 stops keeps the curve visually indistinguishable
 *  from a true smoothstep at brush sizes the user will paint at. */
const FALLOFF_STOPS = 16;

/** Cache key precision for hardness. Hardness is a float 0..1 but the human
 *  eye can't tell 0.71 from 0.72, and caching every float would defeat the
 *  point. Round to 0.01. */
const HARDNESS_QUANTUM = 0.01;

const cache = new Map<number, Texture>();

/**
 * Get a Texture for the given hardness. Hardness 1.0 = razor-sharp edge,
 * 0.0 = full gaussian-style soft falloff. Re-runs are O(1) after the first
 * call per hardness bucket; first call costs one canvas2d gradient fill
 * (sub-millisecond).
 */
export function getBrushTipTexture(hardness: number): Texture {
  const key = Math.round(Math.max(0, Math.min(1, hardness)) / HARDNESS_QUANTUM) * HARDNESS_QUANTUM;
  const cached = cache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = TIP_RES;
  canvas.height = TIP_RES;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    // Defensive — should never happen in a normal browser. Returning EMPTY
    // means stamps will be invisible but won't crash the stroke.
    return Texture.EMPTY;
  }

  const cx = TIP_RES / 2;
  const cy = TIP_RES / 2;
  const r = TIP_RES / 2;
  // Inner radius beyond which alpha starts falling off. hardness=1 → falloff
  // starts at the very edge (essentially zero-width). hardness=0 → falloff
  // starts at center.
  const innerStop = key;

  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  if (innerStop >= 1 - 1e-3) {
    // Razor-sharp edge: single hard step. Tiny shoulder (0.99) avoids the
    // 1-pixel aliasing ring that happens when the gradient ends exactly at
    // alpha=1 on the canvas pixel grid.
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.995, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
  } else {
    // Smoothstep-shaped falloff between innerStop and 1.0. Cubic Hermite:
    // y = 1 - (3t² - 2t³) where t maps [innerStop..1] to [0..1].
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    if (innerStop > 0) grad.addColorStop(innerStop, 'rgba(255,255,255,1)');
    for (let i = 1; i < FALLOFF_STOPS; i++) {
      const t = i / FALLOFF_STOPS;
      const alpha = 1 - (3 * t * t - 2 * t * t * t);
      const stop = innerStop + t * (1 - innerStop);
      grad.addColorStop(stop, `rgba(255,255,255,${alpha.toFixed(4)})`);
    }
    grad.addColorStop(1, 'rgba(255,255,255,0)');
  }

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, TIP_RES, TIP_RES);

  const tex = Texture.from(canvas);
  cache.set(key, tex);
  return tex;
}

/** Drop every cached tip — used in tests / hot-reload paths. The textures'
 *  underlying canvases are garbage-collected once nothing references them. */
export function clearBrushTipCache(): void {
  for (const tex of cache.values()) {
    tex.destroy(true);
  }
  cache.clear();
}
