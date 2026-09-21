/**
 * Pixi-backed image grid for the Collections view.
 *
 * Replaces the DOM `<div className="grid">` body of CollectionsGrid with a
 * Pixi v8 canvas that renders each tile as a Sprite with rounded corners,
 * a hover lift + 3D-ish tilt toward the cursor, smooth momentum scroll,
 * and an accent ring on the selected tile. Touch + wheel both scroll;
 * tap selects, second tap on the same tile fires `onActivate` (which
 * opens the fullscreen viewer in the parent).
 *
 * Toolbar, rail, and detail drawer stay DOM. Per-tile hover actions
 * (favorite / +collection / delete) moved into the detail drawer header.
 */
import { useEffect, useRef } from 'react';
import {
  Application,
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
} from 'pixi.js';
import type { Tile } from './useCollectionTiles';
import { createVelocityTracker, runInertia, type Vec } from '@/lib/momentum';
import { useStore } from '@/lib/store';

type Props = {
  tiles: Tile[];
  tileSize: number;
  selectedId: string | null;
  /** Tap / click on a tile. The caller decides whether this means "select"
   *  or "open" (typically: first click selects, second click on the same
   *  tile opens the fullscreen viewer). */
  onTileClick: (id: string) => void;
  /** Fires whenever the column count changes (resize, slider change). Used
   *  by the parent to translate up/down arrow keys into row-sized steps. */
  onColsChange?: (cols: number) => void;
};

const GAP = 12;
const PAD = 16;
const HOVER_LIFT = 1.025;
const SELECTED_LIFT = 1.03;
const RADIUS = 10;
const SPRING = 0.22; // per-frame lerp toward target layout positions

export function PixiCollectionsGrid({
  tiles, tileSize, selectedId, onTileClick, onColsChange,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const ctrlRef = useRef<GridController | null>(null);

  // Theme id is read so we re-pick palette colors when the user changes theme.
  const themeId = useStore((s) => s.themeId);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ctrl = new GridController(host);
    ctrlRef.current = ctrl;
    void ctrl.init();
    return () => {
      ctrlRef.current = null;
      ctrl.dispose();
    };
  }, []);

  useEffect(() => { ctrlRef.current?.setTiles(tiles); }, [tiles]);
  useEffect(() => { ctrlRef.current?.setTileSize(tileSize); }, [tileSize]);
  useEffect(() => { ctrlRef.current?.setSelected(selectedId); }, [selectedId]);
  useEffect(() => { ctrlRef.current?.setHandlers({ onTileClick, onColsChange }); }, [onTileClick, onColsChange]);
  useEffect(() => { ctrlRef.current?.refreshPalette(); }, [themeId]);

  return (
    <div
      ref={hostRef}
      className="relative min-h-0 flex-1 overflow-hidden"
      style={{ touchAction: 'none' }}
    />
  );
}

// ─── Controller ─────────────────────────────────────────────────────────────

type Palette = {
  bg: number;
  tileBg: number;
  ring: number;
  ringSoft: number;
  chipBg: number;
  chipFg: number;
  capBg: number;
  capFg: number;
  shadow: number;
};

type Slot = {
  id: string;
  tile: Tile;
  container: Container;
  bg: Graphics;
  imageHolder: Container;
  sprite: Sprite | null;
  ring: Graphics;
  chip: Container;
  chipText: Text;
  cap: Container | null;
  // animation
  curX: number;
  curY: number;
  targetX: number;
  targetY: number;
  hover: number;     // 0..1
  selected: number;  // 0..1
  // texture
  textureUrl: string;
  loadingUrl: string;
  /** Pointer position over the tile in tile-local coords (-0.5..0.5 each axis). */
  tiltX: number;
  tiltY: number;
};

class GridController {
  host: HTMLDivElement;
  app: Application = new Application();
  inited = false;
  disposed = false;
  ready: Promise<void>;

  world = new Container();         // scrolled container
  tilesLayer = new Container();
  hoverLayer = new Container();    // single tile lifted on hover (re-parented from tilesLayer)

  // state
  tiles: Tile[] = [];
  slots = new Map<string, Slot>();
  /** User-chosen *target* tile size (slider). The actual rendered tile size
   *  (`actualSize`) is interpolated to fill the row width — see relayout. */
  tileSize = 160;
  actualSize = 160;
  selectedId: string | null = null;
  handlers: {
    onTileClick: (id: string) => void;
    onColsChange?: (cols: number) => void;
  } = {
    onTileClick: () => {},
  };

