/**
 * Brush / erase stroke engine.
 *
 * One engine per CanvasController, allocated on first use. Handles:
 *   - per-layer RenderTexture lifecycle (seeded from the layer's current
 *     selected-history pixels at stroke-start; sprite swapped to render from
 *     the RT during the stroke; persisted as a new LayerHistoryEntry on
 *     stroke-end).
 *   - tip stamping with size/hardness/opacity/color via brushTip.ts.
 *   - smooth strokes by interpolating stamp positions between pointer events
 *     at `spacing × size` world units.
 *
 * Mode-agnostic: `mode: 'paint' | 'erase'` flips the blend mode and source
 * color. Both modes share one stroke-session record-and-commit lifecycle, so
 * adding more brush-family tools later (e.g. smudge, clone-stamp) means
 * adding a mode case, not a new engine.
 */
import { Container, RenderTexture, Sprite, Texture, type Application } from 'pixi.js';
import type { CanvasLayer, LayerHistoryEntry } from '../types';
import { canvasStorage } from '../canvasStorageInstance';
import { uid } from '../storage';
import { useCanvasStore } from '../canvasStore';
import { getBrushTipTexture } from './brushTip';
import { encodePibr } from './pibr';

export type BrushMode = 'paint' | 'erase';

export type BrushStrokeOptions = {
  mode: BrushMode;
  size: number;       // world px
  hardness: number;   // 0..1
  opacity: number;    // 0..1
  spacing: number;    // 0..1 of size
  color: string;      // CSS hex (paint only)
};

type ActiveStroke = {
  layerId: string;
  layer: CanvasLayer;
  /** Cached committed-pixels RT for this layer (lives in layerRtCache). */
  layerRt: RenderTexture;
  /** Per-stroke RT that collects every stamp at FULL opacity. The brush's
   *  opacity is applied once — at composite time — by setting the stroke
   *  sprite's alpha (display) or the render alpha (commit). This avoids
   *  the soft-brush stacking problem where overlapping semi-transparent
   *  stamps converge toward 100% opacity within a single stroke. */
  strokeRt: RenderTexture;
  /** Container holding both layer sprite (committed) and stroke sprite
   *  (in-flight strokeRt at brush opacity). Swapped into the scene in
   *  place of the layer's normal sprite for the stroke duration. */
  displayContainer: Container;
  /** Top-layer sprite that renders strokeRt at brush opacity + the
   *  configured blend mode. */
  strokeSprite: Sprite;
  /** Off-screen container holding the stamps queued between renderer flushes
   *  (one per frame). Flushed into strokeRt on each stamp call. */
  stampBuffer: Container;
  options: BrushStrokeOptions;
  lastX: number;      // last stamp center in layer-local coords
  lastY: number;
  /** Carry-over distance from the previous segment so spacing stays even
   *  across pointer events of unequal length. */
  carry: number;
  /** RGB tint as a Pixi-friendly 0xRRGGBB number, derived once. */
  tintNum: number;
  /** True once the seed-from-history render completes. Stamps queued before
   *  this flag flips are held in stampBuffer (not rendered into the RT) so
   *  the seed doesn't end up on top of them. */
  seedReady: boolean;
  /** rAF handle for the per-frame redraw loop kept alive during a stroke. */
  rafId: number;
};

export type BrushEngine = {
  beginStroke: (layerId: string, worldX: number, worldY: number, options: BrushStrokeOptions) => void;
  continueStroke: (worldX: number, worldY: number) => void;
  endStroke: () => Promise<void>;
  /** Cancel without committing. Used when the user switches layers / tools
   *  mid-stroke or the pointer is force-released. */
  cancelStroke: () => void;
  isStrokeActive: () => boolean;
  /** Dispose any cached per-layer RTs + the engine's sprite hookups. */
  dispose: () => void;
};

