import { Application, Container, Graphics, Rectangle, RenderTexture, Sprite, Texture, BufferImageSource } from 'pixi.js';
import { THROW_MIN_DISTANCE, createVelocityTracker } from './momentum';
import { createBrushEngine, type BrushEngine } from './brush/brushEngine';
import { isPibrBlob, decodePibr } from './brush/pibr';

export type CanvasController = {
  /** Load and display an HTTP URL (used for final images from ComfyUI). */
  loadHttpUrl(url: string, onDone?: (ok: boolean) => void): void;
  /** Reset pan + zoom to identity. */
  resetView(): void;
  /** Fit the canvas viewport to its most useful content: the union AABB of
   *  every visible canvas layer's bounds. Falls back to the legacy image or
   *  centered origin if no layers are present. `topOffset` reserves vertical
   *  space for the floating top toolbar. */
  fitToViewport(topOffset?: number): void;
  /** Fit the viewport to a single layer's bounds — used by auto-frame on
   *  layer-targeted generation completion so the freshly-finished layer
   *  snaps into view. */
  fitLayerToViewport(layerId: string, topOffset?: number): void;
  /** True when the user hasn't panned/zoomed away from the default view. */
  isDefaultView(): boolean;
  /** Pixi handles repaints automatically; kept on the interface for caller compat. */
  requestRender(): void;
  /** Stamp an image into a specific canvas layer. blobUrl/null → null clears
   *  the layer's image (back to dashed bounds only). Caller owns blob lifetime
   *  outside this call (we keep our own reference until the next swap).
   *
   *  `blobId` — optional reference back to a persistent blob in
   *  CanvasStorage. When supplied, the controller can re-fetch the blob
   *  via `opts.fetchBlob` after evicting the GPU texture (viewport-based
   *  eviction, #27). Omit for ephemeral URLs that aren't worth restoring
   *  — live WS preview frames, captured composites, etc. */
  setLayerImage(
    layerId: string,
    url: string | null,
    blobId?: string | null,
    /** Fractional crop rect on the loaded image (0..1). When set, only this
     *  sub-rectangle is uploaded as the sprite's texture — useful for inpaint
     *  preview frames where ComfyUI returns the wider context image but only
     *  a sub-region belongs on the layer. */
    crop?: { fx: number; fy: number; fw: number; fh: number } | null,
  ): void;
  /** Late-binding companion to setLayerImage — tag an existing cache entry
   *  with its persistent blob id without touching the loaded texture. Used
   *  by the gen-completion flow where the URL is known immediately but the
   *  persistent blob id only resolves after the async stamp-to-storage
   *  completes. Without this tag, the viewport-eviction system (#27) leaves
   *  the texture alone (can't restore what it can't refetch). */
  setLayerBlobId(layerId: string, blobId: string | null): void;
  /** Render the visible composite of every layer beneath the given layer,
   *  clipped to that layer's bounds, at the layer's pixel resolution. Used
   *  for From-canvas layer types to feed the composited area as the input
   *  image to an img2img / inpaint generation. Background config on the
   *  active layer (transparent / solid / image) controls what fills the
   *  un-covered area. Returns null if the layer isn't found / bounds are
   *  empty / extract fails. */
  captureBoundsComposite(
    layerId: string,
    opts?: {
      /** Include the target layer's own sprite in the composite. */
      includeTarget?: boolean;
      /** Include visible layers ABOVE the target (zIndex > target). */
      includeAbove?: boolean;
    },
  ): Promise<Blob | null>;
  /** Inpaint-oriented capture: returns the wider context image (union of the
   *  target layer's bounds and every visible layer overlapping it, with a
   *  64px padding floor) plus a same-size mask (white inside the target's
   *  bounds, black elsewhere) and the world-coord rect of the context. The
   *  caller uploads both to ComfyUI and feeds them into an inpaint graph;
   *  context lets the model blend with the surrounding pixels, mask scopes
   *  the change to the layer's own region. Returns null on extract failure.
   *
   *  `attachedImageUrl` — when the target layer has committed attached
   *  pixels (img2img source-of-truth, distinct from any uncommitted
   *  candidate the live sprite may currently be showing), pass the URL
   *  here so they're rendered into the composite at the target's bounds.
   *  Null/undefined → target is excluded entirely, model sees only what's
   *  under it (current "empty layer" behavior). */
  captureContextAndMask(layerId: string, padding?: number, attachedImageUrl?: string | null, opts?: {
    /** When true, the mask cuts out every other visible layer that
     *  intersects the target — only the parts of the target's bounds with
     *  no overlapping neighbour stay white. Useful when extending a layer
     *  past existing content: the model fills only the new empty area
     *  while the existing pixels are preserved. */
    invertMask?: boolean;
  }): Promise<{
    composite: Blob;
    mask: Blob;
    contextBounds: { x: number; y: number; w: number; h: number };
  } | null>;
  /** Convert a client (screen) coordinate to canvas world coords. Used by
   *  drag-and-drop handlers to translate drop points into bounds positions. */
  clientToWorld(clientX: number, clientY: number): { x: number; y: number };
  /** Convert a world coord to a pixel position **relative to the canvas
   *  container's top-left** (NOT the viewport). Designed for DOM overlays
   *  rendered as children of the container — they can drop the result
   *  straight into `style.left` / `style.top` without subtracting the
   *  container's bounding rect first. Returns null if the controller
   *  hasn't sized yet. */
  worldToContainer(x: number, y: number): { x: number; y: number } | null;
  /** Tear down listeners, the Pixi Application, ticker, and any object URLs. */
  dispose(): void;
  /** Subscribe to default-view ↔ panned/zoomed transitions. Returns unsubscribe. */
  onViewChange(cb: (defaultView: boolean) => void): () => void;
  /** Current zoom (world → screen scale). Used by the brush-cursor overlay
   *  to size itself in screen pixels as the user pans/zooms. */
  getZoom(): number;
  /** Sample the composited backbuffer pixel at the given client (window)
   *  coordinates. Returns the RGB hex string (`'#rrggbb'`) or null if the
   *  read fails / the point is outside the canvas. Used by the eyedropper
   *  tool to pick a color from whatever is currently visible. */
  sampleColorAt(clientX: number, clientY: number): string | null;
};

/** Minimal layer shape the controller needs to render bounds. Avoids importing
 *  the full CanvasLayer type so the controller stays a leaf module. */
export type CanvasLayerView = {
  id: string;
  /** Layer kind. Read by the From-canvas outside-dim overlay; ignored for
   *  bounds + sprite rendering. */
  type?: 'empty' | 'from-canvas' | 'from-image';
  bounds: { x: number; y: number; w: number; h: number };
  visible: boolean;
  locked: boolean;
  zIndex: number;
  /** Optional — when set + the controller's `getMasksVisible()` returns
   *  true, the controller draws the mask as a red overlay on top of this
   *  layer's image. The blob is resolved via `opts.fetchBlob`. */
  paintedMaskBlobId?: string;
  /** Optional — only read by captureBoundsComposite. */
  background?:
    | { kind: 'transparent' }
    | { kind: 'solid'; color: string }
    | { kind: 'image'; blobId: string };
};

type Options = {
  getNavOffset: () => number;
  /** Global grid step in world units (64-pixel multiples). Read on every grid
   *  redraw so changes via [ / ] update the canvas without recreating the
   *  controller. Optional — defaults to 64 for legacy callers. */
  getGridStep?: () => number;
  /** Snap-to-grid flag — currently read by bounds-drag handlers (added in a
   *  later step of #24); the grid render itself doesn't change based on snap. */
  getSnapEnabled?: () => boolean;
  /** Pixel width of the left side panel when open (else 0). Used by fit-to-
   *  view math so fitted content lands in the visible canvas area, not
   *  underneath an open overlay panel. */
  getLeftInset?: () => number;
  /** Pixel width of the right side panel when open (else 0). Same role. */
  getRightInset?: () => number;
  /** Live snapshot of the canvas layers. The controller diffs against its
   *  scene-graph cache on each requestRender; per-layer Pixi objects are
   *  reused across renders, only created/destroyed when ids change. */
  getLayers?: () => CanvasLayerView[];
  /** Id of the active layer — used to choose the brighter outline + resize
   *  handle treatment. Null = no layer focused. */
  getActiveLayerId?: () => string | null;
  /** Activate a layer (clicked on canvas). Pass null to deselect. */
  setActiveLayer?: (id: string | null) => void;
  /** Update one layer's bounds. Called per pointer-move during drag/resize. */
  setLayerBounds?: (id: string, bounds: { x: number; y: number; w: number; h: number }) => void;
  onImageActivate?: () => void;
  /** Resolve a CanvasStorage blob by id. Used by the viewport-eviction
   *  system (#27) to restore a layer's texture after it's been evicted
   *  while off-screen. Optional — without it, eviction is disabled and
   *  GPU memory grows unbounded with the number of stamped layers. */
  fetchBlob?: (blobId: string) => Promise<Blob | null>;
  /** When true, draw painted masks as a red overlay on top of layers that
   *  have a `paintedMaskBlobId`. Off by default; toggled from the top-toolbar
   *  visibility button. */
  getMasksVisible?: () => boolean;
  /** Read the current rectangular selection (Select tool). Null = none. */
  getActiveSelection?: () => { layerId: string; x: number; y: number; w: number; h: number } | null;
  /** Per-layer mask dilation in pixels (the workflow's `inpaintMaskExpand`).
   *  The mask overlay grows outward by this amount in the canvas preview to
   *  visualise what the inpaint pipeline will receive. */
  getLayerMaskExpand?: (layerId: string) => number;
  /** Write the rectangular selection. Called by the Select tool's pointer
   *  handlers as the user drags. */
  setActiveSelection?: (sel: { layerId: string; x: number; y: number; w: number; h: number } | null) => void;
  /** Currently-active infinite-canvas tool id (e.g. 'move'). Used by the
   *  pointer-handler dispatch to pick tool-specific behavior. #42. */
  getActiveTool?: () => string;
  /** Force-switch the active tool. Used by the middle-click "temp pan"
   *  flow which flips to Move for the drag duration then restores. */
  setActiveTool?: (id: string) => void;
  /** Brush engine signals: "this layer's selectedHistoryId is already
   *  visible on its sprite, don't re-fetch the PNG." InfiniteCanvas's
   *  rehydrate effect honors this so the engine can keep the live RT
   *  showing without the round-tripped PNG (which loses precision at
   *  soft brush edges) overwriting it. */
  markHistoryLoaded?: (layerId: string, historyId: string) => void;
  /** Eyedropper click — color is `'#rrggbb'`. Callback wires this back to
   *  the brush settings store (color picker / brush.color). */
  onEyedropperPick?: (color: string) => void;
  /** Snapshot the brush/erase settings at the start of a stroke. Live
   *  changes mid-stroke are ignored by design — the engine takes one
   *  options block in beginStroke and uses it for the duration. */
  getBrushSettings?: () => {
    size: number;
    hardness: number;
    opacity: number;
    spacing: number;
    color: string;
  };
  /** Update brush settings live — driven by the Alt+RMB drag handler in
   *  the controller. The callback merges the patch into the brush store
   *  and the floating BrushCursor re-reads on the next tick. */
  setBrushSettings?: (patch: { size?: number; hardness?: number }) => void;
};

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type BoundsDrag =
  | { kind: 'move'; layerId: string; startBounds: { x: number; y: number; w: number; h: number }; startWorld: { x: number; y: number } }
  | { kind: 'resize'; layerId: string; handle: ResizeHandle; startBounds: { x: number; y: number; w: number; h: number }; startWorld: { x: number; y: number } };

const HANDLE_HIT_SCREEN_PX = 12; // hit area is slightly bigger than visual handle for forgiving touch

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 32;
const THROW_MIN_VELOCITY = 0.08;
const PAD = 24;
const GRID_FALLBACK = 64;

/**
 * STEP 4 (incremental Pixi migration): pan + zoom + pinch + momentum.
 *
 * The world Container's transform IS the view: pan translates
 * `world.position`, zoom scales `world.scale`. The image Sprite is placed at
 * world (0,0) at its natural size and never touched on pan/zoom — only the
 * camera moves. With autoStart:false, the Pixi ticker is dormant by default
 * and only subscribed during pan-momentum decay. No per-frame work happens
 * on a static page.
 *
 * Still missing (deliberate): grid lines, multi-server preview grid, size
 * label, window-resize handling.
 */
