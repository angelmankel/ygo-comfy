/**
 * Coverflow / "fan" view for the Collections panel.
 *
 * Centers a single focused image in front, with neighbouring images peeking
 * out on either side along a gentle arc. Arrow keys (← →) advance focus
 * left/right; horizontal drag/swipe scrubs through; tap on a side tile
 * focuses it; tap on the centered tile fires `onTileClick` (the parent
 * opens the fullscreen viewer).
 *
 * Pure Pixi v8 render, same shape as PixiCollectionsGrid — React wrapper
 * around an imperative controller so re-renders don't churn the GPU work.
 */
import { useEffect, useRef } from 'react';
import {
  Application,
  Container,
  Graphics,
  Sprite,
  Texture,
} from 'pixi.js';
import type { Tile } from './useCollectionTiles';
import { createVelocityTracker, type Vec } from '@/lib/momentum';
import { useStore } from '@/lib/store';

type Props = {
  tiles: Tile[];
  selectedId: string | null;
  onTileClick: (id: string) => void;
};

const SPACING_RATIO = 0.32;   // gap between fan tiles, as fraction of card size
const STEP_ANGLE = 0.11;      // radians of tilt per tile away from center
const SIDE_SCALE = 0.78;      // scale of the first side tile (each step shrinks further)
const SIDE_DIM = 0.55;        // alpha of distant tiles
const MAX_VISIBLE = 6;        // tiles fanned on each side; further ones hide
const RADIUS = 14;
const SPRING = 0.18;

export function PixiCollectionsFan({ tiles, selectedId, onTileClick }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const ctrlRef = useRef<FanController | null>(null);
  const themeId = useStore((s) => s.themeId);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ctrl = new FanController(host);
    ctrlRef.current = ctrl;
    void ctrl.init();
    return () => {
      ctrlRef.current = null;
      ctrl.dispose();
    };
  }, []);

  useEffect(() => { ctrlRef.current?.setTiles(tiles); }, [tiles]);
  useEffect(() => { ctrlRef.current?.setSelected(selectedId); }, [selectedId]);
  useEffect(() => { ctrlRef.current?.setOnTileClick(onTileClick); }, [onTileClick]);
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

type Palette = { bg: number; tileBg: number; ring: number };

type Slot = {
  id: string;
  tile: Tile;
  container: Container;
  bg: Graphics;
  ring: Graphics;
  imageHolder: Container;
  sprite: Sprite | null;
  textureUrl: string;
  loadingUrl: string;
  /** Rendered tile size in pixels, fit to image aspect ratio within the
   *  cardSize box. Defaults to square cardSize until the texture loads. */
  tileW: number;
  tileH: number;
  // animated transform
  curX: number;
  curY: number;
  curScale: number;
  curRot: number;
  curAlpha: number;
  hide: boolean;
};

class FanController {
  host: HTMLDivElement;
  app: Application = new Application();
  inited = false;
  disposed = false;

  world = new Container();
  tilesLayer = new Container();

  tiles: Tile[] = [];
  slots = new Map<string, Slot>();
  selectedId: string | null = null;
  onTileClick: (id: string) => void = () => {};

  /** Fractional focus index — integer when settled, but drag scrubs through
   *  decimals so neighbour tiles slide smoothly into position. */
  focus = 0;
  focusTarget = 0;
  /** Available box for the focused tile. Side tiles inherit this max box
   *  and scale down via the SIDE_SCALE/STEP_ANGLE constants. */
  boxW = 320;
  boxH = 320;

  // drag
  tracker = createVelocityTracker();
  dragging = false;
  dragMoved = 0;
  dragStartFocus = 0;
  pointerDownClientX = 0;
  pointerDownClientY = 0;

  ro: ResizeObserver | null = null;
  palette: Palette = pickPalette();

  constructor(host: HTMLDivElement) { this.host = host; }