export type BrushEngineDeps = {
  app: Application;
  /** Container holding the per-layer display sprites. The engine attaches
   *  its own stroke-display sprite here so it renders alongside the layer's
   *  normal sprite (which gets temporarily hidden during the stroke). */
  spritesGfx: Container;
  /** Resolve the layer's currently-selected history entry's pixels as a
   *  Texture — engine uses this to seed the stroke RT so paint goes on top
   *  of the existing image, not a blank canvas. Resolves to null if the
   *  layer has no selection (paint starts on a transparent canvas). */
  getSelectedTexture: (layer: CanvasLayer) => Promise<Texture | null>;
  /** Restore the layer's normal display sprite after the engine swaps it
   *  out for the stroke. Called from endStroke / cancelStroke. */
  restoreLayerSprite: (layerId: string) => void;
  /** Hide the layer's normal display sprite during the stroke so it doesn't
   *  draw over the engine's RT-backed sprite. Called from beginStroke. */
  hideLayerSprite: (layerId: string) => void;
  /** Re-point the layer's normal sprite at the given Texture. The engine
   *  calls this right before teardown so the layer keeps showing the live
   *  committed pixels (engine's layerRt) without waiting for the async
   *  React-side PNG reload to swap the texture. */
  setLayerSpriteTexture: (layerId: string, texture: Texture) => void;
  /** Tell the React-side rehydrate effect that this layer's selected
   *  history id is already painted on its sprite (because we just baked
   *  it from the live RT). Without this signal the effect would re-fetch
   *  the PNG and overwrite the sprite — costing a frame of visible
   *  un-premultiply quality loss at brush edges. */
  markHistoryLoaded: (layerId: string, historyId: string) => void;
  /** Re-render the controller's stage to the screen. The engine renders
   *  into RenderTextures (which updates the RT contents) but the stage
   *  itself doesn't redraw automatically because pixi runs with
   *  `autoStart: false`. Calling this after each flush is what makes the
   *  stroke visible live. */
  requestRender: () => void;
};

/** Fresh read of a layer from the canvas store. Used in lieu of injecting
 *  a getter — the engine is a leaf consumer of canvasStore anyway (for the
 *  selectedHistoryId update on commit). */
function readLayer(id: string): CanvasLayer | null {
  return useCanvasStore.getState().canvasLayers.find(l => l.id === id) ?? null;
}

/** Per-layer in-memory RT kept alive across strokes so consecutive paint
 *  doesn't roundtrip pixels through PNG encode/decode every commit. The
 *  extract→canvas→toBlob→Image→texture roundtrip un-premultiplies and
 *  re-premultiplies alpha at brush edges; low-alpha pixels accumulate
 *  floating-point error that visualises as a dark halo growing with each
 *  stroke. Holding the RT in memory side-steps the entire loop — commits
 *  still happen for the history record, but the next stroke paints on the
 *  same uncorrupted pixels.
 *
 *  Cache entry's `seedHistoryId` records which history entry the RT was
 *  built from, plus any commits we've appended since. On beginStroke we
 *  compare against the layer's CURRENT selectedHistoryId — if they diverge
 *  (the user clicked an older thumb / loaded a different gen), the cache
 *  is stale and we re-seed. */
type LayerRtCacheEntry = {
  rt: RenderTexture;
  /** The history entry id the RT's pixels are known to match. Updated on
   *  each successful commit so subsequent strokes don't re-seed. */
  seedHistoryId: string | null;
  /** RT dimensions — re-create on layer-bounds change. */
  w: number;
  h: number;
};

