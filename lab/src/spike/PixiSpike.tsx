/**
 * PixiJS v8 render-loop spike — ticket #19 — THROW-AWAY CODE.
 *
 * Standalone prototype mounted via `?spike=pixi`. Toggles between a PixiJS
 * renderer and a stripped-down 2D-canvas reference, both drawing the same N
 * sprites with the same pan/zoom/momentum behaviour so FPS can be compared.
 *
 * Not wired into the main app store or controller. Pure local React state.
 */

import { useEffect, useRef, useState } from 'react';
import { Application, Container, Sprite, Texture } from 'pixi.js';
import { createVelocityTracker, runInertia, type Vec } from '@/lib/momentum';

type Renderer = 'pixi' | 'canvas2d';

type SpriteSpec = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  tint: number;
};

// -- procedural source bitmap ------------------------------------------------

const SOURCE_SIZE = 2048;

function buildSourceBitmap(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = SOURCE_SIZE;
  c.height = SOURCE_SIZE;
  const ctx = c.getContext('2d')!;

  // colorful radial gradient base
  const g = ctx.createRadialGradient(
    SOURCE_SIZE / 2, SOURCE_SIZE / 2, 64,
    SOURCE_SIZE / 2, SOURCE_SIZE / 2, SOURCE_SIZE * 0.7,
  );
  g.addColorStop(0, '#ff5577');
  g.addColorStop(0.3, '#ffaa33');
  g.addColorStop(0.6, '#4488ff');
  g.addColorStop(1, '#221144');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SOURCE_SIZE, SOURCE_SIZE);

  // ring grid so rotation/scale read at a glance
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 4;
  for (let r = 64; r < SOURCE_SIZE; r += 128) {
    ctx.beginPath();
    ctx.arc(SOURCE_SIZE / 2, SOURCE_SIZE / 2, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // sparse noise speckle
  const img = ctx.getImageData(0, 0, SOURCE_SIZE, SOURCE_SIZE);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (Math.random() < 0.01) {
      const v = Math.floor(Math.random() * 80);
      d[i] = Math.min(255, d[i] + v);
      d[i + 1] = Math.min(255, d[i + 1] + v);
      d[i + 2] = Math.min(255, d[i + 2] + v);
    }
  }
  ctx.putImageData(img, 0, 0);

  // corner labels for orientation
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 120px sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('TL', 40, 40);
  ctx.textAlign = 'right';
  ctx.fillText('TR', SOURCE_SIZE - 40, 40);
  ctx.textBaseline = 'bottom';
  ctx.fillText('BR', SOURCE_SIZE - 40, SOURCE_SIZE - 40);
  ctx.textAlign = 'left';
  ctx.fillText('BL', 40, SOURCE_SIZE - 40);

  return c;
}

// -- sprite specs ------------------------------------------------------------

function generateSpecs(n: number, w: number, h: number): SpriteSpec[] {
  const out: SpriteSpec[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: Math.random() * w * 1.5 - w * 0.25,
      y: Math.random() * h * 1.5 - h * 0.25,
      scale: 0.05 + Math.random() * 0.2, // source is 2048; 0.05..0.25 → 100..512 px
      rotation: Math.random() * Math.PI * 2,
      tint: Math.floor(Math.random() * 0xffffff),
    });
  }
  return out;
}

// -- view state (pan/zoom) ---------------------------------------------------

type View = { x: number; y: number; scale: number };

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;

function clampScale(s: number) { return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s)); }

// -- main component ----------------------------------------------------------