  // layout
  cols = 1;
  contentHeight = 0;

  // scroll
  scrollY = 0;
  scrollTarget = 0;

  // input
  pointers = new Map<number, { x: number; y: number; startX: number; startY: number; moved: number }>();
  tracker = createVelocityTracker();
  cancelInertia: (() => void) | null = null;
  draggingForPan = false;
  hoveredId: string | null = null;
  pointerLocal: { x: number; y: number } | null = null;

  palette: Palette = pickPalette();

  ro: ResizeObserver | null = null;

  constructor(host: HTMLDivElement) {
    this.host = host;
    this.ready = Promise.resolve();
  }

  async init() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.ready = this.app.init({
      width: w,
      height: h,
      background: this.palette.bg,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      resizeTo: this.host,
      backgroundAlpha: 0,
    });
    await this.ready;
    if (this.disposed) {
      this.app.destroy(
        { removeView: true, releaseGlobalResources: true },
        { children: true },
      );
      return;
    }
    this.inited = true;
    this.host.appendChild(this.app.canvas);
    Object.assign(this.app.canvas.style, { display: 'block', width: '100%', height: '100%' });

    this.world.addChild(this.tilesLayer);
    this.world.addChild(this.hoverLayer);
    this.app.stage.addChild(this.world);

    this.ro = new ResizeObserver(() => this.relayout(true));
    this.ro.observe(this.host);

    this.attachInput();
    this.app.ticker.add(this.onTick);