export function createCanvasController(
  canvas: HTMLCanvasElement,
  container: HTMLElement,
  opts: Options,
): CanvasController {
  let disposed = false;
  let app: Application | null = null;
  let brushEngine: BrushEngine | null = null;
  let viewportW = 0;
  let viewportH = 0;
  const view = { x: 0, y: 0, zoom: 1 };
  let lastDefault = true;
  const viewChangeListeners = new Set<(defaultView: boolean) => void>();

  // Opaque stage-level dark fill that always covers the entire viewport.
  // Pixi v8 by default outputs alpha=true to the canvas, so blend ops that
  // reduce alpha (e.g. erase) make backbuffer pixels see-through and the
  // DOM background bleeds in — which reads as light/peach against many
  // themes. This Graphics covers the canvas first each frame, guaranteeing
  // erased / transparent areas show the canvas's own dark color regardless
  // of theme / DOM layout. Resized in lockstep with the renderer.
  const bgFill = new Graphics();
  const redrawBgFill = () => {
    bgFill.clear();
    bgFill.rect(0, 0, viewportW, viewportH).fill({ color: 0x070a10, alpha: 1 });
  };

  const world = new Container();
  const gridGfx = new Graphics();
  const imageSprite = new Sprite();
  imageSprite.anchor.set(0.5);
  imageSprite.visible = false;
  const spritesGfx = new Container();
  const outlinesGfx = new Container();
  // Single dashed rectangle drawn around the union of every visible layer's
  // bounds — gives the user a calm "this is the whole canvas extent" frame
  // without N overlapping per-layer outlines crowding the view. Sits beneath
  // the per-layer outlines so the active layer's emphasized border + handles
  // render on top if they coincide.
  const unionBoundsGfx = new Graphics();
  unionBoundsGfx.zIndex = -1;
  outlinesGfx.addChild(unionBoundsGfx);
  // Selection rect drawn by the Select tool. Renders on top of every layer
  // outline so it stays visible regardless of which layer is active.
  const selectionGfx = new Graphics();
  selectionGfx.zIndex = 2_000_000;
  outlinesGfx.addChild(selectionGfx);
  // Grid sits behind. Order in world: grid → legacy image → layer sprites
  // → layer outlines/handles.
  world.addChild(gridGfx);
  world.addChild(imageSprite);
  world.addChild(spritesGfx);
  world.addChild(outlinesGfx);

  let imageTexture: Texture | null = null;
  let activeBlobUrl: string | null = null;
  let imageGen = 0;

  const isDefaultView = () =>
    Math.abs(view.x) < 0.5 && Math.abs(view.y) < 0.5 && Math.abs(view.zoom - 1) < 0.005;

  const paintIfReady = () => {
    if (!app || disposed) return;
    app.renderer.render(app.stage);
  };

  // Grid is drawn in world coords with overscan so panning doesn't reveal
  // missing edges. Only redrawn when zoom or viewport size changes — pan
  // alone is handled by the world container's transform.
  let gridLastZoom = 0;
  let gridLastViewportW = 0;
  let gridLastViewportH = 0;
  let gridLastStep = 0;
  let gridCenterX = 0;
  let gridCenterY = 0;
  const redrawGrid = () => {
    gridGfx.clear();
    const z = view.zoom;
    if (z <= 0) return;
    const step = opts.getGridStep ? opts.getGridStep() : GRID_FALLBACK;
    // Overscan = 3× viewport in each direction so the user can pan freely
    // around the origin without ever seeing the edge of the grid.
    const OVERSCAN = 3;
    const worldL = gridCenterX - (viewportW / 2 / z) * OVERSCAN;
    const worldR = gridCenterX + (viewportW / 2 / z) * OVERSCAN;
    const worldT = gridCenterY - (viewportH / 2 / z) * OVERSCAN;
    const worldB = gridCenterY + (viewportH / 2 / z) * OVERSCAN;
    const stepScreen = step * z;
    const minorAlpha = Math.min(0.10, Math.max(0, (stepScreen - 4) / 40));
    const majorAlpha = Math.min(0.20, Math.max(0.05, (stepScreen * 8 - 4) / 80));
    const lineW = 1 / z; // Constant 1-screen-pixel lines regardless of zoom.
    const drawLines = (mod: number, alpha: number) => {
      if (alpha <= 0) return;
      const sub = step * mod;
      const startX = Math.ceil(worldL / sub) * sub;
      const endX = Math.floor(worldR / sub) * sub;
      const startY = Math.ceil(worldT / sub) * sub;
      const endY = Math.floor(worldB / sub) * sub;
      for (let wx = startX; wx <= endX; wx += sub) {
        gridGfx.moveTo(wx, worldT).lineTo(wx, worldB);
      }
      for (let wy = startY; wy <= endY; wy += sub) {
        gridGfx.moveTo(worldL, wy).lineTo(worldR, wy);
      }
      gridGfx.stroke({ width: lineW, color: 0xffffff, alpha });
    };
    drawLines(1, minorAlpha);
    drawLines(8, majorAlpha);
    // Origin axes — subtle blue, helps with reorientation.
    gridGfx
      .moveTo(0, worldT).lineTo(0, worldB)
      .moveTo(worldL, 0).lineTo(worldR, 0)
      .stroke({ width: lineW, color: 0x4f8aff, alpha: 0.28 });
  };

  const ensureGrid = () => {
    // Trigger redraw on zoom change, viewport size change, grid step change,
    // OR when the user has panned more than 1 viewport-width away from the
    // last grid center (we'd be about to hit the overscan edge).
    const currentStep = opts.getGridStep ? opts.getGridStep() : GRID_FALLBACK;
    const driftX = Math.abs(view.x - gridCenterX) * view.zoom;
    const driftY = Math.abs(view.y - gridCenterY) * view.zoom;
    if (
      gridLastZoom !== view.zoom ||
      gridLastViewportW !== viewportW ||
      gridLastViewportH !== viewportH ||
      gridLastStep !== currentStep ||
      driftX > viewportW ||
      driftY > viewportH
    ) {
      gridLastZoom = view.zoom;
      gridLastViewportW = viewportW;
      gridLastViewportH = viewportH;
      gridLastStep = currentStep;
      gridCenterX = view.x;
      gridCenterY = view.y;
      redrawGrid();
    }
  };

  // ---- Layer bounds overlay -----------------------------------------------
  // One Graphics (outline + handles when active) + an optional Sprite (the
  // stamped image) per layer, allocated lazily and reused across syncs.
  // Removed only when its layer id disappears.
  type LayerGfx = {
    /** Outline / handles overlay. Always present. */
    gfx: Graphics;
    /** Image sprite, present only when the layer has an image set via
     *  setLayerImage. Sized + positioned from the layer's bounds in syncLayers. */
    sprite: Sprite | null;
    /** Texture owned by this layer entry (destroyed on swap/remove). */
    texture: Texture | null;
    /** Tracks the source URL so we can revoke ObjectURLs on swap. */
    sourceUrl: string | null;
    /** Persistent blob id — survives texture eviction (#27). Set when a
     *  setLayerImage call tags the image with its storage-side id. When
     *  the layer scrolls off-screen we destroy the texture but keep this
     *  so we can re-fetch from CanvasStorage on re-entry. */
    blobId: string | null;
    /** Reload-in-flight guard so a fast pan through off-screen → on-screen
     *  → off-screen → on-screen doesn't fire duplicate fetchBlob calls. */
    loading: boolean;
    /** Monotonic generation incremented on each setLayerImage call. The
     *  async onload checks this against its captured gen to discard stale
     *  loads — critical when preview frames arrive at 60Hz. */
    gen: number;
    lastBoundsKey: string;
    lastActive: boolean;
    lastZoom: number;
    /** Mask overlay sprite — red-tinted, half-alpha. Created on demand by
     *  syncLayers when the layer has a paintedMaskBlobId AND masks are
     *  toggled visible. Destroyed when either condition flips off. */
    maskSprite: Sprite | null;
    maskTexture: Texture | null;
    maskUrl: string | null;
    /** The blob id the mask sprite was loaded from — used as the cache key
     *  so swapping the layer's painted mask triggers a re-fetch. */
    maskBlobId: string | null;
    maskLoading: boolean;
  };
  const layerCache = new Map<string, LayerGfx>();
  let layersLastSig = '';

  /** Get-or-create the cache entry for a layer id. The Graphics is parented
   *  immediately; the Sprite is created on demand by setLayerImage. */
  const ensureLayerEntry = (id: string): LayerGfx => {
    let entry = layerCache.get(id);
    if (!entry) {
      const gfx = new Graphics();
      outlinesGfx.addChild(gfx);
      entry = {
        gfx, sprite: null, texture: null, sourceUrl: null,
        blobId: null, loading: false, gen: 0,
        lastBoundsKey: '', lastActive: false, lastZoom: 0,
        maskSprite: null, maskTexture: null, maskUrl: null,
        maskBlobId: null, maskLoading: false,
      };
      layerCache.set(id, entry);
    }
    return entry;
  };

  const disposeLayerEntry = (entry: LayerGfx) => {
    entry.gfx.destroy();
    if (entry.sprite) entry.sprite.destroy();
    if (entry.texture && entry.texture !== Texture.EMPTY) entry.texture.destroy(true);
    if (entry.sourceUrl?.startsWith('blob:')) URL.revokeObjectURL(entry.sourceUrl);
    disposeMaskEntry(entry);
  };

  /** Tear down just the mask overlay for a layer entry. Leaves the main
   *  sprite + outline intact. Used both when the layer is removed and when
   *  the user clears the painted mask / toggles mask visibility off. */
  const disposeMaskEntry = (entry: LayerGfx) => {
    if (entry.maskSprite) { entry.maskSprite.destroy(); entry.maskSprite = null; }
    if (entry.maskTexture && entry.maskTexture !== Texture.EMPTY) entry.maskTexture.destroy(true);
    entry.maskTexture = null;
    if (entry.maskUrl?.startsWith('blob:')) URL.revokeObjectURL(entry.maskUrl);
    entry.maskUrl = null;
    entry.maskBlobId = null;
    entry.maskLoading = false;
  };

  // Shared dashed-segment helper: lays down N straight segments along a line
  // with dash + gap measured in WORLD units (precomputed by the caller so
  // both per-layer bounds and the union-bounds rect render dashes at the same
  // screen-px size at any zoom).
  const dashedSegment = (
    g: Graphics,
    x0: number, y0: number, x1: number, y1: number,
    dashWorld: number, gapWorld: number,
  ) => {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len <= 0) return;
    const ux = dx / len, uy = dy / len;
    const stride = dashWorld + gapWorld;
    for (let s = 0; s < len; s += stride) {
      const a = Math.min(s + dashWorld, len);
      g.moveTo(x0 + ux * s, y0 + uy * s).lineTo(x0 + ux * a, y0 + uy * a);
    }
  };

  const drawLayerBounds = (
    g: Graphics,
    b: { x: number; y: number; w: number; h: number },
    active: boolean,
    z: number,
    _locked: boolean,
  ) => {
    g.clear();
    // Non-active layers render no border at all — the union-bounds rect
    // (drawn elsewhere) frames the whole canvas extent; per-layer outlines
    // are reserved for the selected layer so the canvas reads quietly when
    // many layers are present.
    if (!active) return;
    const lineW = 1 / z;
    const dashScreen = 6;
    const dashWorld = dashScreen / z;
    const gapWorld = dashWorld;
    const { x, y, w, h } = b;
    dashedSegment(g, x,     y,     x + w, y,     dashWorld, gapWorld);
    dashedSegment(g, x + w, y,     x + w, y + h, dashWorld, gapWorld);
    dashedSegment(g, x + w, y + h, x,     y + h, dashWorld, gapWorld);
    dashedSegment(g, x,     y + h, x,     y,     dashWorld, gapWorld);
    g.stroke({ width: lineW * 1.5, color: 0x4f8aff, alpha: 0.9 });

    {
      // 8 handles at corners + edge midpoints. Filled squares, screen-constant size.
      const hs = 8 / z;
      const half = hs / 2;
      const handles: Array<[number, number]> = [
        [x,         y        ], [x + w / 2, y        ], [x + w,     y        ],
        [x,         y + h / 2],                           [x + w,     y + h / 2],
        [x,         y + h    ], [x + w / 2, y + h    ], [x + w,     y + h    ],
      ];
      for (const [hx, hy] of handles) {
        g.rect(hx - half, hy - half, hs, hs);
      }
      g.fill({ color: 0x4f8aff, alpha: 0.95 });
      g.stroke({ width: lineW, color: 0xffffff, alpha: 0.85 });
    }
  };

  const syncLayers = () => {
    const layers = opts.getLayers ? opts.getLayers() : [];
    const activeId = opts.getActiveLayerId ? opts.getActiveLayerId() : null;
    const masksVisible = opts.getMasksVisible ? opts.getMasksVisible() : false;
    const selection = opts.getActiveSelection ? opts.getActiveSelection() : null;
    const selSig = selection
      ? `${selection.layerId}|${selection.x}|${selection.y}|${selection.w}|${selection.h}`
      : '';
    // Cheap signature for early-out: id|x|y|w|h|visible|locked|zIndex|maskId|featherPx+activeId+masksVisible+zoom+selection.
    const sig = layers
      .map(l => `${l.id}|${l.bounds.x}|${l.bounds.y}|${l.bounds.w}|${l.bounds.h}|${l.visible ? 1 : 0}|${l.locked ? 1 : 0}|${l.zIndex}|${l.paintedMaskBlobId ?? ''}|${opts.getLayerMaskExpand?.(l.id) ?? 0}`)
      .join(';') + '#' + (activeId ?? '') + '@' + view.zoom + '@m' + (masksVisible ? 1 : 0) + '@s' + selSig;
    if (sig === layersLastSig) return;
    layersLastSig = sig;

    // Reconcile cache: drop removed, upsert current.
    const seen = new Set<string>();
    for (const l of layers) {
      seen.add(l.id);
      const entry = ensureLayerEntry(l.id);
      const isActive = l.id === activeId;
      const boundsKey = `${l.bounds.x}|${l.bounds.y}|${l.bounds.w}|${l.bounds.h}|${l.locked ? 1 : 0}`;
      // Redraw only if bounds, active state, or zoom (for screen-constant
      // line widths and dash sizes) actually changed.
      if (
        entry.lastBoundsKey !== boundsKey ||
        entry.lastActive !== isActive ||
        entry.lastZoom !== view.zoom
      ) {
        drawLayerBounds(entry.gfx, l.bounds, isActive, view.zoom, l.locked);
        entry.lastBoundsKey = boundsKey;
        entry.lastActive = isActive;
        entry.lastZoom = view.zoom;
      }
      entry.gfx.visible = l.visible;
      // Position the stamped image (if any) at the layer's bounds.
      if (entry.sprite) {
        entry.sprite.visible = l.visible;
        entry.sprite.position.set(l.bounds.x + l.bounds.w / 2, l.bounds.y + l.bounds.h / 2);
        entry.sprite.width = l.bounds.w;
        entry.sprite.height = l.bounds.h;
        // Sprite draws under its outline so the dashed bounds + handles stay
        // visible on top of the image.
        entry.sprite.zIndex = l.zIndex;
      }
      // zIndex inside outlinesGfx — active layer's handles + outline render
      // on top of every sibling's outline.
      entry.gfx.zIndex = l.zIndex + (isActive ? 1000000 : 0);

      // ---- Mask overlay ----------------------------------------------------
      // Render the painted mask as a red-tinted half-alpha sprite on top of
      // the layer's image. Off by default; toggled via getMasksVisible(). The
      // mask sprite is laid out exactly like the main sprite so it tracks
      // bounds changes for free.
      const wantsMask = !!l.paintedMaskBlobId && masksVisible && l.visible;
      const maskId = wantsMask ? (l.paintedMaskBlobId ?? null) : null;
      if (!wantsMask) {
        if (entry.maskSprite || entry.maskTexture) disposeMaskEntry(entry);
      } else if (maskId !== entry.maskBlobId) {
        // Mask blob id changed (newly set, replaced, or cleared+re-set). Drop
        // any existing mask and lazy-fetch the new one. fetchBlob is optional
        // — without it we can't render the mask, so log + skip.
        disposeMaskEntry(entry);
        entry.maskBlobId = maskId;
        if (opts.fetchBlob && maskId) {
          entry.maskLoading = true;
          const targetId = maskId;
          const layerId = l.id;
          opts.fetchBlob(targetId).then(async blob => {
            // Late check — the entry may have been disposed or its mask
            // swapped while we were awaiting.
            const live = layerCache.get(layerId);
            if (!live || live.maskBlobId !== targetId) return;
            if (!blob) { live.maskLoading = false; return; }
            const url = URL.createObjectURL(blob);
            try {
              const img = await new Promise<HTMLImageElement>((resolve, reject) => {
                const el = new Image();
                el.onload = () => resolve(el);
                el.onerror = () => reject(new Error('mask decode failed'));
                el.src = url;
              });
              const stillLive = layerCache.get(layerId);
              if (!stillLive || stillLive.maskBlobId !== targetId) {
                URL.revokeObjectURL(url);
                return;
              }
              const texture = Texture.from(img);
              const sprite = new Sprite(texture);
              sprite.anchor.set(0.5);
              sprite.tint = 0xff3030;
              sprite.alpha = 0.5;
              // Position + size immediately from the LIVE layer (not the
              // captured `l` from when the fetch started — the layer may
              // have moved or resized while the blob was downloading).
              // Without this the sprite renders at world (0, 0) for one
              // frame, then snaps into place on the next sync pass — the
              // "wrong position then jumps" symptom users see when
              // toggling masks on.
              const liveLayers = opts.getLayers ? opts.getLayers() : [];
              const liveLayer = liveLayers.find(L => L.id === layerId) ?? l;
              const expand = Math.max(0, opts.getLayerMaskExpand?.(layerId) ?? 0);
              sprite.position.set(
                liveLayer.bounds.x + liveLayer.bounds.w / 2,
                liveLayer.bounds.y + liveLayer.bounds.h / 2,
              );
              sprite.width = liveLayer.bounds.w + expand * 2;
              sprite.height = liveLayer.bounds.h + expand * 2;
              sprite.zIndex = liveLayer.zIndex + 1;
              // Layer this above the regular sprite — both live in spritesGfx
              // which has sortableChildren on.
              spritesGfx.addChild(sprite);
              stillLive.maskSprite = sprite;
              stillLive.maskTexture = texture;
              stillLive.maskUrl = url;
              stillLive.maskLoading = false;
              // Force re-layout this frame.
              layersLastSig = '';
              app?.render();
            } catch (err) {
              console.warn('[canvas] mask sprite load failed', err);
              URL.revokeObjectURL(url);
              const stillLive = layerCache.get(layerId);
              if (stillLive) stillLive.maskLoading = false;
            }
          }).catch(err => {
            console.warn('[canvas] mask fetchBlob failed', err);
            const live = layerCache.get(layerId);
            if (live) live.maskLoading = false;
          });
        }
      }
      // Re-size/position whatever mask sprite is currently mounted. The
      // feather preview used to attach a BlurFilter here, but it caused
      // visible seam artifacts on the underlying layer image at large
      // blur radii (Pixi's filter padding clipped the blurred sprite and
      // the discontinuity bled through). Feathering is handled by the
      // inpaint graph (`mask_blend_pixels`) at queue time instead — lose
      // the live preview, gain clean rendering.
      if (entry.maskSprite) {
        const expand = Math.max(0, opts.getLayerMaskExpand?.(l.id) ?? 0);
        const w = l.bounds.w + expand * 2;
        const h = l.bounds.h + expand * 2;
        entry.maskSprite.visible = wantsMask;
        entry.maskSprite.position.set(l.bounds.x + l.bounds.w / 2, l.bounds.y + l.bounds.h / 2);
        entry.maskSprite.width = w;
        entry.maskSprite.height = h;
        entry.maskSprite.zIndex = l.zIndex + 1;
      }
    }
    outlinesGfx.sortableChildren = true;
    spritesGfx.sortableChildren = true;

    // Drop entries for layers that no longer exist.
    for (const [id, entry] of layerCache) {
      if (!seen.has(id)) {
        disposeLayerEntry(entry);
        layerCache.delete(id);
      }
    }

    // Union bounds — single dashed frame around every visible layer.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let anyVisible = false;
    for (const l of layers) {
      if (!l.visible) continue;
      anyVisible = true;
      if (l.bounds.x < minX) minX = l.bounds.x;
      if (l.bounds.y < minY) minY = l.bounds.y;
      if (l.bounds.x + l.bounds.w > maxX) maxX = l.bounds.x + l.bounds.w;
      if (l.bounds.y + l.bounds.h > maxY) maxY = l.bounds.y + l.bounds.h;
    }
    unionBoundsGfx.clear();
    if (anyVisible) {
      const z = view.zoom;
      const lineW = 1 / z;
      const dashScreen = 6;
      const dashWorld = dashScreen / z;
      const gapWorld = dashWorld;
      const x = minX, y = minY, w = maxX - minX, h = maxY - minY;
      dashedSegment(unionBoundsGfx, x,     y,     x + w, y,     dashWorld, gapWorld);
      dashedSegment(unionBoundsGfx, x + w, y,     x + w, y + h, dashWorld, gapWorld);
      dashedSegment(unionBoundsGfx, x + w, y + h, x,     y + h, dashWorld, gapWorld);
      dashedSegment(unionBoundsGfx, x,     y + h, x,     y,     dashWorld, gapWorld);
      unionBoundsGfx.stroke({ width: lineW, color: 0xffffff, alpha: 0.35 });
      unionBoundsGfx.visible = true;
    } else {
      unionBoundsGfx.visible = false;
    }

    // Selection rect (Select tool). Solid amber outline + light fill so it
    // reads as a hard-edged sub-rect distinct from layer outlines.
    selectionGfx.clear();
    if (selection && selection.w > 0 && selection.h > 0) {
      const z = view.zoom;
      const lineW = 1.5 / z;
      const { x, y, w, h } = selection;
      selectionGfx.rect(x, y, w, h).fill({ color: 0xffb020, alpha: 0.12 });
      const dashScreen = 5;
      const dashWorld = dashScreen / z;
      const gapWorld = dashWorld;
      dashedSegment(selectionGfx, x,     y,     x + w, y,     dashWorld, gapWorld);
      dashedSegment(selectionGfx, x + w, y,     x + w, y + h, dashWorld, gapWorld);
      dashedSegment(selectionGfx, x + w, y + h, x,     y + h, dashWorld, gapWorld);
      dashedSegment(selectionGfx, x,     y + h, x,     y,     dashWorld, gapWorld);
      selectionGfx.stroke({ width: lineW, color: 0xffb020, alpha: 0.95 });
      selectionGfx.visible = true;
    } else {
      selectionGfx.visible = false;
    }
  };

  const syncWorld = () => {
    // World origin (0,0) renders at viewport center minus view-shift.
    world.scale.set(view.zoom);
    world.position.set(
      viewportW / 2 - view.x * view.zoom,
      viewportH / 2 - view.y * view.zoom,
    );
    ensureGrid();
    syncLayers();
    syncTextureEviction();
  };

  /** Internal implementation of `setLayerImage` — also called by the
   *  viewport-eviction restore path to rebuild a destroyed texture from a
   *  re-fetched blob. Public `setLayerImage` is a thin delegate. */
  const loadLayerImageImpl = (
    layerId: string,
    url: string | null,
    blobId: string | null,
    crop: { fx: number; fy: number; fw: number; fh: number } | null = null,
  ) => {
    const entry = ensureLayerEntry(layerId);
    if (!url) {
      // Clear path — safe to destroy eagerly because the sprite is also
      // going away in the same tick.
      if (entry.sourceUrl?.startsWith('blob:')) URL.revokeObjectURL(entry.sourceUrl);
      if (entry.sprite) { entry.sprite.destroy(); entry.sprite = null; }
      if (entry.texture && entry.texture !== Texture.EMPTY) {
        entry.texture.destroy(true);
      }
      entry.texture = null;
      entry.sourceUrl = null;
      entry.blobId = null;
      entry.loading = false;
      layersLastSig = '';
      syncWorld();
      paintIfReady();
      return;
    }

    // Persistent ref for later eviction-restore. Setting it now means
    // even if the loading <img> rejects, we know what blob this entry
    // was *meant* to display. (Live preview frames pass blobId=null so
    // they're never restored — they're ephemeral.)
    entry.blobId = blobId;
    entry.loading = false;

    // Generation counter — rapid setLayerImage calls (e.g. preview frames at
    // 60Hz) must not race their onload callbacks. Increment now; capture
    // the gen on this closure; later loads check it and bail if newer.
    entry.gen = (entry.gen ?? 0) + 1;
    const myGen = entry.gen;

    // Two load paths, dispatched by blob magic bytes:
    //   - PIBR (custom raw premultiplied format from brush commits): decode
    //     directly to a BufferImageSource. Bypasses canvas2d entirely —
    //     no Chrome internal-storage premultiplication, no toBlob roundtrip,
    //     byte-exact match with the live RT.
    //   - Anything else (PNG from gen results, drop-imported images):
    //     standard createImageBitmap → Texture.from path.
    //
    // Critical: do NOT destroy the previous texture eagerly. The sprite
    // still references it until the new texture is ready; any render that
    // fires in the gap (Pixi ticker on a sibling-redraw, etc.) would crash
    // with `texture.alphaMode` on null.
    void (async () => {
      let tex: Texture | null = null;
      try {
        const resp = await fetch(url);
        const blob = await resp.blob();
        if (await isPibrBlob(blob)) {
          const { pixels, width: pw, height: ph } = await decodePibr(blob);
          const source = new BufferImageSource({
            resource: pixels,
            width: pw,
            height: ph,
            alphaMode: 'premultiplied-alpha',
          });
          tex = new Texture({ source });
        } else {
          // When `crop` is set (inpaint preview / inpaint result), apply the
          // fractional crop via createImageBitmap's source-rect args so we
          // upload only the inset region as the sprite's texture. ComfyUI
          // returns inpaint outputs with context padding around the masked
          // sub-region; without this crop the preview frames stream the wide
          // context image (and its edge-clamp artifacts) into the layer.
          let bitmap: ImageBitmap;
          if (crop) {
            const probe = await createImageBitmap(blob);
            const sx = Math.max(0, Math.round(crop.fx * probe.width));
            const sy = Math.max(0, Math.round(crop.fy * probe.height));
            const sw = Math.max(1, Math.min(probe.width - sx, Math.round(crop.fw * probe.width)));
            const sh = Math.max(1, Math.min(probe.height - sy, Math.round(crop.fh * probe.height)));
            bitmap = await createImageBitmap(probe, sx, sy, sw, sh);
            probe.close();
          } else {
            bitmap = await createImageBitmap(blob);
          }
          tex = Texture.from(bitmap);
        }
      } catch {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
        return;
      }
      if (!tex) return;
      if (disposed) { tex.destroy(true); return; }
      const live = layerCache.get(layerId);
      if (live !== entry || entry.gen !== myGen) {
        tex.destroy(true);
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
        return;
      }
      const prevTexture = entry.texture;
      const prevSourceUrl = entry.sourceUrl;
      entry.texture = tex;
      entry.sourceUrl = url;
      if (!entry.sprite) {
        entry.sprite = new Sprite();
        entry.sprite.anchor.set(0.5);
        spritesGfx.addChild(entry.sprite);
      }
      entry.sprite.texture = tex;
      // Lock the sprite to the layer's bounds in the SAME tick the texture
      // changed. Pixi v8 Sprite stores scale + cached _width/_height; setSize
      // short-circuits when the requested width/height match the cache — but
      // scale was computed against the OLD texture's orig dims, so swapping
      // in a new texture (e.g. a 256× preview replacing a 1024× final, or a
      // 512×768 preview frame replacing a 256× one) leaves the rendered size
      // as `oldScale * newTexture.orig.dims`, which can blow up far past the
      // layer bounds. Compute scale ourselves against the new texture's orig
      // dims to bypass that cache entirely.
      const layer = opts.getLayers?.().find(l => l.id === layerId);
      if (layer && tex.orig.width > 0 && tex.orig.height > 0) {
        entry.sprite.scale.set(
          layer.bounds.w / tex.orig.width,
          layer.bounds.h / tex.orig.height,
        );
        entry.sprite.position.set(
          layer.bounds.x + layer.bounds.w / 2,
          layer.bounds.y + layer.bounds.h / 2,
        );
      }
      if (prevTexture && prevTexture !== Texture.EMPTY) prevTexture.destroy(true);
      if (prevSourceUrl && prevSourceUrl !== url && prevSourceUrl.startsWith('blob:')) {
        URL.revokeObjectURL(prevSourceUrl);
      }
      layersLastSig = '';
      syncWorld();
      paintIfReady();
    })();
  };

  // ── Texture lifecycle / viewport eviction (#27) ──────────────────────────
  // Layers whose bounds are far enough off-screen have their GPU textures
  // freed; the blob id is kept in the cache entry so re-entering the
  // viewport can restore them via opts.fetchBlob. Live preview frames and
  // captured composites (any setLayerImage call that didn't tag a blob id)
  // are skipped — they're ephemeral, can't be re-fetched from storage.
  const EVICTION_PADDING_SCREEN_PX = 200;
  let lastEvictionViewKey = '';
  const isLayerOnScreen = (bounds: { x: number; y: number; w: number; h: number }) => {
    if (viewportW <= 0 || viewportH <= 0) return true;
    const padW = EVICTION_PADDING_SCREEN_PX / view.zoom;
    const wxMin = view.x - viewportW / 2 / view.zoom - padW;
    const wxMax = view.x + viewportW / 2 / view.zoom + padW;
    const wyMin = view.y - viewportH / 2 / view.zoom - padW;
    const wyMax = view.y + viewportH / 2 / view.zoom + padW;
    return !(
      bounds.x + bounds.w < wxMin ||
      bounds.x > wxMax ||
      bounds.y + bounds.h < wyMin ||
      bounds.y > wyMax
    );
  };
  const syncTextureEviction = () => {
    if (!opts.fetchBlob) return;
    // Cheap dedupe: skip work when neither view nor viewport has changed.
    const key = `${Math.round(view.x)}|${Math.round(view.y)}|${view.zoom.toFixed(3)}|${viewportW}|${viewportH}`;
    if (key === lastEvictionViewKey) return;
    lastEvictionViewKey = key;

    const layers = opts.getLayers?.() ?? [];
    for (const l of layers) {
      const entry = layerCache.get(l.id);
      if (!entry || !entry.blobId) continue;
      const onScreen = isLayerOnScreen(l.bounds);
      if (entry.texture && !onScreen) {
        // Evict: destroy GPU texture + sprite; keep blobId for restore.
        if (entry.sprite) { entry.sprite.destroy(); entry.sprite = null; }
        if (entry.texture !== Texture.EMPTY) entry.texture.destroy(true);
        entry.texture = null;
        if (entry.sourceUrl?.startsWith('blob:')) URL.revokeObjectURL(entry.sourceUrl);
        entry.sourceUrl = null;
      } else if (!entry.texture && onScreen && !entry.loading) {
        // Restore: re-fetch from storage and rebuild the texture. Mark as
        // loading so the next syncTextureEviction tick (likely fired by
        // an in-progress pan) doesn't queue a second fetch.
        const blobId = entry.blobId;
        const layerId = l.id;
        entry.loading = true;
        opts.fetchBlob(blobId).then(blob => {
          // Re-check the cache entry — it may have been recreated /
          // mutated between fire and fulfill.
          const live = layerCache.get(layerId);
          if (!live || live.blobId !== blobId) return;
          live.loading = false;
          if (!blob || disposed) return;
          // Hand off through the shared load path so the normal swap +
          // gen-counter race protection runs. The URL is a fresh
          // ObjectURL; load impl will revoke it on next swap.
          const url = URL.createObjectURL(blob);
          loadLayerImageImpl(layerId, url, blobId);
        }).catch(err => {
          const live = layerCache.get(layerId);
          if (live) live.loading = false;
          console.warn('[canvas] eviction restore fetchBlob failed', err);
        });
      }
    }
  };

  const emitViewChange = () => {
    const def = isDefaultView();
    if (def !== lastDefault) {
      lastDefault = def;
      for (const cb of viewChangeListeners) cb(def);
    }
  };

  const setView = (x: number, y: number, zoom: number) => {
    view.x = x;
    view.y = y;
    view.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
    syncWorld();
    paintIfReady();
    emitViewChange();
  };

  const swapTexture = (next: Texture, blobUrlForRevoke: string | null) => {
    const prev = imageTexture;
    imageSprite.texture = next;
    imageTexture = next;
    if (prev && prev !== Texture.EMPTY) prev.destroy(true);
    if (activeBlobUrl && activeBlobUrl !== blobUrlForRevoke) {
      URL.revokeObjectURL(activeBlobUrl);
    }
    activeBlobUrl = blobUrlForRevoke;
    if (next.width > 0 && next.height > 0) {
      // Sprite lives at world (0,0) at its natural pixel size. The world's
      // scale handles zoom; the world's position handles pan.
      imageSprite.position.set(0, 0);
      imageSprite.width = next.width;
      imageSprite.height = next.height;
      imageSprite.visible = true;
    } else {
      imageSprite.visible = false;
    }
    fitToViewportImpl(opts.getNavOffset());
  };

  /** Fit an arbitrary world-coord rectangle into the viewport, centered in
   *  the *visible* area between any open side panels (which are overlays),
   *  with a small padding margin. topOffset reserves vertical space for the
   *  floating top toolbar so the rect doesn't hide behind it. */
  const fitRectToViewportImpl = (
    rect: { x: number; y: number; w: number; h: number },
    topOffset = 0,
  ) => {
    if (rect.w <= 0 || rect.h <= 0) return;
    const w = viewportW;
    const h = viewportH;
    if (w <= 0 || h <= 0) return;
    const leftInset = opts.getLeftInset?.() ?? 0;
    const rightInset = opts.getRightInset?.() ?? 0;
    const visibleW = Math.max(1, w - leftInset - rightInset);
    const visibleH = Math.max(1, h - topOffset);
    const usableW = Math.max(1, visibleW - PAD * 2);
    const usableH = Math.max(1, visibleH - PAD * 2);
    const z = Math.min(usableW / rect.w, usableH / rect.h);
    // World coord of the rect's center.
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    // We want the rect's center to land at the visible-area screen center,
    // not the full-viewport center. Translating that to `view.{x,y}` (which
    // setView positions at the viewport center):
    //   visibleCenterScreenX = leftInset + visibleW / 2
    //   view.x = cx - (visibleCenterScreenX - w / 2) / z
    //          = cx - (leftInset - rightInset) / 2 / z
    // Same for y with topOffset (no bottom inset today).
    const shiftX = (leftInset - rightInset) / 2 / z;
    const shiftY = -topOffset / 2 / z;
    setView(cx - shiftX, cy + shiftY, z);
  };

  /** Fit the canvas to its most useful content: the union AABB of every
   *  visible canvas layer's bounds. Falls back to the legacy image sprite if
   *  no layers are visible, else resets to default view. */
  const fitToViewportImpl = (topOffset = 0) => {
    const layers = opts.getLayers?.() ?? [];
    const visible = layers.filter(l => l.visible);
    if (visible.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const l of visible) {
        const { x, y, w, h } = l.bounds;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x + w > maxX) maxX = x + w;
        if (y + h > maxY) maxY = y + h;
      }
      fitRectToViewportImpl({ x: minX, y: minY, w: maxX - minX, h: maxY - minY }, topOffset);
      return;
    }
    if (imageTexture && imageTexture.width > 0) {
      fitRectToViewportImpl(
        { x: -imageTexture.width / 2, y: -imageTexture.height / 2, w: imageTexture.width, h: imageTexture.height },
        topOffset,
      );
      return;
    }
    setView(0, 0, 1);
  };

  // ---- Inertia (the only legitimate use of the ticker) -------------------
  const velTracker = createVelocityTracker();
  const inertia = { vx: 0, vy: 0, last: 0, active: false };
  let tickerSubscribed = false;

  const tickerCb = () => {
    if (!inertia.active) return;
    const now = performance.now();
    const dt = Math.min(40, now - inertia.last);
    inertia.last = now;
    view.x -= (inertia.vx * dt) / view.zoom;
    view.y -= (inertia.vy * dt) / view.zoom;
    const decay = Math.pow(0.94, dt / 16);
    inertia.vx *= decay;
    inertia.vy *= decay;
    if (Math.hypot(inertia.vx, inertia.vy) < 0.003) {
      stopInertia();
    }
    syncWorld();
    paintIfReady();
    emitViewChange();
  };

  const startInertia = (vx: number, vy: number) => {
    inertia.vx = vx;
    inertia.vy = vy;
    inertia.last = performance.now();
    inertia.active = true;
    if (!tickerSubscribed && app) {
      app.ticker.add(tickerCb);
      app.ticker.start();
      tickerSubscribed = true;
    }
  };

  const stopInertia = () => {
    inertia.active = false;
    if (tickerSubscribed && app) {
      app.ticker.remove(tickerCb);
      app.ticker.stop();
      tickerSubscribed = false;
    }
  };

  // ---- Pointer / wheel input ---------------------------------------------
  const pointers = new Map<number, { x: number; y: number; sx: number; sy: number }>();
  let panStart: { vx: number; vy: number } | null = null;
  let pinchStart: { d: number; z: number; vx: number; vy: number; wx: number; wy: number } | null = null;
  let boundsDrag: BoundsDrag | null = null;
  /** When set, the pointerdown landed on empty canvas with an active layer.
   *  The deselect actually fires on pointerup IF the pointer barely moved
   *  (i.e. tap, not pan). Avoids dropping the selection mid-pan. */
  let pendingDeselectOnTap = false;

  /** Convert client (screen) coords to world coords using the current view. */
  const clientToWorld = (clientX: number, clientY: number) => {
    const r = container.getBoundingClientRect();
    const sxRel = clientX - r.left;
    const syRel = clientY - r.top;
    return {
      x: (sxRel - r.width / 2) / view.zoom + view.x,
      y: (syRel - r.height / 2) / view.zoom + view.y,
    };
  };

  const worldToContainer = (wx: number, wy: number) => {
    if (viewportW <= 0 || viewportH <= 0) return null;
    return {
      x: (wx - view.x) * view.zoom + viewportW / 2,
      y: (wy - view.y) * view.zoom + viewportH / 2,
    };
  };

  /** Snap one coord to the global grid (rounded to nearest step). */
  const maybeSnap = (v: number) => {
    if (!opts.getSnapEnabled?.()) return v;
    const step = opts.getGridStep?.() ?? GRID_FALLBACK;
    return Math.round(v / step) * step;
  };

  /** Test which handle of the active layer (if any) the pointer hits. Returns
   *  null if no handle hit. Hit radius is screen-px so it stays clickable at
   *  every zoom. */
  const hitTestHandle = (worldX: number, worldY: number): { layerId: string; handle: ResizeHandle; bounds: { x: number; y: number; w: number; h: number } } | null => {
    const layers = opts.getLayers?.() ?? [];
    const activeId = opts.getActiveLayerId?.() ?? null;
    if (!activeId) return null;
    const layer = layers.find(l => l.id === activeId);
    if (!layer || !layer.visible || layer.locked) return null;
    const r = HANDLE_HIT_SCREEN_PX / view.zoom;
    const { x, y, w, h } = layer.bounds;
    const positions: Array<[ResizeHandle, number, number]> = [
      ['nw', x,         y        ],
      ['n',  x + w / 2, y        ],
      ['ne', x + w,     y        ],
      ['e',  x + w,     y + h / 2],
      ['se', x + w,     y + h    ],
      ['s',  x + w / 2, y + h    ],
      ['sw', x,         y + h    ],
      ['w',  x,         y + h / 2],
    ];
    for (const [handle, hx, hy] of positions) {
      if (Math.abs(worldX - hx) <= r && Math.abs(worldY - hy) <= r) {
        return { layerId: layer.id, handle, bounds: layer.bounds };
      }
    }
    return null;
  };

  /** Find topmost (highest zIndex) visible layer whose bounds contain the
   *  given world point. */
  const hitTestInterior = (worldX: number, worldY: number) => {
    const layers = opts.getLayers?.() ?? [];
    const visible = layers.filter(l => l.visible);
    // canvasLayers is sorted ascending by zIndex; iterate descending so the
    // topmost layer wins.
    for (let i = visible.length - 1; i >= 0; i--) {
      const { x, y, w, h } = visible[i].bounds;
      if (worldX >= x && worldX <= x + w && worldY >= y && worldY <= y + h) {
        return visible[i];
      }
    }
    return null;
  };

  const cursorForHandle = (h: ResizeHandle) => {
    switch (h) {
      case 'nw': case 'se': return 'nwse-resize';
      case 'ne': case 'sw': return 'nesw-resize';
      case 'n':  case 's':  return 'ns-resize';
      case 'e':  case 'w':  return 'ew-resize';
    }
  };

  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);

  // Middle-click "hand" panning (#42): pressing the middle mouse button
  // forces the tool to Move for the duration of the drag and restores the
  // previously-active tool on release. Skips all layer hit-testing so the
  // user can pan over anything without accidentally dragging a layer.
  let middlePan: { pointerId: number; previousTool: string | null } | null = null;

  // Eyedropper drag state. Set on pointer-down in eyedropper mode so
  // pointer-move can keep sampling while the user drags. Cleared on
  // pointer-up. Throttled to ~60Hz via lastSampleAt — reading from the
  // GPU framebuffer triggers a sync stall, and faster than ~16ms gives
  // no perceptible benefit.
  let eyedropperDrag: { pointerId: number; lastSampleAt: number } | null = null;
  // Photoshop-style brush adjust: hold Alt + right-mouse-button and drag.
  //   - Horizontal drag → brush size (right = bigger).
  //   - Vertical drag   → brush hardness (up = harder, down = softer).
  // Snapshots size+hardness at pointerdown so the deltas stay relative to
  // the gesture's starting state (cheap, predictable, no drift).
  let brushAdjust: {
    pointerId: number;
    startX: number;
    startY: number;
    startSize: number;
    startHardness: number;
  } | null = null;
  // In-flight Select-tool drag. `startWorld` is the anchor point (snapped to
  // the active layer's bounds at pointerdown). Each move clamps the live
  // pointer back inside the same bounds and rewrites activeSelection so the
  // overlay tracks the gesture in real time.
  let selectDrag: {
    pointerId: number;
    layerId: string;
    startWorld: { x: number; y: number };
    bounds: { x: number; y: number; w: number; h: number };
  } | null = null;
  const EYEDROPPER_SAMPLE_INTERVAL_MS = 16;

  // Alt-key temp tool: held Alt swaps the active tool to Eyedropper for
  // the duration of the keypress (Photoshop convention). Restored on
  // keyup. Doesn't interact with brush strokes — Alt during a stroke is
  // ignored. The handlers live on document so they work regardless of
  // whether the canvas has focus.
  let altTemp: { previousTool: string } | null = null;
  const onAltDown = (e: KeyboardEvent) => {
    if (e.key !== 'Alt' || altTemp) return;
    const cur = opts.getActiveTool?.() ?? 'move';
    if (cur === 'eyedropper') return;
    if (brushEngine?.isStrokeActive()) return;
    altTemp = { previousTool: cur };
    opts.setActiveTool?.('eyedropper');
  };
  const onAltUp = (e: KeyboardEvent) => {
    if (e.key !== 'Alt' || !altTemp) return;
    const prev = altTemp.previousTool;
    altTemp = null;
    opts.setActiveTool?.(prev);
  };
  document.addEventListener('keydown', onAltDown);
  document.addEventListener('keyup', onAltUp);

  // Extracted from the public sampleColorAt so onDown's eyedropper branch
  // can call it directly without going through `this`. Returns null on
  // failure; otherwise '#rrggbb'.
  const sampleColorAtImpl = (clientX: number, clientY: number): string | null => {
    if (!app || disposed) return null;
    const r = container.getBoundingClientRect();
    const lx = clientX - r.left;
    const ly = clientY - r.top;
    if (lx < 0 || ly < 0 || lx >= r.width || ly >= r.height) return null;
    paintIfReady();
    const gl = (app.renderer as unknown as { gl?: WebGLRenderingContext }).gl;
    if (!gl) return null;
    const dpr = app.renderer.resolution;
    const px = Math.floor(lx * dpr);
    const py = Math.floor((r.height - ly) * dpr);
    const out = new Uint8Array(4);
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    } catch {
      return null;
    }
    const hex = (n: number) => n.toString(16).padStart(2, '0');
    return `#${hex(out[0])}${hex(out[1])}${hex(out[2])}`;
  };

  const onContextMenu = (e: MouseEvent) => {
    if (e.altKey) e.preventDefault();
  };

  const onDown = (e: PointerEvent) => {
    // Mouse: accept left (0) and middle (1) always; right (2) only when
    // Alt is held + the active tool is brush/erase (Photoshop's brush-
    // adjust gesture — see brushAdjust branch below). Touch / pen: no
    // button concept — always go through.
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) {
      if (e.button === 2 && e.altKey) {
        // Alt-keydown already swapped to eyedropper temp, so the live
        // active tool reads as 'eyedropper'. Fall back to the tool that
        // was active BEFORE the swap so the gesture still fires when
        // the user's real tool is brush/erase.
        const live = opts.getActiveTool?.() ?? 'move';
        const tool = altTemp ? altTemp.previousTool : live;
        const settings = opts.getBrushSettings?.();
        if ((tool === 'brush' || tool === 'erase') && settings) {
          // Suppress the OS context menu for this gesture.
          e.preventDefault();
          // Alt-keydown already swapped to eyedropper temp — restore the
          // real tool now and consume the altTemp so the eventual Alt-up
          // doesn't try to restore it again.
          if (altTemp) {
            const prev = altTemp.previousTool;
            altTemp = null;
            if (prev !== 'eyedropper') opts.setActiveTool?.(prev);
          }
          container.setPointerCapture(e.pointerId);
          brushAdjust = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            startSize: settings.size,
            startHardness: settings.hardness,
          };
          // Brush tool sets cursor to 'none' so the floating BrushCursor
          // overlay (React component) is the visible cue. Keep that here
          // — the user sees the ring resize live as they drag.
          container.style.cursor = 'none';
          return;
        }
      }
      return;
    }
    container.setPointerCapture(e.pointerId);
    stopInertia();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });

    // Middle-button down → save current tool, flip to Move, treat as a pure
    // pan (skip layer hit tests entirely). Behaves like Photoshop's Hand
    // tool spacebar shortcut. With only Move registered today this is
    // visually a no-op, but the architecture's correct for future tools.
    if (e.pointerType === 'mouse' && e.button === 1) {
      // Suppress the browser's middle-click autoscroll cursor on Chrome/Edge.
      e.preventDefault();
      const prev = opts.getActiveTool?.() ?? null;
      middlePan = { pointerId: e.pointerId, previousTool: prev };
      if (prev !== 'move') opts.setActiveTool?.('move');
      // Skip straight to the empty-space pan branch — set up pan state and
      // bail. No bounds drag, no deselect-on-tap, no handle hit.
      panStart = { vx: view.x, vy: view.y };
      pinchStart = null;
      boundsDrag = null;
      velTracker.reset(e.clientX, e.clientY);
      container.style.cursor = 'grabbing';
      return;
    }

    // First pointer = either pan, layer-move, or handle-resize. Two pointers
    // always = pinch zoom (no bounds editing during two-finger gestures).
    if (pointers.size === 1) {
      const wp = clientToWorld(e.clientX, e.clientY);
      const tool = opts.getActiveTool?.() ?? 'move';
      // 0a. Eyedropper: sample the pixel under the cursor and write it
      //     into the brush color. Doesn't paint, doesn't change layers.
      //     Mirrors Photoshop — and Alt-hold-then-click (handled via the
      //     alt-temp-tool flow in onKeyDown/Up) does the same thing.
      if (tool === 'eyedropper') {
        const color = (app && container) ? sampleColorAtImpl(e.clientX, e.clientY) : null;
        if (color) opts.onEyedropperPick?.(color);
        eyedropperDrag = { pointerId: e.pointerId, lastSampleAt: performance.now() };
        panStart = null;
        pinchStart = null;
        boundsDrag = null;
        container.style.cursor = 'crosshair';
        return;
      }
      // 0c. Select: start a sub-rect drag clamped to the active layer's
      //     bounds. Needs an active layer; with none, fall through to the
      //     default behaviour (so a click on a layer activates it before
      //     the next select-tool drag starts).
      if (tool === 'select') {
        const activeId = opts.getActiveLayerId?.() ?? null;
        const layers = opts.getLayers ? opts.getLayers() : [];
        const target = activeId ? layers.find(l => l.id === activeId) : null;
        if (target && target.bounds.w > 0 && target.bounds.h > 0) {
          const sx = Math.max(target.bounds.x, Math.min(target.bounds.x + target.bounds.w, wp.x));
          const sy = Math.max(target.bounds.y, Math.min(target.bounds.y + target.bounds.h, wp.y));
          selectDrag = {
            pointerId: e.pointerId,
            layerId: target.id,
            startWorld: { x: sx, y: sy },
            bounds: { ...target.bounds },
          };
          // Seed an empty selection so the rect appears immediately on click.
          opts.setActiveSelection?.({ layerId: target.id, x: sx, y: sy, w: 0, h: 0 });
          panStart = null;
          pinchStart = null;
          boundsDrag = null;
          container.style.cursor = 'crosshair';
          return;
        }
        // No active layer with bounds — clear any old selection and let the
        // default pan/hit-test path run so the user can click to activate.
        opts.setActiveSelection?.(null);
      }
      // 0b. Brush / erase: route to the engine and skip all hit-testing.
      //     Strokes always paint on the active layer regardless of where
      //     the pointer lands (matches Photoshop). No active layer = no-op.
      if ((tool === 'brush' || tool === 'erase') && brushEngine) {
        const activeId = opts.getActiveLayerId?.() ?? null;
        const settings = opts.getBrushSettings?.();
        if (activeId && settings) {
          brushEngine.beginStroke(activeId, wp.x, wp.y, {
            mode: tool === 'erase' ? 'erase' : 'paint',
            ...settings,
          });
        }
        // Even with no active layer, swallow the event so the canvas
        // doesn't fall through to pan/deselect during brush use.
        panStart = null;
        pinchStart = null;
        boundsDrag = null;
        // 'none' — the BrushCursor overlay component renders its own
        // size/hardness-aware visual following the mouse.
        container.style.cursor = 'none';
        return;
      }
      // 1. Handle hit on active layer? → resize mode.
      const handleHit = hitTestHandle(wp.x, wp.y);
      if (handleHit) {
        boundsDrag = {
          kind: 'resize',
          layerId: handleHit.layerId,
          handle: handleHit.handle,
          startBounds: handleHit.bounds,
          startWorld: wp,
        };
        panStart = null;
        pinchStart = null;
        container.style.cursor = cursorForHandle(handleHit.handle);
        return;
      }
      // 2. Interior hit on a layer? → activate (if not already) + move mode.
      //    Locked layers can be activated but not moved.
      const interior = hitTestInterior(wp.x, wp.y);
      if (interior) {
        const activeId = opts.getActiveLayerId?.() ?? null;
        if (interior.id !== activeId) opts.setActiveLayer?.(interior.id);
        if (!interior.locked) {
          boundsDrag = {
            kind: 'move',
            layerId: interior.id,
            startBounds: interior.bounds,
            startWorld: wp,
          };
        }
        panStart = null;
        pinchStart = null;
        container.style.cursor = interior.locked ? 'not-allowed' : 'move';
        return;
      }
      // 3. Empty space → pan. If there's an active layer, mark it for
      //    deselection on pointerup IF the pointer barely moved (tap, not
      //    pan). Photoshop-style: clicking off any layer drops the
      //    selection; panning the canvas does not.
      pendingDeselectOnTap = !!opts.getActiveLayerId?.();
      panStart = { vx: view.x, vy: view.y };
      pinchStart = null;
      velTracker.reset(e.clientX, e.clientY);
    } else if (pointers.size === 2) {
      // Two-pointer gesture cancels any in-flight bounds edit.
      boundsDrag = null;
      const [a, b] = [...pointers.values()];
      const r = container.getBoundingClientRect();
      const sxRel = (a.x + b.x) / 2 - r.left;
      const syRel = (a.y + b.y) / 2 - r.top;
      pinchStart = {
        d: dist(a, b),
        z: view.zoom,
        vx: view.x,
        vy: view.y,
        wx: (sxRel - r.width / 2) / view.zoom + view.x,
        wy: (syRel - r.height / 2) / view.zoom + view.y,
      };
      panStart = null;
      container.style.cursor = 'grabbing';
    } else if (panStart) {
      // Single-pointer pan only — bounds drag and resize set their own cursors.
      container.style.cursor = 'grabbing';
    }
  };

  const onMove = (e: PointerEvent) => {
    const pt = pointers.get(e.pointerId);
    if (!pt) {
      // No button pressed — hover cursor feedback. Skip on touch (no hover).
      if (e.pointerType === 'touch') return;
      const tool = opts.getActiveTool?.() ?? 'move';
      if (tool === 'brush' || tool === 'erase') {
        container.style.cursor = 'none';
        return;
      }
      const wp = clientToWorld(e.clientX, e.clientY);
      const handleHit = hitTestHandle(wp.x, wp.y);
      if (handleHit) {
        container.style.cursor = cursorForHandle(handleHit.handle);
        return;
      }
      const interior = hitTestInterior(wp.x, wp.y);
      if (interior) {
        container.style.cursor = interior.locked ? 'not-allowed' : 'move';
        return;
      }
      container.style.cursor = 'grab';
      return;
    }
    pt.x = e.clientX;
    pt.y = e.clientY;

    // Brush / erase: if a stroke is in flight, extend it. This must run
    // before the bounds/pan branches below — those would otherwise eat the
    // event since brush mode never set boundsDrag/panStart.
    if (brushEngine?.isStrokeActive()) {
      const wp = clientToWorld(e.clientX, e.clientY);
      brushEngine.continueStroke(wp.x, wp.y);
      return;
    }

    // Photoshop brush-adjust drag: dx → size, dy → hardness. Capture is
    // already on the container, so we keep receiving moves even when the
    // pointer leaves the canvas bounds.
    if (brushAdjust && brushAdjust.pointerId === e.pointerId) {
      const dx = e.clientX - brushAdjust.startX;
      const dy = brushAdjust.startY - e.clientY; // up = positive
      // 1 screen px = 1 brush px feels right at default zoom; users with
      // very tiny brushes can dial finer with a slower drag anyway.
      const size = Math.max(1, Math.min(1024, Math.round(brushAdjust.startSize + dx)));
      // 200px vertical drag covers the full 0..1 hardness range.
      const hardness = Math.max(0, Math.min(1, brushAdjust.startHardness + dy / 200));
      opts.setBrushSettings?.({ size, hardness });
      return;
    }

    // Select drag: live-update the sub-rect as the pointer moves, clamped
    // to the layer's bounds. Snap-to-grid honoured so the resulting rect
    // lines up with SD-friendly increments.
    if (selectDrag && selectDrag.pointerId === e.pointerId) {
      const wp = clientToWorld(e.clientX, e.clientY);
      const b = selectDrag.bounds;
      const cx = Math.max(b.x, Math.min(b.x + b.w, wp.x));
      const cy = Math.max(b.y, Math.min(b.y + b.h, wp.y));
      const sx = selectDrag.startWorld.x;
      const sy = selectDrag.startWorld.y;
      const x0 = maybeSnap(Math.min(sx, cx));
      const y0 = maybeSnap(Math.min(sy, cy));
      const x1 = maybeSnap(Math.max(sx, cx));
      const y1 = maybeSnap(Math.max(sy, cy));
      const clampedX = Math.max(b.x, Math.min(b.x + b.w, x0));
      const clampedY = Math.max(b.y, Math.min(b.y + b.h, y0));
      const clampedR = Math.max(b.x, Math.min(b.x + b.w, x1));
      const clampedB = Math.max(b.y, Math.min(b.y + b.h, y1));
      opts.setActiveSelection?.({
        layerId: selectDrag.layerId,
        x: clampedX,
        y: clampedY,
        w: Math.max(0, clampedR - clampedX),
        h: Math.max(0, clampedB - clampedY),
      });
      return;
    }

    // Eyedropper drag: keep sampling while the button stays held. Reading
    // from the GPU framebuffer is sync-stall-heavy, so throttle to ~60Hz.
    if (eyedropperDrag && eyedropperDrag.pointerId === e.pointerId) {
      const now = performance.now();
      if (now - eyedropperDrag.lastSampleAt >= EYEDROPPER_SAMPLE_INTERVAL_MS) {
        eyedropperDrag.lastSampleAt = now;
        const color = sampleColorAtImpl(e.clientX, e.clientY);
        if (color) opts.onEyedropperPick?.(color);
      }
      return;
    }

    // Bounds drag (move or resize) is checked first — when active, it takes
    // priority over pan even though we're still single-pointer.
    if (boundsDrag) {
      const wp = clientToWorld(e.clientX, e.clientY);
      const dx = wp.x - boundsDrag.startWorld.x;
      const dy = wp.y - boundsDrag.startWorld.y;
      const start = boundsDrag.startBounds;
      let next = { ...start };
      if (boundsDrag.kind === 'move') {
        next.x = maybeSnap(start.x + dx);
        next.y = maybeSnap(start.y + dy);
      } else {
        // Resize from the dragged handle. North/south affect y + h; west/east
        // affect x + w. We snap the moved edge to the grid then derive w/h.
        const h = boundsDrag.handle;
        const minSize = opts.getSnapEnabled?.()
          ? (opts.getGridStep?.() ?? GRID_FALLBACK)
          : 8;
        if (h === 'n' || h === 'nw' || h === 'ne') {
          const ny = maybeSnap(start.y + dy);
          const nh = (start.y + start.h) - ny;
          if (nh >= minSize) { next.y = ny; next.h = nh; }
        }
        if (h === 's' || h === 'sw' || h === 'se') {
          const nb = maybeSnap(start.y + start.h + dy);
          const nh = nb - start.y;
          if (nh >= minSize) { next.h = nh; }
        }
        if (h === 'w' || h === 'nw' || h === 'sw') {
          const nx = maybeSnap(start.x + dx);
          const nw = (start.x + start.w) - nx;
          if (nw >= minSize) { next.x = nx; next.w = nw; }
        }
        if (h === 'e' || h === 'ne' || h === 'se') {
          const nr = maybeSnap(start.x + start.w + dx);
          const nw = nr - start.x;
          if (nw >= minSize) { next.w = nw; }
        }
      }
      opts.setLayerBounds?.(boundsDrag.layerId, next);
      // No syncWorld / paintIfReady here — InfiniteCanvas's canvasLayers
      // subscription fires requestRender on the store change.
      return;
    }

    if (pointers.size === 1 && panStart) {
      const only = [...pointers.values()][0];
      view.x = panStart.vx - (only.x - only.sx) / view.zoom;
      view.y = panStart.vy - (only.y - only.sy) / view.zoom;
      velTracker.sample(e.clientX, e.clientY);
      syncWorld();
      paintIfReady();
      emitViewChange();
    } else if (pointers.size === 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      const r = container.getBoundingClientRect();
      const newD = dist(a, b);
      const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, (pinchStart.z * newD) / pinchStart.d));
      const sxRel = (a.x + b.x) / 2 - r.left;
      const syRel = (a.y + b.y) / 2 - r.top;
      view.x = pinchStart.wx - (sxRel - r.width / 2) / newZoom;
      view.y = pinchStart.wy - (syRel - r.height / 2) / newZoom;
      view.zoom = newZoom;
      syncWorld();
      paintIfReady();
      emitViewChange();
    }
  };

  const onUp = (e: PointerEvent) => {
    // Brush / erase: commit the in-flight stroke first. Done before the
    // generic pointer bookkeeping so the engine never sees a half-cleaned
    // pointer state, and so cancel-during-multi-touch is unambiguous.
    if (brushEngine?.isStrokeActive()) {
      void brushEngine.endStroke();
      pointers.delete(e.pointerId);
      container.style.cursor = 'none';
      return;
    }
    if (eyedropperDrag && eyedropperDrag.pointerId === e.pointerId) {
      eyedropperDrag = null;
      pointers.delete(e.pointerId);
      return;
    }
    if (brushAdjust && brushAdjust.pointerId === e.pointerId) {
      brushAdjust = null;
      container.style.cursor = 'none';
      return;
    }
    if (selectDrag && selectDrag.pointerId === e.pointerId) {
      const sel = opts.getActiveSelection?.() ?? null;
      // Treat a near-zero selection as a click → clear any prior selection.
      if (!sel || sel.w < 4 || sel.h < 4) opts.setActiveSelection?.(null);
      selectDrag = null;
      pointers.delete(e.pointerId);
      container.style.cursor = 'crosshair';
      return;
    }
    const pt = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);

    // Middle-button release → restore the tool that was active before the
    // middle-pan started. Also disables the deselect-on-tap path (middle-
    // click should never deselect a layer, even on a stationary press).
    const wasMiddlePan = middlePan?.pointerId === e.pointerId;
    if (wasMiddlePan) {
      const prev = middlePan!.previousTool;
      middlePan = null;
      if (prev && prev !== 'move') opts.setActiveTool?.(prev);
      pendingDeselectOnTap = false;
    }

    if (pointers.size === 0) {
      const wasBoundsDrag = boundsDrag !== null;
      boundsDrag = null;
      const moved = pt ? Math.hypot(pt.x - pt.sx, pt.y - pt.sy) : 0;
      container.style.cursor = 'grab';
      // Momentum only fires for pan releases — never for bounds edits.
      if (!wasBoundsDrag && moved > THROW_MIN_DISTANCE) {
        const v = velTracker.release();
        if (Math.hypot(v.x, v.y) > THROW_MIN_VELOCITY) {
          startInertia(v.x, v.y);
        }
      }
      // Pending deselect from an empty-space pointerdown — only fires when
      // the pointer barely moved (tap). 4px screen tolerance is enough to
      // distinguish a deliberate click from a wiggly mousedown.
      if (pendingDeselectOnTap && moved < 4) {
        opts.setActiveLayer?.(null);
      }
      pendingDeselectOnTap = false;
      panStart = null;
      pinchStart = null;
    } else if (pointers.size === 1) {
      // Lifted one of two fingers — re-anchor pan to the remaining one.
      const only = [...pointers.values()][0];
      only.sx = only.x;
      only.sy = only.y;
      panStart = { vx: view.x, vy: view.y };
      pinchStart = null;
    }
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const r = container.getBoundingClientRect();
    const sxRel = e.clientX - r.left;
    const syRel = e.clientY - r.top;
    const wx = (sxRel - r.width / 2) / view.zoom + view.x;
    const wy = (syRel - r.height / 2) / view.zoom + view.y;
    const delta = -e.deltaY * (e.deltaMode === 1 ? 30 : 1);
    const factor = Math.exp(delta * 0.0015);
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, view.zoom * factor));
    // Keep the world point under the cursor stationary.
    view.x = wx - (sxRel - r.width / 2) / newZoom;
    view.y = wy - (syRel - r.height / 2) / newZoom;
    view.zoom = newZoom;
    syncWorld();
    paintIfReady();
    emitViewChange();
  };

  const onDblClick = () => {
    if (opts.onImageActivate) opts.onImageActivate();
  };

  // ---- Resize ------------------------------------------------------------
  // Fires only when the container's box actually changes — with the
  // fullscreen-canvas layout (panels overlay the canvas), this means window
  // resize only.
  const ro = new ResizeObserver(() => {
    if (!app || disposed) return;
    const r = container.getBoundingClientRect();
    const w = Math.max(1, Math.floor(r.width));
    const h = Math.max(1, Math.floor(r.height));
    if (w === viewportW && h === viewportH) return;
    viewportW = w;
    viewportH = h;
    app.renderer.resize(w, h);
    redrawBgFill();
    syncWorld();
    paintIfReady();
  });

  // ---- Init --------------------------------------------------------------
  Promise.resolve().then(() => {
    if (disposed) return;
    requestAnimationFrame(async () => {
      if (disposed) return;
      const r = container.getBoundingClientRect();
      viewportW = Math.max(1, Math.floor(r.width));
      viewportH = Math.max(1, Math.floor(r.height));
      const pendingApp = new Application();
      try {
        await pendingApp.init({
          canvas,
          width: viewportW,
          height: viewportH,
          background: 0x070a10,
          antialias: true,
          resolution: window.devicePixelRatio || 1,
          autoDensity: true,
          autoStart: false,
        });
      } catch (err) {
        console.error('[canvas-pixi] init failed', err);
        return;
      }
      if (disposed) {
        pendingApp.destroy(
          { removeView: false, releaseGlobalResources: true },
          { children: true, texture: true, textureSource: true },
        );
        return;
      }
      app = pendingApp;
      // bgFill first so it renders before world (and gets covered by any
      // opaque layer content).
      app.stage.addChild(bgFill);
      app.stage.addChild(world);
      redrawBgFill();
      ro.observe(container);

      // Brush / erase engine — uses the renderer to stamp into per-layer
      // RenderTextures and the spritesGfx container to mount its live
      // stroke-display sprite. Created here (not at controller construction)
      // because it needs the initialised renderer.
      brushEngine = createBrushEngine({
        app,
        spritesGfx,
        getSelectedTexture: async (layer) => {
          // Prefer the live texture already in the layer cache (no IDB hit);
          // fall back to fetching the blob if the layer is currently evicted.
          const cached = layerCache.get(layer.id);
          if (cached?.texture && cached.texture !== Texture.EMPTY) return cached.texture;
          if (!layer.selectedHistoryId) return null;
          // Lazy IDB hit — engine handles the null case (stamp on blank RT).
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { canvasStorage } = require('./canvasStorageInstance');
            const history = await canvasStorage.listLayerHistory(layer.id);
            const entry = history.find((e: { id: string }) => e.id === layer.selectedHistoryId);
            if (!entry) return null;
            const blob = await canvasStorage.getBlob(entry.blobId);
            if (!blob) return null;
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.src = url;
            await img.decode();
            const tex = Texture.from(img);
            URL.revokeObjectURL(url);
            return tex;
          } catch {
            return null;
          }
        },
        hideLayerSprite: (id) => {
          const e = layerCache.get(id);
          if (e?.sprite) e.sprite.visible = false;
        },
        setLayerSpriteTexture: (id, texture) => {
          const e = layerCache.get(id);
          if (e?.sprite) e.sprite.texture = texture;
        },
        markHistoryLoaded: (layerId, historyId) => {
          opts.markHistoryLoaded?.(layerId, historyId);
        },
        restoreLayerSprite: (id) => {
          const e = layerCache.get(id);
          if (e?.sprite) {
            // syncLayers reads layer.visible to set sprite.visible; restore
            // honoring the layer's own visibility state instead of forcing on.
            const layer = opts.getLayers?.().find(l => l.id === id);
            e.sprite.visible = layer?.visible ?? true;
          }
        },
        requestRender: paintIfReady,
      });

      // Wire input on the container so events land regardless of where
      // exactly inside the canvas the pointer is.
      container.addEventListener('pointerdown', onDown);
      container.addEventListener('pointermove', onMove);
      container.addEventListener('pointerup', onUp);
      container.addEventListener('pointercancel', onUp);
      container.addEventListener('wheel', onWheel, { passive: false });
      container.addEventListener('dblclick', onDblClick);
      // Suppress the OS context menu when Alt is held — the brush-adjust
      // gesture is Alt+RMB+drag and we need the right-click to land on us,
      // not pop a menu. Without alt, right-click is otherwise unused on
      // the canvas, so we still let the menu through.
      container.addEventListener('contextmenu', onContextMenu);
      container.style.cursor = 'grab';

      syncWorld();
      paintIfReady();
    });
  });

  return {
    loadHttpUrl(url, onDone) {
      const gen = ++imageGen;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (disposed || gen !== imageGen) return;
        const tex = Texture.from(img);
        swapTexture(tex, null);
        onDone?.(true);
      };
      img.onerror = () => onDone?.(false);
      img.src = url;
    },
    resetView() {
      stopInertia();
      setView(0, 0, 1);
    },
    fitToViewport(topOffset) {
      stopInertia();
      fitToViewportImpl(topOffset);
    },
    fitLayerToViewport(layerId, topOffset) {
      stopInertia();
      const layer = opts.getLayers?.().find(l => l.id === layerId);
      if (!layer) return;
      fitRectToViewportImpl(layer.bounds, topOffset);
    },
    isDefaultView,
    requestRender() {
      // syncWorld pulls in the latest grid step / viewport size and triggers
      // ensureGrid → redraw if anything invalidated. A plain renderer.render
      // only repaints the existing scene, which misses store-driven changes
      // like the grid step adjusting via [ / ].
      syncWorld();
      paintIfReady();
    },
    clientToWorld,
    worldToContainer,
    setLayerImage(layerId, url, blobId = null, crop = null) {
      loadLayerImageImpl(layerId, url, blobId ?? null, crop ?? null);
    },
    setLayerBlobId(layerId, blobId) {
      const entry = layerCache.get(layerId);
      if (entry) entry.blobId = blobId;
    },
    onViewChange(cb) {
      viewChangeListeners.add(cb);
      return () => { viewChangeListeners.delete(cb); };
    },
    getZoom() {
      return view.zoom;
    },
    sampleColorAt(clientX, clientY) {
      return sampleColorAtImpl(clientX, clientY);
    },
    async captureBoundsComposite(layerId, captureOpts = {}) {
      if (!app) return null;
      const layers = opts.getLayers?.() ?? [];
      const target = layers.find(l => l.id === layerId);
      if (!target || target.bounds.w <= 0 || target.bounds.h <= 0) return null;
      const includeTarget = !!captureOpts.includeTarget;
      const includeAbove = !!captureOpts.includeAbove;

      // RenderTexture at the target layer's pixel resolution (bounds.w × .h
      // in world units == pixels at zoom=1). Drawn in RT-local coords where
      // (0,0) maps to the target layer's top-left.
      const rt = RenderTexture.create({
        width: Math.max(1, Math.round(target.bounds.w)),
        height: Math.max(1, Math.round(target.bounds.h)),
        resolution: 1,
      });
      const composite = new Container();

      // Background fill — only solid colour for now. transparent = no-op
      // (RT starts cleared transparent). 'image' kind: deferred until
      // background-image picker UI lands.
      if (target.background?.kind === 'solid') {
        const color = (() => {
          // Parse '#rrggbb' or '#rgb' into a number; fall back to black.
          const m = /^#([0-9a-f]{3,8})$/i.exec(target.background.color);
          if (!m) return 0x000000;
          const h = m[1];
          if (h.length === 3) {
            const r = parseInt(h[0] + h[0], 16);
            const g = parseInt(h[1] + h[1], 16);
            const b = parseInt(h[2] + h[2], 16);
            return (r << 16) | (g << 8) | b;
          }
          return parseInt(h.slice(0, 6), 16);
        })();
        const bg = new Graphics()
          .rect(0, 0, target.bounds.w, target.bounds.h)
          .fill({ color });
        composite.addChild(bg);
      }

      // Stack visible layers BENEATH the target in ascending zIndex order, each
      // positioned + sized relative to the RT (which represents the target's
      // bounds in world coords). Layers without a sprite (no stamp yet) only
      // contribute their bounds shape — skipped since we'd just be drawing
      // transparent space.
      const stack = layers
        .filter(l => l.visible && l.id !== layerId && (
          l.zIndex < target.zIndex || (includeAbove && l.zIndex > target.zIndex)
        ))
        .sort((a, b) => a.zIndex - b.zIndex);
      const tempSprites: Sprite[] = [];
      const renderOrder: typeof stack = [];
      for (const l of stack) {
        if (!includeTarget) { renderOrder.push(l); continue; }
        if (renderOrder.length === 0 && l.zIndex > target.zIndex) {
          // Inject target at its z position
          renderOrder.push(target);
        }
        renderOrder.push(l);
      }
      if (includeTarget && !renderOrder.includes(target)) renderOrder.push(target);
      for (const l of renderOrder) {
        const cell = layerCache.get(l.id);
        if (!cell?.texture || cell.texture === Texture.EMPTY) continue;
        // Use a fresh Sprite (not the original) so we don't mutate the
        // live scene-graph sprite's position/size during render.
        const s = new Sprite(cell.texture);
        s.position.set(l.bounds.x - target.bounds.x, l.bounds.y - target.bounds.y);
        s.width = l.bounds.w;
        s.height = l.bounds.h;
        composite.addChild(s);
        tempSprites.push(s);
      }

      app.renderer.render({ container: composite, target: rt });

      // Extract to a Blob via the renderer's canvas extractor + toBlob.
      let blob: Blob | null = null;
      try {
        const canvas = app.renderer.extract.canvas(rt);
        if (canvas instanceof HTMLCanvasElement) {
          blob = await new Promise<Blob | null>((resolve) => {
            canvas.toBlob((b) => resolve(b), 'image/png');
          });
        }
      } catch (err) {
        console.warn('[canvas] captureBoundsComposite extract failed', err);
      }

      // Cleanup — destroy the temp sprites + composite + RT, but keep the
      // shared layer textures alive (they belong to the live scene).
      for (const s of tempSprites) s.destroy({ texture: false, textureSource: false });
      composite.destroy({ children: true, texture: false, textureSource: false });
      rt.destroy(true);

      return blob;
    },
    async captureContextAndMask(layerId, padding = 64, attachedImageUrl = null, captureOpts = {}) {
      if (!app) return null;
      const layers = opts.getLayers?.() ?? [];
      const target = layers.find(l => l.id === layerId);
      if (!target || target.bounds.w <= 0 || target.bounds.h <= 0) return null;

      // Compute context bounds: target + `padding` floor on every side, then
      // unioned with any visible neighbour that overlaps target so the model
      // sees their pixels as context too.
      //
      // The uniform per-side floor is non-negotiable for outpainting: even
      // when there are no neighbour layers, the apron strip-blit below
      // edge-extends the attached image into the apron, and the model uses
      // those pixels as the edge context that lets a fresh-fill (destructive
      // variant / high-denoise denoising variant) blend into the layer's
      // existing colours and style. Zero padding on a side = no context on
      // that side = dark / incoherent output at the new edge (the
      // outpainting-failure case).
      //
      // Visible preview artifacts that leak past the layer bounds during a
      // run are not solved here — they're solved by cropping every preview
      // frame to the same fractional rect as the final result (see the
      // `crop` argument plumbed through setLayerImage).
      const intersects = (a: typeof target.bounds, b: typeof target.bounds) =>
        a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
      let cx0 = target.bounds.x - padding;
      let cy0 = target.bounds.y - padding;
      let cx1 = target.bounds.x + target.bounds.w + padding;
      let cy1 = target.bounds.y + target.bounds.h + padding;
      for (const l of layers) {
        if (l.id === layerId || !l.visible) continue;
        if (!intersects(l.bounds, target.bounds)) continue;
        cx0 = Math.min(cx0, l.bounds.x);
        cy0 = Math.min(cy0, l.bounds.y);
        cx1 = Math.max(cx1, l.bounds.x + l.bounds.w);
        cy1 = Math.max(cy1, l.bounds.y + l.bounds.h);
      }
      const ctx = {
        x: cx0,
        y: cy0,
        w: Math.max(1, Math.round(cx1 - cx0)),
        h: Math.max(1, Math.round(cy1 - cy0)),
      };

      // ── Composite RT: every visible layer except the target, positioned
      // relative to ctx top-left. If the target has committed attached
      // pixels we add them too — they're the model's img2img source. The
      // target's live sprite (which may be showing an uncommitted candidate
      // from a prior gen) is deliberately excluded because feeding the
      // candidate back into the next sample would compound VAE round-trip
      // wash on every iteration.
      const compRt = RenderTexture.create({ width: ctx.w, height: ctx.h, resolution: 1 });
      const compContainer = new Container();
      const tempSprites: Sprite[] = [];
      const tempTextures: Texture[] = [];

      // Load the target's attached pixels FIRST — we need them up-front to
      // edge-extend into the context apron before drawing anything else.
      // Without this, the apron is left transparent and ComfyUI's
      // InpaintCropImproved (with context_from_mask_extend_factor) pulls
      // those black pixels into the model's context window — that's the
      // "black bars" framing you used to see in the inpaint preview.
      let attachedTextureSource: Texture | null = null;
      if (attachedImageUrl) {
        try {
          const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image();
            el.crossOrigin = 'anonymous';
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error('attached image load failed'));
            el.src = attachedImageUrl;
          });
          attachedTextureSource = Texture.from(img);
        } catch (err) {
          console.warn('[canvas] attached image load for capture failed', err);
        }
      }

      // Edge-extend the attached image into the apron around target.bounds —
      // 8 strips (4 edges + 4 corners), each sampling a 1px slice of the
      // source image and stretched across its strip. Strips with an empty
      // destination (target hugs a ctx edge) are skipped. Drawn FIRST so
      // neighbour layers + the natural-size attached sprite render on top.
      if (attachedTextureSource) {
        const src = attachedTextureSource.source;
        const sw = attachedTextureSource.width;
        const sh = attachedTextureSource.height;
        const tx = target.bounds.x - ctx.x;
        const ty = target.bounds.y - ctx.y;
        const tw = target.bounds.w;
        const th = target.bounds.h;
        const padL = Math.max(0, tx);
        const padT = Math.max(0, ty);
        const padR = Math.max(0, ctx.w - tx - tw);
        const padB = Math.max(0, ctx.h - ty - th);
        type Strip = { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number };
        const strips: Strip[] = [
          { sx: 0,      sy: 0,      sw,    sh: 1,  dx: tx,        dy: ty - padT, dw: tw,    dh: padT }, // top
          { sx: 0,      sy: sh - 1, sw,    sh: 1,  dx: tx,        dy: ty + th,   dw: tw,    dh: padB }, // bottom
          { sx: 0,      sy: 0,      sw: 1, sh,     dx: tx - padL, dy: ty,        dw: padL,  dh: th  }, // left
          { sx: sw - 1, sy: 0,      sw: 1, sh,     dx: tx + tw,   dy: ty,        dw: padR,  dh: th  }, // right
          { sx: 0,      sy: 0,      sw: 1, sh: 1,  dx: tx - padL, dy: ty - padT, dw: padL,  dh: padT }, // TL
          { sx: sw - 1, sy: 0,      sw: 1, sh: 1,  dx: tx + tw,   dy: ty - padT, dw: padR,  dh: padT }, // TR
          { sx: 0,      sy: sh - 1, sw: 1, sh: 1,  dx: tx - padL, dy: ty + th,   dw: padL,  dh: padB }, // BL
          { sx: sw - 1, sy: sh - 1, sw: 1, sh: 1,  dx: tx + tw,   dy: ty + th,   dw: padR,  dh: padB }, // BR
        ];
        for (const strip of strips) {
          if (strip.dw <= 0 || strip.dh <= 0) continue;
          const tex = new Texture({
            source: src,
            frame: new Rectangle(strip.sx, strip.sy, strip.sw, strip.sh),
          });
          const s = new Sprite(tex);
          s.position.set(strip.dx, strip.dy);
          s.width = strip.dw;
          s.height = strip.dh;
          compContainer.addChild(s);
          tempSprites.push(s);
          tempTextures.push(tex);
        }
      }

      // Drawing order matters here, and it FLIPS between normal-mask and
      // invert-mask mode.
      //
      // Normal mode (mask = full target bounds): the masked region is what
      // the user wants to inpaint, so showing the target's current pixels
      // there gives the denoising variant a sensible starting point. Order:
      //   apron edge-extend → neighbours → target attached (target wins).
      //
      // Invert mode (mask = bounds minus neighbour intersections): the
      // *preserved* area is the neighbour-overlap region — the user wants
      // the stitch step to keep the NEIGHBOUR's pixels there, not the
      // target's. If the target attached draws last it covers the neighbour
      // and the stitch preserves the wrong pixels (or transparent → black
      // when the target has no attached image yet, which is the visible
      // failure case). Order:
      //   apron edge-extend → target attached → neighbours (neighbour wins).
      const drawTargetAttached = () => {
        if (!attachedTextureSource) return;
        const s = new Sprite(attachedTextureSource);
        s.position.set(target.bounds.x - ctx.x, target.bounds.y - ctx.y);
        s.width = target.bounds.w;
        s.height = target.bounds.h;
        compContainer.addChild(s);
        tempSprites.push(s);
      };
      const drawNeighbours = () => {
        const stack = layers
          .filter(l => l.visible && l.id !== layerId)
          .sort((a, b) => a.zIndex - b.zIndex);
        for (const l of stack) {
          const cell = layerCache.get(l.id);
          if (!cell?.texture || cell.texture === Texture.EMPTY) continue;
          const s = new Sprite(cell.texture);
          s.position.set(l.bounds.x - ctx.x, l.bounds.y - ctx.y);
          s.width = l.bounds.w;
          s.height = l.bounds.h;
          compContainer.addChild(s);
          tempSprites.push(s);
        }
      };
      if (captureOpts.invertMask) {
        drawTargetAttached();
        drawNeighbours();
      } else {
        drawNeighbours();
        drawTargetAttached();
      }

      app.renderer.render({ container: compContainer, target: compRt });

      // ── Mask RT: black fill, white over the area the model should inpaint.
      // For a normal mask that area is the entire target bounds. For
      // `invertMask`, it's the target bounds with every visible-neighbour
      // intersection rect subtracted — so the preserved neighbour regions
      // never enter the mask in the first place. Rect subtraction lets us
      // avoid an overlay trick (drawing black on top of white) which has
      // historically had issues with hole-fill / hipass / blend-pixel
      // post-processing collapsing the result back to a solid white mask.
      const maskRt = RenderTexture.create({ width: ctx.w, height: ctx.h, resolution: 1 });
      const maskContainer = new Container();
      const bg = new Graphics().rect(0, 0, ctx.w, ctx.h).fill({ color: 0x000000 });
      maskContainer.addChild(bg);

      type RectLocal = { x: number; y: number; w: number; h: number };
      let whiteRects: RectLocal[] = [{
        x: target.bounds.x - ctx.x,
        y: target.bounds.y - ctx.y,
        w: target.bounds.w,
        h: target.bounds.h,
      }];
      if (captureOpts.invertMask) {
        // Iteratively subtract each neighbour's intersection rect from the
        // current list of white rects. Subtracting one rect from another
        // produces up to four output rects (top strip, bottom strip, left
        // strip, right strip around the subtracted area).
        const subtractFrom = (r: RectLocal, h: RectLocal): RectLocal[] => {
          const ix0 = Math.max(r.x, h.x);
          const iy0 = Math.max(r.y, h.y);
          const ix1 = Math.min(r.x + r.w, h.x + h.w);
          const iy1 = Math.min(r.y + r.h, h.y + h.h);
          if (ix1 <= ix0 || iy1 <= iy0) return [r]; // no intersection
          const out: RectLocal[] = [];
          if (iy0 > r.y) out.push({ x: r.x, y: r.y, w: r.w, h: iy0 - r.y });
          if (iy1 < r.y + r.h) out.push({ x: r.x, y: iy1, w: r.w, h: r.y + r.h - iy1 });
          if (ix0 > r.x) out.push({ x: r.x, y: iy0, w: ix0 - r.x, h: iy1 - iy0 });
          if (ix1 < r.x + r.w) out.push({ x: ix1, y: iy0, w: r.x + r.w - ix1, h: iy1 - iy0 });
          return out;
        };
        for (const l of layers) {
          if (l.id === layerId || !l.visible) continue;
          const hole: RectLocal = {
            x: l.bounds.x - ctx.x,
            y: l.bounds.y - ctx.y,
            w: l.bounds.w,
            h: l.bounds.h,
          };
          const next: RectLocal[] = [];
          for (const r of whiteRects) next.push(...subtractFrom(r, hole));
          whiteRects = next;
        }
      }
      for (const r of whiteRects) {
        const g = new Graphics().rect(r.x, r.y, r.w, r.h).fill({ color: 0xffffff });
        maskContainer.addChild(g);
      }

      app.renderer.render({ container: maskContainer, target: maskRt });

      // ── Extract both to PNG blobs.
      const toBlob = async (rt: RenderTexture): Promise<Blob | null> => {
        try {
          const canvas = app!.renderer.extract.canvas(rt);
          if (!(canvas instanceof HTMLCanvasElement)) return null;
          return await new Promise<Blob | null>(resolve => canvas.toBlob(b => resolve(b), 'image/png'));
        } catch (err) {
          console.warn('[canvas] captureContextAndMask extract failed', err);
          return null;
        }
      };
      const composite = await toBlob(compRt);
      const mask = await toBlob(maskRt);

      // Cleanup: temp sprites + containers + RTs. Shared layer textures stay
      // alive (live scene still references them); the attached-image texture
      // is private to this capture so we destroy it explicitly.
      for (const s of tempSprites) s.destroy({ texture: false, textureSource: false });
      // Edge-extend strips own their Texture wrappers (1px sub-frames of the
      // attached source) — destroy the wrappers without touching the shared
      // attached texture's source, which the natural-size sprite also used.
      for (const t of tempTextures) t.destroy(false);
      compContainer.destroy({ children: true, texture: false, textureSource: false });
      maskContainer.destroy({ children: true, texture: false, textureSource: false });
      compRt.destroy(true);
      maskRt.destroy(true);
      if (attachedTextureSource) attachedTextureSource.destroy(true);

      if (!composite || !mask) return null;
      return { composite, mask, contextBounds: ctx };
    },
    dispose() {
      disposed = true;
      stopInertia();
      ro.disconnect();
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerup', onUp);
      container.removeEventListener('pointercancel', onUp);
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('dblclick', onDblClick);
      container.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('keydown', onAltDown);
      document.removeEventListener('keyup', onAltUp);
      if (imageTexture && imageTexture !== Texture.EMPTY) {
        imageTexture.destroy(true);
        imageTexture = null;
      }
      if (activeBlobUrl) {
        URL.revokeObjectURL(activeBlobUrl);
        activeBlobUrl = null;
      }
      if (app) {
        try {
          app.destroy(
            { removeView: false, releaseGlobalResources: true },
            { children: true, texture: true, textureSource: true },
          );
        } catch (err) {
          console.warn('[canvas-pixi] destroy threw — likely a partial init', err);
        }
        app = null;
      }
    },
  };
}