export default function PixiSpike() {
  const [renderer, setRenderer] = useState<Renderer>('pixi');
  const [count, setCount] = useState(20);
  const [fps, setFps] = useState(0);
  const [zoom, setZoom] = useState(1);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<View>({ x: 0, y: 0, scale: 1 });
  const specsRef = useRef<SpriteSpec[]>([]);
  const sourceBitmapRef = useRef<HTMLCanvasElement | null>(null);
  const throwTriggerRef = useRef<((v: Vec) => void) | null>(null);

  // build the source bitmap once
  if (!sourceBitmapRef.current) sourceBitmapRef.current = buildSourceBitmap();

  // regenerate specs whenever count changes (keep view as-is)
  useEffect(() => {
    const w = hostRef.current?.clientWidth ?? window.innerWidth;
    const h = hostRef.current?.clientHeight ?? window.innerHeight;
    specsRef.current = generateSpecs(count, w, h);
  }, [count]);

  // mount the chosen renderer
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!specsRef.current.length) {
      specsRef.current = generateSpecs(count, w, h);
    }

    let cleanup: (() => void) | null = null;
    let cancelled = false;

    const onFps = (v: number) => setFps(v);
    const onZoom = (v: number) => setZoom(v);

    if (renderer === 'pixi') {
      mountPixi(host, specsRef.current, sourceBitmapRef.current!, viewRef, {
        onFps, onZoom, registerThrow: (fn) => { throwTriggerRef.current = fn; },
      }).then((teardown) => {
        if (cancelled) teardown();
        else cleanup = teardown;
      });
    } else {
      cleanup = mountCanvas2D(host, specsRef.current, sourceBitmapRef.current!, viewRef, {
        onFps, onZoom, registerThrow: (fn) => { throwTriggerRef.current = fn; },
      });
    }

    return () => {
      cancelled = true;
      throwTriggerRef.current = null;
      cleanup?.();
    };
    // re-mount on renderer change OR on count change (so the pixi sprite list rebuilds)
  }, [renderer, count]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a0a0f', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden', touchAction: 'none' }} />

      {/* top bar */}
      <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 12, alignItems: 'center', padding: '8px 12px', background: 'rgba(0,0,0,0.55)', borderRadius: 8, backdropFilter: 'blur(8px)', zIndex: 10 }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>Renderer</span>
          <button onClick={() => setRenderer('pixi')} style={btnStyle(renderer === 'pixi')}>PixiJS</button>
          <button onClick={() => setRenderer('canvas2d')} style={btnStyle(renderer === 'canvas2d')}>2D Canvas</button>
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
          <span style={{ opacity: 0.7 }}>N</span>
          <input
            type="range" min={1} max={100} value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            style={{ width: 160 }}
          />
          <span style={{ minWidth: 28, textAlign: 'right' }}>{count}</span>
        </label>
        <button
          onClick={() => {
            // strong random-direction throw
            const a = Math.random() * Math.PI * 2;
            const speed = 3.5; // px / ms (screen)
            throwTriggerRef.current?.({ x: Math.cos(a) * speed, y: Math.sin(a) * speed });
          }}
          style={btnStyle(false)}
        >
          Throw
        </button>
      </div>

      {/* HUD */}
      <div style={{ position: 'absolute', top: 12, right: 12, padding: '8px 12px', background: 'rgba(0,0,0,0.55)', borderRadius: 8, backdropFilter: 'blur(8px)', fontFamily: 'ui-monospace, monospace', fontSize: 12, lineHeight: 1.5, zIndex: 10 }}>
        <div>FPS: <b>{fps.toFixed(1)}</b></div>
        <div>Sprites: <b>{count}</b></div>
        <div>Renderer: <b>{renderer === 'pixi' ? 'PixiJS' : '2D Canvas'}</b></div>
        <div>Zoom: <b>{zoom.toFixed(2)}×</b></div>
      </div>
    </div>
  );
}

function btnStyle(active: boolean): React.CSSProperties {
  return {
    padding: '4px 10px',
    borderRadius: 6,
    border: '1px solid ' + (active ? '#88aaff' : 'rgba(255,255,255,0.15)'),
    background: active ? 'rgba(120,150,255,0.25)' : 'rgba(255,255,255,0.05)',
    color: '#fff',
    fontSize: 12,
    cursor: 'pointer',
  };
}

// -- shared input wiring -----------------------------------------------------

type MountCallbacks = {
  onFps: (v: number) => void;
  onZoom: (v: number) => void;
  registerThrow: (fn: (v: Vec) => void) => void;
};

/**
 * Attach pan / wheel-zoom / pinch / momentum to an element, mutating `viewRef`.
 * `requestDraw` is called every time the view changes so the renderer redraws.
 * Returns a cleanup fn.
 */
function attachInput(
  host: HTMLDivElement,
  viewRef: React.MutableRefObject<View>,
  requestDraw: () => void,
  registerThrow: (fn: (v: Vec) => void) => void,
): () => void {
  const tracker = createVelocityTracker();
  let cancelInertia: (() => void) | null = null;
  const stopInertia = () => { cancelInertia?.(); cancelInertia = null; };

  // multi-pointer state (for pinch)
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  let pinchCenter = { x: 0, y: 0 };

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    host.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stopInertia();

    if (pointers.size === 1) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      tracker.reset(e.clientX, e.clientY);
    } else if (pointers.size === 2) {
      dragging = false;
      const [a, b] = [...pointers.values()];
      pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y);
      pinchStartScale = viewRef.current.scale;
      const rect = host.getBoundingClientRect();
      pinchCenter = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1 && dragging) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      viewRef.current = { ...viewRef.current, x: viewRef.current.x + dx, y: viewRef.current.y + dy };
      tracker.sample(e.clientX, e.clientY);
      requestDraw();
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchStartDist > 0) {
        const target = clampScale(pinchStartScale * (dist / pinchStartDist));
        zoomAt(viewRef, pinchCenter.x, pinchCenter.y, target);
        requestDraw();
      }
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId);

    if (pointers.size === 0 && dragging) {
      dragging = false;
      const v = tracker.release();
      if (Math.hypot(v.x, v.y) > 0.1) {
        cancelInertia = runInertia(v, (dx, dy) => {
          viewRef.current = { ...viewRef.current, x: viewRef.current.x + dx, y: viewRef.current.y + dy };
          requestDraw();
        });
      }
    }
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    stopInertia();
    const rect = host.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const target = clampScale(viewRef.current.scale * factor);
    zoomAt(viewRef, cx, cy, target);
    requestDraw();
  };

  host.addEventListener('pointerdown', onPointerDown);
  host.addEventListener('pointermove', onPointerMove);
  host.addEventListener('pointerup', onPointerUp);
  host.addEventListener('pointercancel', onPointerUp);
  host.addEventListener('wheel', onWheel, { passive: false });

  registerThrow((v) => {
    stopInertia();
    cancelInertia = runInertia(v, (dx, dy) => {
      viewRef.current = { ...viewRef.current, x: viewRef.current.x + dx, y: viewRef.current.y + dy };
      requestDraw();
    }, { decayPerFrame: 0.92 });
  });

  return () => {
    host.removeEventListener('pointerdown', onPointerDown);
    host.removeEventListener('pointermove', onPointerMove);
    host.removeEventListener('pointerup', onPointerUp);
    host.removeEventListener('pointercancel', onPointerUp);
    host.removeEventListener('wheel', onWheel);
    stopInertia();
  };
}