    this.rebuildSlots();
    this.relayout(true);
  }

  dispose() {
    this.disposed = true;
    if (!this.inited) return;
    this.detachInput();
    this.cancelInertia?.();
    this.cancelInertia = null;
    this.app.ticker.remove(this.onTick);
    this.ro?.disconnect();
    this.ro = null;
    try {
      this.app.destroy(
        { removeView: true, releaseGlobalResources: true },
        { children: true, texture: false, textureSource: false },
      );
    } catch {
      // ignore double-destroy from strict-mode remounts
    }
  }

  // ── public setters ──

  setTiles(tiles: Tile[]) {
    this.tiles = tiles;
    if (!this.inited) return;
    this.rebuildSlots();
    this.relayout(false);
  }

  setTileSize(px: number) {
    if (this.tileSize === px) return;
    this.tileSize = px;
    if (!this.inited) return;
    this.relayout(false);
  }

  setSelected(id: string | null) {
    this.selectedId = id;
    if (id) this.scrollSelectedIntoView();
  }

  /** Make sure the currently-selected tile sits inside the visible
   *  viewport — if it's above, scroll up to show it; if it's below, scroll
   *  down. Called when selection changes (e.g. keyboard nav). */
  private scrollSelectedIntoView() {
    if (!this.inited || !this.selectedId) return;
    const slot = this.slots.get(this.selectedId);
    if (!slot) return;
    const T = this.actualSize;
    const top = slot.targetY - T / 2 - PAD;
    const bottom = slot.targetY + T / 2 + PAD;
    const h = this.host.clientHeight;
    const maxScroll = Math.max(0, this.contentHeight - h);
    let next = this.scrollTarget;
    if (top < next) next = top;
    else if (bottom > next + h) next = bottom - h;
    this.scrollTarget = clamp(next, 0, maxScroll);
  }

  setHandlers(h: { onTileClick: (id: string) => void; onColsChange?: (cols: number) => void }) {
    this.handlers = h;
    // Push the current cols so a freshly-mounted parent learns the value
    // without waiting for a relayout.
    if (this.inited) h.onColsChange?.(this.cols);
  }

  refreshPalette() {
    this.palette = pickPalette();
    if (!this.inited) return;
    for (const slot of this.slots.values()) this.drawTileChrome(slot);
  }

  // ── slot lifecycle ──

  private rebuildSlots() {
    const seen = new Set<string>();
    for (const tile of this.tiles) {
      seen.add(tile.id);
      const existing = this.slots.get(tile.id);
      if (existing) {
        existing.tile = tile;
        this.refreshTexture(existing);
        this.refreshChips(existing);
      } else {
        const slot = this.createSlot(tile);
        this.slots.set(tile.id, slot);
        this.tilesLayer.addChild(slot.container);
      }
    }
    for (const [id, slot] of this.slots) {
      if (!seen.has(id)) {
        this.tilesLayer.removeChild(slot.container);
        this.hoverLayer.removeChild(slot.container);
        slot.container.destroy({ children: true });
        this.slots.delete(id);
      }
    }
    if (this.hoveredId && !this.slots.has(this.hoveredId)) this.hoveredId = null;
  }

  private createSlot(tile: Tile): Slot {
    const container = new Container();
    container.eventMode = 'none';     // hit tests done manually via pointer events on host
    container.cullable = false;
    const bg = new Graphics();
    const imageHolder = new Container();
    const ring = new Graphics();
    const chip = new Container();
    const chipText = new Text({
      text: tile.source === 'import' ? 'IMPORT' : tile.source === 'favorite' ? 'FAV' : 'GEN',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 9,
        fontWeight: '700',
        fill: this.palette.chipFg,
        letterSpacing: 0.6,
      },
    });
    chip.addChild(chipText);

    container.addChild(bg);
    container.addChild(imageHolder);
    container.addChild(ring);
    container.addChild(chip);

    const slot: Slot = {
      id: tile.id,
      tile,
      container,
      bg,
      imageHolder,
      sprite: null,
      ring,
      chip,
      chipText,
      cap: null,
      curX: 0, curY: 0,
      targetX: 0, targetY: 0,
      hover: 0,
      selected: 0,
      textureUrl: '',
      loadingUrl: '',
      tiltX: 0, tiltY: 0,
    };

    this.drawTileChrome(slot);
    this.refreshTexture(slot);
    this.refreshChips(slot);
    return slot;
  }

  private drawTileChrome(slot: Slot) {
    const T = this.actualSize;
    const p = this.palette;

    slot.bg.clear();
    slot.bg
      .roundRect(0, 0, T, T, RADIUS)
      .fill({ color: p.tileBg });
    slot.bg.pivot.set(T / 2, T / 2);

    slot.imageHolder.pivot.set(T / 2, T / 2);

    slot.ring.clear();
    slot.ring.pivot.set(T / 2, T / 2);
    // redrawn per-frame based on hover/selected — see drawRing()
    this.drawRing(slot);

    // chip
    slot.chip.removeChildren();
    const chipPadX = 6;
    const chipPadY = 3;
    slot.chipText.style.fill = p.chipFg;
    const chipBg = new Graphics();
    chipBg
      .roundRect(0, 0, slot.chipText.width + chipPadX * 2, slot.chipText.height + chipPadY * 2, 4)
      .fill({ color: p.chipBg, alpha: 0.92 });
    slot.chip.addChild(chipBg);
    slot.chipText.x = chipPadX;
    slot.chipText.y = chipPadY;
    slot.chip.addChild(slot.chipText);

    // position chip top-left, relative to centered pivot of container
    slot.chip.x = -T / 2 + 8;
    slot.chip.y = -T / 2 + 8;

    // cap (tag count) top-right
    if (slot.cap) { slot.container.removeChild(slot.cap); slot.cap.destroy({ children: true }); slot.cap = null; }
    const n = slot.tile.tags?.length ?? 0;
    if (n > 0) {
      const cap = new Container();
      const capText = new Text({
        text: `✦ ${n}`,
        style: { fontFamily: 'system-ui, sans-serif', fontSize: 9, fontWeight: '700', fill: p.capFg },
      });
      const capBg = new Graphics();
      capBg
        .roundRect(0, 0, capText.width + 10, capText.height + 6, 4)
        .fill({ color: p.capBg, alpha: 0.92 });
      cap.addChild(capBg);
      capText.x = 5; capText.y = 3;
      cap.addChild(capText);
      cap.x = T / 2 - cap.width - 8;
      cap.y = -T / 2 + 8;
      slot.cap = cap;
      slot.container.addChild(cap);
    }
  }

  private drawRing(slot: Slot) {
    const T = this.actualSize;
    const p = this.palette;
    slot.ring.clear();
    if (slot.selected > 0.01) {
      const alpha = Math.min(1, slot.selected);
      slot.ring
        .roundRect(-3, -3, T + 6, T + 6, RADIUS + 3)
        .stroke({ color: p.ring, width: 3, alpha });
    } else if (slot.hover > 0.01) {
      slot.ring
        .roundRect(-1, -1, T + 2, T + 2, RADIUS + 1)
        .stroke({ color: p.ringSoft, width: 1.5, alpha: 0.6 * slot.hover });
    }
  }

  private refreshChips(slot: Slot) {
    const wantSource = slot.tile.source === 'import' ? 'IMPORT' : slot.tile.source === 'favorite' ? 'FAV' : 'GEN';
    if (slot.chipText.text !== wantSource) {
      slot.chipText.text = wantSource;
      this.drawTileChrome(slot);
      return;
    }
    const nWant = slot.tile.tags?.length ?? 0;
    const nHave = slot.cap
      ? Number(((slot.cap.children[1] as Text)?.text ?? '0').replace(/[^\d]/g, '')) || 0
      : 0;
    if (nWant !== nHave) this.drawTileChrome(slot);
  }

  private refreshTexture(slot: Slot) {
    const url = slot.tile.thumbnailUrl;
    if (!url || url === slot.textureUrl || url === slot.loadingUrl) return;
    slot.loadingUrl = url;
    // Load via HTMLImageElement so we can display any URL the browser can
    // fetch — ComfyUI's `/view?…` URLs lack file extensions and trip up
    // Pixi's URL-based parser detection. `crossOrigin = 'anonymous'` is
    // required for WebGL upload to avoid a tainted-texture error on
    // cross-origin sources; blob: URLs ignore it.
    const img = new Image();
    if (!url.startsWith('blob:')) img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (this.disposed) return;
      if (slot.loadingUrl !== url) return;        // superseded
      if (!this.slots.has(slot.id)) return;       // tile removed
      slot.textureUrl = url;
      const tex = Texture.from(img);
      if (slot.sprite) {
        slot.sprite.texture = tex;
      } else {
        const sp = new Sprite(tex);
        slot.sprite = sp;
        slot.imageHolder.addChildAt(sp, 0);
      }
      this.fitSpriteToTile(slot);
    };
    img.onerror = () => { /* leave placeholder bg */ };
    img.src = url;
  }

  private fitSpriteToTile(slot: Slot) {
    const sp = slot.sprite;
    if (!sp || !sp.texture) return;
    const T = this.actualSize;
    const tw = sp.texture.width;
    const th = sp.texture.height;
    if (tw <= 0 || th <= 0) return;
    // object-cover: scale so the smaller dimension fills T, crop the rest.
    const scale = Math.max(T / tw, T / th);
    sp.anchor.set(0.5);
    sp.scale.set(scale);
    sp.position.set(T / 2, T / 2);

    // mask to rounded rect so the sprite respects the tile shape.
    let mask = slot.imageHolder.mask as Graphics | null;
    if (!mask) {
      mask = new Graphics();
      slot.imageHolder.addChild(mask);
      slot.imageHolder.mask = mask;
    }
    mask.clear().roundRect(0, 0, T, T, RADIUS).fill({ color: 0xffffff });
  }

  // ── layout ──

  private relayout(immediate: boolean) {
    if (!this.inited) return;
    const w = this.host.clientWidth;
    // The slider sets a *target* tile size; pick the column count whose
    // resulting tile width is closest to that target, then expand each
    // tile to fill the row exactly (no side padding gaps).
    const target = this.tileSize;
    const inner = Math.max(1, w - 2 * PAD);
    const nextCols = Math.max(1, Math.round((inner + GAP) / (target + GAP)));
    const colsChanged = nextCols !== this.cols;
    this.cols = nextCols;
    const T = Math.max(40, (inner - (this.cols - 1) * GAP) / this.cols);
    const sizeChanged = Math.abs(T - this.actualSize) > 0.5;
    this.actualSize = T;

    const rowStride = T + GAP;
    const totalRows = Math.ceil(this.tiles.length / this.cols);
    this.contentHeight = totalRows > 0 ? PAD + totalRows * rowStride - GAP + PAD : 0;

    for (let i = 0; i < this.tiles.length; i++) {
      const tile = this.tiles[i];
      const slot = this.slots.get(tile.id);
      if (!slot) continue;
      const col = i % this.cols;
      const row = Math.floor(i / this.cols);
      slot.targetX = PAD + col * (T + GAP) + T / 2;
      slot.targetY = PAD + row * rowStride + T / 2;
      if (immediate) {
        slot.curX = slot.targetX;
        slot.curY = slot.targetY;
      }
    }

    if (sizeChanged) {
      for (const slot of this.slots.values()) {
        this.drawTileChrome(slot);
        this.fitSpriteToTile(slot);
      }
    }

    const maxScroll = Math.max(0, this.contentHeight - this.host.clientHeight);
    if (this.scrollTarget > maxScroll) this.scrollTarget = maxScroll;
    if (this.scrollY > maxScroll) this.scrollY = maxScroll;

    if (colsChanged) this.handlers.onColsChange?.(this.cols);
  }

  // ── tick ──

  onTick = () => {
    if (this.disposed) return;
    // smooth scroll
    const dy = this.scrollTarget - this.scrollY;
    if (Math.abs(dy) > 0.1) this.scrollY += dy * 0.28;
    else this.scrollY = this.scrollTarget;
    this.world.y = -this.scrollY;

    // per-slot animations
    for (const slot of this.slots.values()) {
      // layout spring
      const dx = slot.targetX - slot.curX;
      const dyy = slot.targetY - slot.curY;
      if (Math.abs(dx) > 0.05 || Math.abs(dyy) > 0.05) {
        slot.curX += dx * SPRING;
        slot.curY += dyy * SPRING;
      } else {
        slot.curX = slot.targetX;
        slot.curY = slot.targetY;
      }

      // hover lerp
      const wantHover = (this.hoveredId === slot.id && !this.draggingForPan) ? 1 : 0;
      slot.hover += (wantHover - slot.hover) * 0.18;

      // selected lerp
      const wantSelected = (this.selectedId === slot.id) ? 1 : 0;
      slot.selected += (wantSelected - slot.selected) * 0.22;

      // compose transform — soft lift only. The earlier "dim siblings"
      // effect flashed during cross-gap mouse moves (every tile briefly
      // un-dimmed on the in-between frame where hoveredId went null), so
      // we rely on the scale alone to telegraph focus.
      const liftScale = 1 + (HOVER_LIFT - 1) * slot.hover + (SELECTED_LIFT - 1) * slot.selected;
      slot.container.position.set(slot.curX, slot.curY);
      slot.container.scale.set(liftScale);
      slot.container.skew.set(0, 0);
      slot.container.alpha = 1;

      // ring needs to be redrawn as alpha changes
      if (slot.hover > 0.005 || slot.selected > 0.005) this.drawRing(slot);
      else if ((slot as any)._ringDrawn !== false) {
        slot.ring.clear();
        (slot as any)._ringDrawn = false;
      }
      if (slot.hover > 0.005 || slot.selected > 0.005) (slot as any)._ringDrawn = true;

      // keep hovered or selected slots on top so the lift doesn't get clipped
      // by neighbours; the cheap way is z-order via swapping into hoverLayer.
      const wantHoverLayer = (slot === this.topSlot());
      const parent = slot.container.parent;
      const targetParent = wantHoverLayer ? this.hoverLayer : this.tilesLayer;
      if (parent !== targetParent) {
        targetParent.addChild(slot.container);
      }
    }
  };

  private topSlot(): Slot | null {
    if (this.hoveredId) return this.slots.get(this.hoveredId) ?? null;
    if (this.selectedId) return this.slots.get(this.selectedId) ?? null;
    return null;
  }

  // ── input ──

  private attachInput() {
    const h = this.host;
    h.addEventListener('pointerdown', this.onPointerDown);
    h.addEventListener('pointermove', this.onPointerMove);
    h.addEventListener('pointerup', this.onPointerUp);
    h.addEventListener('pointercancel', this.onPointerUp);
    h.addEventListener('pointerleave', this.onPointerLeave);
    h.addEventListener('wheel', this.onWheel, { passive: false });
  }
  private detachInput() {
    const h = this.host;
    h.removeEventListener('pointerdown', this.onPointerDown);
    h.removeEventListener('pointermove', this.onPointerMove);
    h.removeEventListener('pointerup', this.onPointerUp);
    h.removeEventListener('pointercancel', this.onPointerUp);
    h.removeEventListener('pointerleave', this.onPointerLeave);
    h.removeEventListener('wheel', this.onWheel);
  }

  private clientToLocal(clientX: number, clientY: number) {
    const rect = this.host.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top + this.scrollY };
  }

  private hitTile(localX: number, localY: number): Slot | null {
    const T = this.actualSize;
    for (const slot of this.slots.values()) {
      const dx = localX - slot.targetX;
      const dy = localY - slot.targetY;
      if (Math.abs(dx) <= T / 2 && Math.abs(dy) <= T / 2) return slot;
    }
    return null;
  }

  onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.cancelInertia?.();
    this.cancelInertia = null;
    this.host.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: 0 });
    this.tracker.reset(e.clientX, e.clientY);
    this.draggingForPan = false;
  };

  onPointerMove = (e: PointerEvent) => {
    const local = this.clientToLocal(e.clientX, e.clientY);
    this.pointerLocal = local;

    // update hover (mouse only — touch hover is misleading)
    if (e.pointerType !== 'touch' && !this.draggingForPan) {
      const hit = this.hitTile(local.x, local.y);
      this.hoveredId = hit ? hit.id : null;
    }

    const p = this.pointers.get(e.pointerId);
    if (!p) return;

    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    const totalMoved = Math.hypot(e.clientX - p.startX, e.clientY - p.startY);
    p.moved = totalMoved;
    p.x = e.clientX;
    p.y = e.clientY;
    this.tracker.sample(e.clientX, e.clientY);

    if (!this.draggingForPan && totalMoved > 6) {
      this.draggingForPan = true;
      this.hoveredId = null;
    }
    if (this.draggingForPan) {
      const maxScroll = Math.max(0, this.contentHeight - this.host.clientHeight);
      this.scrollTarget = clamp(this.scrollTarget - dy, 0, maxScroll);
      this.scrollY = this.scrollTarget; // immediate while dragging
      // pan horizontally? no — vertical-only feels more like a typical gallery.
      void dx;
    }
  };

  onPointerUp = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.host.hasPointerCapture(e.pointerId)) this.host.releasePointerCapture(e.pointerId);
    if (!p) return;

    if (this.draggingForPan) {
      const v: Vec = this.tracker.release();
      // inertia along Y only
      if (Math.abs(v.y) > 0.05) {
        const maxScroll = Math.max(0, this.contentHeight - this.host.clientHeight);
        this.cancelInertia = runInertia(v, (_dx, dyy) => {
          this.scrollTarget = clamp(this.scrollTarget - dyy, 0, maxScroll);
          this.scrollY = this.scrollTarget;
        }, { decayPerFrame: 0.93 });
      }
      this.draggingForPan = false;
      return;
    }

    // treat as click
    const local = this.clientToLocal(e.clientX, e.clientY);
    const hit = this.hitTile(local.x, local.y);
    if (!hit) return;
    this.handlers.onTileClick(hit.id);
  };

  onPointerLeave = () => {
    if (!this.draggingForPan) this.hoveredId = null;
    this.pointerLocal = null;
  };

  onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const maxScroll = Math.max(0, this.contentHeight - this.host.clientHeight);
    if (maxScroll <= 0) return;
    this.cancelInertia?.();
    this.cancelInertia = null;
    // unify wheel + trackpad units roughly (LINE → ~16px)
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.scrollTarget = clamp(this.scrollTarget + px, 0, maxScroll);
  };
}