  async init() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    await this.app.init({
      width: w,
      height: h,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      resizeTo: this.host,
      backgroundAlpha: 0,
    });
    if (this.disposed) {
      this.app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true });
      return;
    }
    this.inited = true;
    this.host.appendChild(this.app.canvas);
    Object.assign(this.app.canvas.style, { display: 'block', width: '100%', height: '100%' });

    this.world.addChild(this.tilesLayer);
    this.app.stage.addChild(this.world);

    this.ro = new ResizeObserver(() => this.recomputeSize());
    this.ro.observe(this.host);
    this.recomputeSize();

    this.attachInput();
    this.app.ticker.add(this.onTick);

    this.rebuildSlots();
    this.snapTo(this.focusForSelected(), true);
  }

  dispose() {
    this.disposed = true;
    if (!this.inited) return;
    this.detachInput();
    this.app.ticker.remove(this.onTick);
    this.ro?.disconnect();
    try {
      this.app.destroy(
        { removeView: true, releaseGlobalResources: true },
        { children: true, texture: false, textureSource: false },
      );
    } catch { /* ignore double destroy */ }
  }

  // ── setters ──

  setTiles(tiles: Tile[]) {
    this.tiles = tiles;
    if (!this.inited) return;
    this.rebuildSlots();
    const f = this.focusForSelected();
    if (Math.abs(f - this.focusTarget) > tiles.length / 2) this.snapTo(f, true);
    else this.focusTarget = clamp(f, 0, Math.max(0, tiles.length - 1));
  }

  setSelected(id: string | null) {
    this.selectedId = id;
    if (!this.inited) return;
    this.focusTarget = this.focusForSelected();
  }

  setOnTileClick(fn: (id: string) => void) { this.onTileClick = fn; }

  refreshPalette() {
    this.palette = pickPalette();
    if (!this.inited) return;
    for (const slot of this.slots.values()) this.drawTileChrome(slot);
  }

  // ── layout / sizing ──

  private recomputeSize() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    // The focused tile fills most of the canvas; side peeks come from
    // overflow on either edge (~14% per side). Vertically we leave a tiny
    // breathing strip top + bottom so the bottom row of the toolbar doesn't
    // crash into the tile.
    this.boxW = Math.max(160, w * 0.72);
    this.boxH = Math.max(160, h * 0.94);
    for (const slot of this.slots.values()) {
      this.recomputeSlotSize(slot);
      this.drawTileChrome(slot);
      this.fitSpriteToTile(slot);
    }
  }

  /** Fit the slot to the image's aspect ratio, expanded to fill the
   *  available box on whichever axis is limiting. Square fallback until
   *  the texture loads. */
  private recomputeSlotSize(slot: Slot) {
    const tex = slot.sprite?.texture;
    if (!tex || tex.width <= 0 || tex.height <= 0) {
      const fallback = Math.min(this.boxW, this.boxH);
      slot.tileW = fallback;
      slot.tileH = fallback;
      return;
    }
    const aspect = tex.width / tex.height;       // > 1: landscape, < 1: portrait
    const boxAspect = this.boxW / this.boxH;
    if (aspect >= boxAspect) {
      // Image is wider than the box → width-limited.
      slot.tileW = this.boxW;
      slot.tileH = this.boxW / aspect;
    } else {
      // Image is taller than the box → height-limited.
      slot.tileW = this.boxH * aspect;
      slot.tileH = this.boxH;
    }
  }

  private focusForSelected(): number {
    if (!this.selectedId) return clamp(this.focusTarget, 0, Math.max(0, this.tiles.length - 1));
    const idx = this.tiles.findIndex((t) => t.id === this.selectedId);
    if (idx < 0) return clamp(this.focusTarget, 0, Math.max(0, this.tiles.length - 1));
    return idx;
  }

  private snapTo(idx: number, immediate: boolean) {
    this.focusTarget = clamp(idx, 0, Math.max(0, this.tiles.length - 1));
    if (immediate) this.focus = this.focusTarget;
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
      } else {
        const slot = this.createSlot(tile);
        this.slots.set(tile.id, slot);
        this.tilesLayer.addChild(slot.container);
      }
    }
    for (const [id, slot] of this.slots) {
      if (!seen.has(id)) {
        this.tilesLayer.removeChild(slot.container);
        slot.container.destroy({ children: true });
        this.slots.delete(id);
      }
    }
  }

  private createSlot(tile: Tile): Slot {
    const container = new Container();
    container.eventMode = 'none';
    const bg = new Graphics();
    const imageHolder = new Container();
    const ring = new Graphics();
    container.addChild(bg);
    container.addChild(imageHolder);
    container.addChild(ring);

    const slot: Slot = {
      id: tile.id,
      tile,
      container,
      bg,
      ring,
      imageHolder,
      sprite: null,
      textureUrl: '',
      loadingUrl: '',
      tileW: Math.min(this.boxW, this.boxH),
      tileH: Math.min(this.boxW, this.boxH),
      curX: this.host.clientWidth / 2,
      curY: this.host.clientHeight / 2,
      curScale: 0,
      curRot: 0,
      curAlpha: 0,
      hide: true,
    };
    container.alpha = 0;
    container.scale.set(0);
    this.drawTileChrome(slot);
    this.refreshTexture(slot);
    return slot;
  }

  private drawTileChrome(slot: Slot) {
    const W = slot.tileW;
    const H = slot.tileH;
    slot.bg.clear();
    slot.bg.roundRect(0, 0, W, H, RADIUS).fill({ color: this.palette.tileBg });
    slot.bg.pivot.set(W / 2, H / 2);
    slot.imageHolder.pivot.set(W / 2, H / 2);
    slot.ring.clear();
    slot.ring.pivot.set(W / 2, H / 2);
  }

  private drawSelectedRing(slot: Slot, focused: boolean) {
    slot.ring.clear();
    if (!focused) return;
    slot.ring
      .roundRect(-4, -4, slot.tileW + 8, slot.tileH + 8, RADIUS + 4)
      .stroke({ color: this.palette.ring, width: 3, alpha: 0.85 });
  }

  private refreshTexture(slot: Slot) {
    const url = slot.tile.thumbnailUrl;
    if (!url || url === slot.textureUrl || url === slot.loadingUrl) return;
    slot.loadingUrl = url;
    const img = new Image();
    if (!url.startsWith('blob:')) img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (this.disposed) return;
      if (slot.loadingUrl !== url) return;
      if (!this.slots.has(slot.id)) return;
      slot.textureUrl = url;
      const tex = Texture.from(img);
      if (slot.sprite) {
        slot.sprite.texture = tex;
      } else {
        const sp = new Sprite(tex);
        slot.sprite = sp;
        slot.imageHolder.addChildAt(sp, 0);
      }
      this.recomputeSlotSize(slot);
      this.drawTileChrome(slot);
      this.fitSpriteToTile(slot);
    };
    img.onerror = () => { /* placeholder bg */ };
    img.src = url;
  }

  private fitSpriteToTile(slot: Slot) {
    const sp = slot.sprite;
    if (!sp || !sp.texture) return;
    const W = slot.tileW;
    const H = slot.tileH;
    const tw = sp.texture.width;
    const th = sp.texture.height;
    if (tw <= 0 || th <= 0) return;
    // Fit (contain) — tile dimensions already match image aspect, so width
    // and height scales agree, but Math.min is the right safety floor.
    const scale = Math.min(W / tw, H / th);
    sp.anchor.set(0.5);
    sp.scale.set(scale);
    sp.position.set(W / 2, H / 2);

    let mask = slot.imageHolder.mask as Graphics | null;
    if (!mask) {
      mask = new Graphics();
      slot.imageHolder.addChild(mask);
      slot.imageHolder.mask = mask;
    }
    mask.clear().roundRect(0, 0, W, H, RADIUS).fill({ color: 0xffffff });
  }

  // ── tick ──

  onTick = () => {
    if (this.disposed) return;

    // focus spring
    const df = this.focusTarget - this.focus;
    if (Math.abs(df) > 0.0005) this.focus += df * 0.22;
    else this.focus = this.focusTarget;

    const cx = this.host.clientWidth / 2;
    const cy = this.host.clientHeight / 2;
    // Spacing tracks the focused tile's width so portraits get tighter
    // side gaps than landscapes — keeps the fan visually balanced.
    const focusedSlot = this.tiles[Math.round(this.focus)]
      ? this.slots.get(this.tiles[Math.round(this.focus)].id)
      : null;
    const focusedW = focusedSlot?.tileW ?? this.boxW;
    const spacing = focusedW * SPACING_RATIO + focusedW * 0.4;

    // First pass: compute target transforms and sort by z (depth).
    const renderOrder: { slot: Slot; depth: number }[] = [];
    for (let i = 0; i < this.tiles.length; i++) {
      const tile = this.tiles[i];
      const slot = this.slots.get(tile.id);
      if (!slot) continue;
      const offset = i - this.focus;
      const abs = Math.abs(offset);
      const tooFar = abs > MAX_VISIBLE;

      let targetX = cx + Math.sign(offset) * (spacing * 0.6 + (abs - 1) * spacing * 0.45) * (abs > 0 ? 1 : 0);
      // smoother near-center positioning so dragging across the focus point
      // doesn't have a discontinuity
      const t = clamp(offset, -1, 1);
      const nearX = cx + t * spacing * 0.6;
      const lerp = Math.min(1, abs);
      targetX = lerp * targetX + (1 - lerp) * nearX;

      const targetY = cy;
      const targetScale = Math.max(0.18, Math.pow(SIDE_SCALE, abs));
      const targetRot = clamp(offset, -3, 3) * STEP_ANGLE * (abs > 0 ? 1 : 0);
      // alpha falls off with distance; tooFar slots fade out and skip render
      let targetAlpha = tooFar ? 0 : (abs === 0 ? 1 : Math.max(SIDE_DIM, 1 - abs * 0.12));

      slot.hide = tooFar && Math.abs(targetAlpha - slot.curAlpha) < 0.01 && slot.curAlpha < 0.02;

      // animate
      slot.curX += (targetX - slot.curX) * SPRING;
      slot.curY += (targetY - slot.curY) * SPRING;
      slot.curScale += (targetScale - slot.curScale) * SPRING;
      slot.curRot += (targetRot - slot.curRot) * SPRING;
      slot.curAlpha += (targetAlpha - slot.curAlpha) * SPRING;

      slot.container.visible = !slot.hide;
      slot.container.position.set(slot.curX, slot.curY);
      slot.container.scale.set(slot.curScale);
      slot.container.rotation = slot.curRot;
      slot.container.alpha = slot.curAlpha;

      // z-order: front-most has highest priority; further from focus = behind
      renderOrder.push({ slot, depth: -abs });
      this.drawSelectedRing(slot, abs < 0.5);
    }

    // Sort so the focused tile renders last (on top), and symmetric neighbours
    // alternate around it.
    renderOrder.sort((a, b) => a.depth - b.depth);
    for (let i = 0; i < renderOrder.length; i++) {
      this.tilesLayer.setChildIndex(renderOrder[i].slot.container, i);
    }
  };

  // ── input ──

  private attachInput() {
    const h = this.host;
    h.addEventListener('pointerdown', this.onPointerDown);
    h.addEventListener('pointermove', this.onPointerMove);
    h.addEventListener('pointerup', this.onPointerUp);
    h.addEventListener('pointercancel', this.onPointerUp);
    h.addEventListener('wheel', this.onWheel, { passive: false });
  }
  private detachInput() {
    const h = this.host;
    h.removeEventListener('pointerdown', this.onPointerDown);
    h.removeEventListener('pointermove', this.onPointerMove);
    h.removeEventListener('pointerup', this.onPointerUp);
    h.removeEventListener('pointercancel', this.onPointerUp);
    h.removeEventListener('wheel', this.onWheel);
  }

  onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.host.setPointerCapture(e.pointerId);
    this.dragging = true;
    this.dragMoved = 0;
    this.dragStartFocus = this.focusTarget;
    this.pointerDownClientX = e.clientX;
    this.pointerDownClientY = e.clientY;
    this.tracker.reset(e.clientX, e.clientY);
  };

  onPointerMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const dx = e.clientX - this.pointerDownClientX;
    const dy = e.clientY - this.pointerDownClientY;
    this.dragMoved = Math.hypot(dx, dy);
    this.tracker.sample(e.clientX, e.clientY);

    // Scrub focus by horizontal drag distance. One card-width drag ≈ one
    // tile of focus shift.
    const perTile = this.boxW * 0.9;
    const focusDelta = -dx / perTile;
    const next = clamp(
      this.dragStartFocus + focusDelta,
      0, Math.max(0, this.tiles.length - 1),
    );
    this.focusTarget = next;
  };

  onPointerUp = (e: PointerEvent) => {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.host.hasPointerCapture(e.pointerId)) this.host.releasePointerCapture(e.pointerId);

    // Tap vs drag
    if (this.dragMoved < 6) {
      // Treat as a click on whichever tile is under the pointer.
      const hit = this.hitTile(e.clientX, e.clientY);
      if (hit) {
        const idx = this.tiles.findIndex((t) => t.id === hit.id);
        const focusedIdx = Math.round(this.focus);
        if (idx === focusedIdx) {
          // Tap on the centered tile → activate.
          this.onTileClick(hit.id);
        } else {
          // Tap on a side tile → focus it.
          this.snapTo(idx, false);
          this.onTileClick(hit.id);    // also selects the tile via parent state
        }
      }
      return;
    }

    // Flick: snap to integer, with a little extra step from velocity.
    const v: Vec = this.tracker.release();
    const perTile = this.boxW * 0.9;
    // velocity in px/ms → tiles/ms. A flick of ~1.5 px/ms ≈ one extra tile.
    const extra = clamp(-v.x * 220 / perTile, -3, 3);
    const targetIdx = Math.round(this.focus + extra);
    this.snapTo(targetIdx, false);
    const next = this.tiles[clamp(targetIdx, 0, this.tiles.length - 1)];
    if (next) this.onTileClick(next.id);  // keep the parent's selectedId in sync
  };

  onWheel = (e: WheelEvent) => {
    // Trackpad horizontal scroll OR vertical wheel both advance focus by one.
    e.preventDefault();
    const axis = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(axis) < 4) return;
    const dir = Math.sign(axis);
    const next = clamp(Math.round(this.focusTarget) + dir, 0, Math.max(0, this.tiles.length - 1));
    if (next === this.focusTarget) return;
    this.snapTo(next, false);
    const tile = this.tiles[next];
    if (tile) this.onTileClick(tile.id);
  };

  // ── hit testing ──

  private hitTile(clientX: number, clientY: number): Slot | null {
    const rect = this.host.getBoundingClientRect();
    const lx = clientX - rect.left;
    const ly = clientY - rect.top;
    // Walk slots back-to-front; first hit wins. The on-screen container
    // transform is up-to-date from the last tick, so we use slot.curX/curY
    // plus the current scale to define a rough AABB.
    const sorted = [...this.slots.values()]
      .filter((s) => s.curAlpha > 0.1)
      .sort((a, b) => b.container.zIndex - a.container.zIndex);
    // Build a quick z-priority by container index; tiles are sorted into
    // depth order each tick (front = last child).
    sorted.sort((a, b) => this.tilesLayer.getChildIndex(b.container) - this.tilesLayer.getChildIndex(a.container));
    for (const slot of sorted) {
      const halfW = (slot.tileW * slot.curScale) / 2;
      const halfH = (slot.tileH * slot.curScale) / 2;
      if (Math.abs(lx - slot.curX) <= halfW && Math.abs(ly - slot.curY) <= halfH) {
        return slot;
      }
    }
    return null;
  }
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
  if (h.length === 8) h = h.slice(0, 6);
  if (h.length !== 6) return fallback;
  return parseInt(h, 16);
}

function pickPalette(): Palette {
  return {
    bg:     hexToNum(cssVar('--color-bg-base', '#070A10'), 0x070A10),
    tileBg: hexToNum(cssVar('--color-bg-elev', '#11192A'), 0x11192A),
    ring:   hexToNum(cssVar('--color-accent',  '#3B6FE0'), 0x3B6FE0),
  };
}