function zoomAt(viewRef: React.MutableRefObject<View>, cx: number, cy: number, targetScale: number) {
  const v = viewRef.current;
  // world point under the cursor before zoom
  const wx = (cx - v.x) / v.scale;
  const wy = (cy - v.y) / v.scale;
  const nx = cx - wx * targetScale;
  const ny = cy - wy * targetScale;
  viewRef.current = { x: nx, y: ny, scale: targetScale };
}

// -- FPS sampler -------------------------------------------------------------

function makeFpsSampler(onFps: (v: number) => void) {
  const samples: number[] = [];
  let lastEmit = 0;
  let lastT = performance.now();
  return () => {
    const now = performance.now();
    const dt = now - lastT;
    lastT = now;
    if (dt > 0) {
      const fps = 1000 / dt;
      samples.push(fps);
      if (samples.length > 30) samples.shift();
    }
    if (now - lastEmit > 200) {
      lastEmit = now;
      const avg = samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length);
      onFps(avg);
    }
  };
}

// -- pixi mount --------------------------------------------------------------

async function mountPixi(
  host: HTMLDivElement,
  specs: SpriteSpec[],
  source: HTMLCanvasElement,
  viewRef: React.MutableRefObject<View>,
  cb: MountCallbacks,
): Promise<() => void> {
  const app = new Application();
  await app.init({
    width: host.clientWidth,
    height: host.clientHeight,
    background: '#0a0a0f',
    antialias: true,
    resolution: window.devicePixelRatio,
    autoDensity: true,
    resizeTo: host,
  });
  host.appendChild(app.canvas);

  // Texture from the procedural canvas. v8 still allows Texture.from(canvas)
  // for already-loaded sources (Assets.load is only mandatory for URLs).
  const texture = Texture.from(source);

  const world = new Container();
  app.stage.addChild(world);

  for (const s of specs) {
    const sp = new Sprite({
      texture,
      x: s.x,
      y: s.y,
      rotation: s.rotation,
      anchor: 0.5,
      scale: s.scale,
      tint: s.tint,
    });
    world.addChild(sp);
  }

  const sampleFps = makeFpsSampler(cb.onFps);

  // sync the world container to the view ref every frame
  const tickerCb = () => {
    const v = viewRef.current;
    world.position.set(v.x, v.y);
    world.scale.set(v.scale);
    cb.onZoom(v.scale);
    sampleFps();
  };
  app.ticker.add(tickerCb);

  // requestDraw is a no-op here because the ticker handles per-frame sync.
  const cleanupInput = attachInput(host, viewRef, () => { /* ticker handles it */ }, cb.registerThrow);

  return () => {
    cleanupInput();
    app.ticker.remove(tickerCb);
    app.destroy(
      { removeView: true, releaseGlobalResources: true },
      { children: true, texture: false, textureSource: false },
    );
  };
}

// -- 2D canvas reference -----------------------------------------------------

function mountCanvas2D(
  host: HTMLDivElement,
  specs: SpriteSpec[],
  source: HTMLCanvasElement,
  viewRef: React.MutableRefObject<View>,
  cb: MountCallbacks,
): () => void {
  const canvas = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  const resize = () => {
    canvas.width = host.clientWidth * dpr;
    canvas.height = host.clientHeight * dpr;
    canvas.style.width = host.clientWidth + 'px';
    canvas.style.height = host.clientHeight + 'px';
  };
  resize();
  host.appendChild(canvas);
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  const ctx = canvas.getContext('2d')!;
  const sampleFps = makeFpsSampler(cb.onFps);

  let raf = 0;
  const draw = () => {
    const v = viewRef.current;
    cb.onZoom(v.scale);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * v.scale, 0, 0, dpr * v.scale, v.x * dpr, v.y * dpr);
    for (const s of specs) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rotation);
      ctx.scale(s.scale, s.scale);
      ctx.translate(-SOURCE_SIZE / 2, -SOURCE_SIZE / 2);
      ctx.drawImage(source, 0, 0);
      ctx.restore();
    }
    sampleFps();
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);

  const cleanupInput = attachInput(host, viewRef, () => { /* RAF loop redraws every frame */ }, cb.registerThrow);

  return () => {
    cancelAnimationFrame(raf);
    cleanupInput();
    ro.disconnect();
    canvas.remove();
  };
}