// ─── helpers ────────────────────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function hexToNum(hex: string, fallback: number): number {
  const m = hex.match(/^#([0-9a-fA-F]{3,8})$/);
  if (!m) return fallback;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6); // drop alpha
  if (h.length !== 6) return fallback;
  return parseInt(h, 16);
}

function pickPalette(): Palette {
  return {
    bg:       hexToNum(cssVar('--color-bg-base',       '#070A10'), 0x070A10),
    tileBg:   hexToNum(cssVar('--color-bg-elev',       '#11192A'), 0x11192A),
    ring:     hexToNum(cssVar('--color-accent',        '#3B6FE0'), 0x3B6FE0),
    ringSoft: hexToNum(cssVar('--color-border-bright', '#3A4759'), 0x3A4759),
    chipBg:   hexToNum(cssVar('--color-bg-elev',       '#11192A'), 0x11192A),
    chipFg:   hexToNum(cssVar('--color-fg-tertiary',   '#9CA8BD'), 0x9CA8BD),
    capBg:    hexToNum(cssVar('--color-accent-soft',   '#1A2D52'), 0x1A2D52),
    capFg:    hexToNum(cssVar('--color-accent-fg',     '#9CB4EA'), 0x9CB4EA),
    shadow:   0x000000,
  };
}