export function createBrushEngine(deps: BrushEngineDeps): BrushEngine {
  let stroke: ActiveStroke | null = null;
  const layerRtCache = new Map<string, LayerRtCacheEntry>();

  const disposeCacheEntry = (id: string) => {
    const entry = layerRtCache.get(id);
    if (!entry) return;
    entry.rt.destroy(true);
    layerRtCache.delete(id);
  };

  const hexToTintNum = (hex: string): number => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return 0x000000;
    return parseInt(m[1], 16);
  };

  /** Render every queued stamp into the RT, then clear the buffer. Held off
   *  until the seed render lands (otherwise stamps would draw under it).
   *  Stage re-render is driven by the rAF loop, not by this function — calling
   *  renderer.render() inside a pointer handler doesn't always cause the
   *  RT-backed displaySprite to repaint in pixi v8, but a per-frame stage
   *  render from rAF reliably does. */
  const flushStampBuffer = () => {
    if (!stroke || !stroke.seedReady) return;
    if (stroke.stampBuffer.children.length === 0) return;
    deps.app.renderer.render({
      container: stroke.stampBuffer,
      target: stroke.strokeRt,
      clear: false,
    });
    stroke.stampBuffer.removeChildren().forEach(c => c.destroy({ children: true }));
    // Trigger a stage render now in addition to the rAF loop so the stamp
    // shows up this frame (not next).
    deps.requestRender();
  };

  /** Add one tip stamp at layer-local (lx, ly). Always rendered into the
   *  stroke RT at full opacity / normal blend; the brush's opacity and
   *  mode-specific blend are applied ONCE during the strokeRt → layerRt
   *  composite (see commit + the strokeSprite's alpha/blendMode set up in
   *  beginStroke). This decouples per-stamp accumulation (which would
   *  stack toward opaque even at low opacity) from the visible stroke
   *  intensity (which now reads as a single uniform overlay). */
  const enqueueStamp = (lx: number, ly: number) => {
    if (!stroke) return;
    const { options, tintNum } = stroke;
    const tip = new Sprite(getBrushTipTexture(options.hardness));
    tip.anchor.set(0.5);
    tip.x = lx;
    tip.y = ly;
    tip.width = options.size;
    tip.height = options.size;
    // For erase, the strokeRt collects the shape as white pixels; the tint
    // is irrelevant since the strokeSprite uses 'erase' blend when
    // composited. For paint, the tint colors the stamp directly.
    tip.tint = options.mode === 'erase' ? 0xffffff : tintNum;
    tip.alpha = 1;
    tip.blendMode = 'normal';
    stroke.stampBuffer.addChild(tip);
  };

  const beginStroke: BrushEngine['beginStroke'] = (layerId, worldX, worldY, options) => {
    if (stroke) cancelStroke();
    const layer = readLayer(layerId);
    if (!layer) return;

    const w = Math.max(1, Math.round(layer.bounds.w));
    const h = Math.max(1, Math.round(layer.bounds.h));
    // Reuse the cached RT if its seed still matches the layer's current
    // selection and its dimensions still fit. Mismatch on selection means
    // the user clicked an older history thumb externally (stale); mismatch
    // on size means the layer was resized.
    let cache = layerRtCache.get(layerId);
    if (cache && (cache.seedHistoryId !== (layer.selectedHistoryId ?? null) || cache.w !== w || cache.h !== h)) {
      disposeCacheEntry(layerId);
      cache = undefined;
    }
    const cacheHit = !!cache;
    const layerRt = cache?.rt ?? RenderTexture.create({ width: w, height: h });
    if (!cache) {
      cache = { rt: layerRt, seedHistoryId: layer.selectedHistoryId ?? null, w, h };
      layerRtCache.set(layerId, cache);
    }

    // Per-stroke buffer — stamps accumulate here at full opacity, and the
    // brush's opacity is applied once when this buffer is composited onto
    // the layer (via strokeSprite.alpha for display and a single render
    // pass for commit). Discarded on stroke teardown.
    const strokeRt = RenderTexture.create({ width: w, height: h });

    // Display = layer pixels with stroke buffer composited on top at brush
    // opacity / configured blend. Two Sprites in a Container so pixi
    // composites them naturally each frame without needing a third RT.
    const layerSprite = new Sprite(layerRt);
    layerSprite.anchor.set(0.5);
    layerSprite.position.set(w / 2, h / 2);
    layerSprite.width = w;
    layerSprite.height = h;

    const strokeSprite = new Sprite(strokeRt);
    strokeSprite.anchor.set(0.5);
    strokeSprite.position.set(w / 2, h / 2);
    strokeSprite.width = w;
    strokeSprite.height = h;
    strokeSprite.alpha = options.opacity;
    strokeSprite.blendMode = options.mode === 'erase' ? 'erase' : 'normal';

    const displayContainer = new Container();
    displayContainer.position.set(layer.bounds.x, layer.bounds.y);
    displayContainer.zIndex = layer.zIndex;
    displayContainer.addChild(layerSprite);
    displayContainer.addChild(strokeSprite);
    deps.spritesGfx.addChild(displayContainer);
    deps.hideLayerSprite(layerId);

    const stampBuffer = new Container();
    stampBuffer.sortableChildren = false;

    stroke = {
      layerId,
      layer,
      layerRt,
      strokeRt,
      displayContainer,
      strokeSprite,
      stampBuffer,
      options,
      lastX: worldX - layer.bounds.x,
      lastY: worldY - layer.bounds.y,
      carry: 0,
      tintNum: hexToTintNum(options.color),
      seedReady: false,
      rafId: 0,
    };

    // Drive a per-frame stage render for the duration of the stroke.
    // Required because pixi's autoStart:false means the stage doesn't
    // repaint on its own when we update the RT contents from a pointer
    // handler. Cheap (just a renderer.render() per frame).
    const tick = () => {
      if (!stroke) return;
      deps.requestRender();
      stroke.rafId = requestAnimationFrame(tick);
    };
    stroke.rafId = requestAnimationFrame(tick);

    // Enqueue the first stamp immediately so a single click leaves a mark
    // even without movement. The flush is held off by `seedReady` until
    // the seed render below completes, so this stamp won't get covered.
    enqueueStamp(stroke.lastX, stroke.lastY);

    if (cacheHit) {
      // RT already has the correct pixels from prior strokes in this
      // session. No seed needed — just unblock the flush.
      stroke.seedReady = true;
      flushStampBuffer();
    } else {
      // Seed the RT from the layer's current pixels BEFORE flushing any
      // stamps. Awaiting (rather than fire-and-forget with clear:true)
      // keeps us off the renderer-background-color path that would bleed
      // through alpha gaps as a dark halo at brush edges.
      void (async () => {
        const tex = await deps.getSelectedTexture(layer);
        if (!stroke || stroke.layerId !== layerId) return;
        if (tex) {
          const seedSprite = new Sprite(tex);
          seedSprite.width = w;
          seedSprite.height = h;
          deps.app.renderer.render({
            container: seedSprite,
            target: stroke.layerRt,
            clear: false,
          });
          seedSprite.destroy();
        }
        stroke.seedReady = true;
        flushStampBuffer();
      })();
    }
  };

  const continueStroke: BrushEngine['continueStroke'] = (worldX, worldY) => {
    if (!stroke) return;
    const lx = worldX - stroke.layer.bounds.x;
    const ly = worldY - stroke.layer.bounds.y;
    const dx = lx - stroke.lastX;
    const dy = ly - stroke.lastY;
    const segLen = Math.hypot(dx, dy);
    if (segLen <= 0) return;
    const stepLen = Math.max(0.5, stroke.options.size * stroke.options.spacing);
    const ux = dx / segLen;
    const uy = dy / segLen;
    // Total distance available = leftover from previous events + this seg.
    // `carry` represents distance covered along this stroke since the last
    // stamp landed. We place stamps every stepLen along the cumulative
    // path; whatever's left after the last stamp this event becomes the
    // new carry so spacing stays even across slow movement (where each
    // pointermove segment can be smaller than stepLen).
    let pending = stroke.carry + segLen;
    let placed = 0;
    while (pending >= stepLen) {
      pending -= stepLen;
      placed += stepLen;
      // Distance from the segment start where this stamp lands. = total
      // distance covered minus the leftover carry. carry could exceed
      // segLen here only if the segment was tiny and carry was already
      // close to a full step — in that case clamp to the segment end.
      const segDist = Math.min(segLen, placed - stroke.carry);
      enqueueStamp(stroke.lastX + ux * segDist, stroke.lastY + uy * segDist);
    }
    stroke.carry = pending;
    stroke.lastX = lx;
    stroke.lastY = ly;
    flushStampBuffer();
  };

  const commitToLayer = async (): Promise<void> => {
    if (!stroke) return;
    const { layerId, layerRt, strokeRt, options } = stroke;
    const w = layerRt.width;
    const h = layerRt.height;
    // Composite the stroke buffer onto the layer RT once, at the brush's
    // opacity + blend mode.
    //
    // CRITICAL: the blitter must be a CHILD of a wrapper container, NOT the
    // top-level container passed to renderer.render. Pixi calls
    // enableRenderGroup() on whatever container you pass, making it the RG
    // root. RG roots skip `updateColorBlendVisibility` during the per-frame
    // update — so their `groupBlendMode` stays at the constructor default
    // `'normal'`. And `BatchableSprite.blendMode` reads from
    // `renderable.groupBlendMode`, not `localBlendMode`. Result: a
    // standalone sprite with `blendMode = 'erase'` renders as normal blend
    // (painting white pixels instead of erasing). Wrapping in a Container
    // fixes it: the blitter is now a child, gets the update pass, and its
    // groupBlendMode is correctly set to 'erase'.
    const wrapper = new Container();
    const blitter = new Sprite(strokeRt);
    blitter.anchor.set(0.5);
    blitter.position.set(w / 2, h / 2);
    blitter.width = w;
    blitter.height = h;
    blitter.alpha = options.opacity;
    blitter.blendMode = options.mode === 'erase' ? 'erase' : 'normal';
    wrapper.addChild(blitter);
    deps.app.renderer.render({
      container: wrapper,
      target: layerRt,
      clear: false,
    });
    wrapper.destroy({ children: true });
    // Stroke is now baked into layerRt. Hide the on-screen strokeSprite
    // immediately so the next frame doesn't composite it again on top of
    // the already-updated layerRt — that double-compositing was visible
    // as a brief over-opacity flash during the extract/save await below.
    stroke.strokeSprite.visible = false;
    deps.requestRender();
    const rt = layerRt;
    // Extract the RT to a raw-RGBA blob (custom 'PIBR' format).
    //
    // Why not PNG: every PNG path we tried introduced visible "ghost
    // outline" artifacts at brush edges on reload. The roundtrip goes
    // RT (premultiplied) → extract.canvas (putImageData of premul bytes)
    // → canvas2d internal storage (Chrome stores premultiplied; treats
    // input as straight + multiplies AGAIN) → toBlob (un-premultiplies
    // back to "straight"). Each conversion is 8-bit rounded; the
    // composition produces ±1 byte drift per channel at brush edges. The
    // drift compounds visually because the brush has many soft-alpha
    // pixels in the edge falloff band. Saving and loading raw
    // premultiplied bytes via BufferImageSource sidesteps canvas2d and
    // makes the roundtrip byte-exact.
    //
    // Format: 4-byte magic 'PIBR' | uint32 width LE | uint32 height LE |
    //         RGBA bytes (premultiplied). setLayerImage detects the magic
    //         and dispatches to the raw decoder; PNGs flow through the
    //         existing path for backwards compat with gen results /
    //         drop-imports.
    try {
      const { pixels, width: pw, height: ph } = deps.app.renderer.extract.pixels(rt);
      const blob: Blob | null = encodePibr(pixels, pw, ph);
      if (!blob) {
        console.warn('[brushEngine] commit: failed to encode RT to blob');
        return;
      }
      const blobId = uid();
      await canvasStorage.putBlob(blobId, blob);
      const layerNow = readLayer(layerId);
      if (!layerNow) return;
      const entry: LayerHistoryEntry = {
        id: uid(),
        layerId,
        blobId,
        positive: options.mode === 'erase' ? '[erase stroke]' : '[paint stroke]',
        negative: '',
        seed: 0,
        model: '',
        serverId: '',
        width: Math.round(layerNow.bounds.w),
        height: Math.round(layerNow.bounds.h),
        at: Date.now(),
      };
      await canvasStorage.appendLayerHistory(layerId, entry);
      // Update the RT cache's seed marker so the next stroke recognises
      // the RT as matching the (new) selectedHistoryId and reuses it
      // instead of re-seeding via PNG roundtrip.
      const c = layerRtCache.get(layerId);
      if (c) c.seedHistoryId = entry.id;
      // Pre-acknowledge the React hydrate effect for this entry so it
      // doesn't reload the just-saved PNG and overwrite the clean RT-
      // backed texture with a quality-degraded one. The PNG still exists
      // in IDB and will be loaded when the user navigates history later.
      deps.markHistoryLoaded(layerId, entry.id);
      useCanvasStore.getState().updateCanvasLayer(layerId, { selectedHistoryId: entry.id });
    } catch (err) {
      console.warn('[brushEngine] commit failed', err);
    }
  };

  const teardownActiveStroke = (committed: boolean) => {
    if (!stroke) return;
    const { layerId, layerRt } = stroke;
    if (stroke.rafId) cancelAnimationFrame(stroke.rafId);
    stroke.stampBuffer.destroy({ children: true });
    // displayContainer owns layerSprite + strokeSprite; destroying it
    // removes both from the scene. layerRt is OWNED by layerRtCache (lives
    // across strokes); strokeRt is per-stroke and gets destroyed here.
    stroke.displayContainer.destroy({ children: true });
    stroke.strokeRt.destroy(true);
    // If we committed, point the layer's normal sprite at layerRt so it
    // keeps showing the just-committed pixels without waiting for the
    // async React-side PNG reload. The PNG reload will swap the texture
    // again later — identical pixels, so no visible change.
    if (committed) deps.setLayerSpriteTexture(layerId, layerRt);
    deps.restoreLayerSprite(layerId);
    stroke = null;
    deps.requestRender();
  };

  const endStroke: BrushEngine['endStroke'] = async () => {
    if (!stroke) return;
    flushStampBuffer();
    await commitToLayer();
    teardownActiveStroke(true);
  };

  const cancelStroke: BrushEngine['cancelStroke'] = () => {
    teardownActiveStroke(false);
  };

  const isStrokeActive = () => stroke !== null;

  const dispose = () => {
    if (stroke) cancelStroke();
    for (const id of [...layerRtCache.keys()]) disposeCacheEntry(id);
  };

  return {
    beginStroke,
    continueStroke,
    endStroke,
    cancelStroke,
    isStrokeActive,
    dispose,
  };
}
