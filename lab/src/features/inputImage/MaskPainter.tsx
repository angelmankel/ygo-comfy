import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/modal/Modal';
import { Slider } from '@/components/ui/Slider';
import { Field } from '@/components/ui/Field';
import { useCanvasStore } from '@/lib/canvasStore';
import { canvasStorage } from '@/lib/canvasStorageInstance';
import { useLayerSelectedThumb } from '@/hooks/useLayerSelectedThumb';
import { uid } from '@/lib/storage';
import { cn } from '@/lib/cn';

const MASK_BRUSH_SIZE_KEY = 'imagelab.maskBrushSize.v1';

/**
 * Brush-paint mask editor (#42 follow-up).
 *
 * Opens with the active layer's selected history image as a backdrop and
 * lets the user paint a mask on top of it. The mask is saved as a
 * grayscale PNG (white = inpaint, black = keep) at the layer's bounds
 * resolution. The PNG blob is stored via `canvasStorage.putBlob` and the
 * blob id is set on the layer as `paintedMaskBlobId`; the inpaint pipeline
 * picks it up at queue time (see GenerateButton.tsx).
 *
 * Drawing happens in two layers:
 *   - The `imageCanvas` shows the backdrop (selected history image, or a
 *     plain grey when none).
 *   - The `maskCanvas` collects opaque red strokes that the user sees as
 *     the painted mask. On Save we re-render the same strokes as pure
 *     white on a black canvas at the layer's bounds resolution.
 *
 * Mode: `'paint'` adds to the mask, `'erase'` cuts. Both share the brush
 * size slider. Pointer events are normalised to mask-canvas pixel coords
 * via getBoundingClientRect so layout zoom doesn't shift the strokes.
 */
export function MaskPainter({
  open,
  onClose,
  layerId,
}: {
  open: boolean;
  onClose: () => void;
  layerId: string;
}) {
  const layer = useCanvasStore(s => s.canvasLayers.find(l => l.id === layerId) ?? null);
  const updateCanvasLayer = useCanvasStore(s => s.updateCanvasLayer);

  const backdropUrl = useLayerSelectedThumb(layerId, layer?.selectedHistoryId);

  const imageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const [brushSize, setBrushSize] = useState(() => {
    try {
      const raw = localStorage.getItem(MASK_BRUSH_SIZE_KEY);
      const n = raw ? Number(raw) : NaN;
      return Number.isFinite(n) && n > 0 ? Math.round(n) : 64;
    } catch { return 64; }
  });
  useEffect(() => {
    try { localStorage.setItem(MASK_BRUSH_SIZE_KEY, String(brushSize)); } catch { /* ignore */ }
  }, [brushSize]);
  const [mode, setMode] = useState<'paint' | 'erase'>('paint');
  const [dirty, setDirty] = useState(false);
  // Pointer position within the mask canvas, in canvas-pixel coords. Null
  // when the cursor is outside the surface — drives the brush-cursor ring.
  const [cursor, setCursor] = useState<{ x: number; y: number; scale: number } | null>(null);

  // Width/height of the painting surface = layer's bounds. We render that
  // at a max display size; the mask blob is always saved at the bounds
  // resolution so it lines up 1:1 with the inpaint pipeline's expectations.
  const w = Math.max(1, Math.round(layer?.bounds.w ?? 512));
  const h = Math.max(1, Math.round(layer?.bounds.h ?? 512));

  // Hydrate the backdrop into imageCanvas when the URL resolves.
  useEffect(() => {
    if (!open) return;
    const c = imageCanvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, c.width, c.height);
    if (!backdropUrl) return;
    const img = new Image();
    img.onload = () => { ctx.drawImage(img, 0, 0, c.width, c.height); };
    img.src = backdropUrl;
  }, [backdropUrl, open, w, h]);

  // Hydrate the existing mask (if any) into maskCanvas when opened.
  useEffect(() => {
    if (!open) return;
    const c = maskCanvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    setDirty(false);
    if (!layer?.paintedMaskBlobId) return;
    (async () => {
      const blob = await canvasStorage.getBlob(layer.paintedMaskBlobId!);
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error('mask load failed'));
          el.src = url;
        });
        // Saved mask is white-on-black. Translate white pixels into the
        // canvas-painting representation (opaque red).
        const tmp = document.createElement('canvas');
        tmp.width = c.width;
        tmp.height = c.height;
        const tctx = tmp.getContext('2d');
        if (!tctx) return;
        tctx.drawImage(img, 0, 0, c.width, c.height);
        const imgData = tctx.getImageData(0, 0, c.width, c.height);
        for (let i = 0; i < imgData.data.length; i += 4) {
          const v = imgData.data[i];
          imgData.data[i] = 220;
          imgData.data[i + 1] = 60;
          imgData.data[i + 2] = 60;
          imgData.data[i + 3] = v > 128 ? 160 : 0;
        }
        ctx.putImageData(imgData, 0, 0);
      } finally {
        URL.revokeObjectURL(url);
      }
    })();
  }, [open, layer?.paintedMaskBlobId]);

  const toCanvasCoords = (clientX: number, clientY: number) => {
    const c = maskCanvasRef.current;
    if (!c) return null;
    const rect = c.getBoundingClientRect();
    const fx = (clientX - rect.left) / rect.width;
    const fy = (clientY - rect.top) / rect.height;
    return { x: fx * c.width, y: fy * c.height };
  };

  // Display-px ratio for the brush-cursor ring: same scale the canvas is
  // drawn at on screen. Reads from getBoundingClientRect because the CSS
  // sizes the surface independently of the backing-canvas pixel size.
  const cursorScale = () => {
    const c = maskCanvasRef.current;
    if (!c) return 1;
    const rect = c.getBoundingClientRect();
    return rect.width / c.width;
  };

  const paintSegment = (x: number, y: number) => {
    const c = maskCanvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const last = lastRef.current ?? { x, y };
    ctx.globalCompositeOperation = mode === 'paint' ? 'source-over' : 'destination-out';
    ctx.strokeStyle = mode === 'paint' ? 'rgba(220,60,60,0.7)' : 'rgba(0,0,0,1)';
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    lastRef.current = { x, y };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drawingRef.current = true;
    lastRef.current = toCanvasCoords(e.clientX, e.clientY);
    if (lastRef.current) {
      paintSegment(lastRef.current.x, lastRef.current.y);
      setCursor({ x: lastRef.current.x, y: lastRef.current.y, scale: cursorScale() });
    }
    setDirty(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = toCanvasCoords(e.clientX, e.clientY);
    if (p) setCursor({ x: p.x, y: p.y, scale: cursorScale() });
    if (!drawingRef.current) return;
    if (p) paintSegment(p.x, p.y);
  };
  const onPointerUp = () => {
    drawingRef.current = false;
    lastRef.current = null;
  };
  const onPointerLeave = () => {
    setCursor(null);
  };

  const clearMask = () => {
    const c = maskCanvasRef.current;
    const ctx = c?.getContext('2d');
    if (ctx && c) ctx.clearRect(0, 0, c.width, c.height);
    setDirty(true);
  };

  const save = async () => {
    if (!layer) return;
    const mc = maskCanvasRef.current;
    if (!mc) return;
    // Rebuild the saved mask: white where painted, black elsewhere.
    const out = document.createElement('canvas');
    out.width = mc.width;
    out.height = mc.height;
    const octx = out.getContext('2d');
    if (!octx) return;
    octx.fillStyle = '#000';
    octx.fillRect(0, 0, out.width, out.height);
    // Read painted alpha, re-write as white pixels.
    const src = mc.getContext('2d')!.getImageData(0, 0, mc.width, mc.height);
    const dst = octx.getImageData(0, 0, out.width, out.height);
    let anyPainted = false;
    for (let i = 0; i < src.data.length; i += 4) {
      const a = src.data[i + 3];
      const v = a > 16 ? 255 : 0;
      if (v) anyPainted = true;
      dst.data[i] = v;
      dst.data[i + 1] = v;
      dst.data[i + 2] = v;
      dst.data[i + 3] = 255;
    }
    octx.putImageData(dst, 0, 0);

    if (!anyPainted) {
      // No mask painted → clear any existing one.
      if (layer.paintedMaskBlobId) {
        updateCanvasLayer(layer.id, { paintedMaskBlobId: undefined });
      }
      onClose();
      return;
    }
    const blob = await new Promise<Blob | null>((r) => out.toBlob(b => r(b), 'image/png'));
    if (!blob) return;
    const blobId = uid();
    try {
      await canvasStorage.putBlob(blobId, blob);
    } catch {
      return;
    }
    updateCanvasLayer(layer.id, { paintedMaskBlobId: blobId });
    onClose();
  };

  if (!layer) return null;

  return (
    <Modal open={open} onClose={onClose} panelClassName="w-[760px] max-w-[95vw]">
      <Modal.Column className="flex-1">
        <Modal.Header className="flex items-center gap-3">
          <div className="text-[13px] font-semibold text-fg-secondary">Paint mask</div>
          <div className="text-[11px] text-fg-tertiary">
            White = inpaint, black = keep. Saved at {w}×{h}.
          </div>
          <div className="ml-auto"><Modal.Close /></div>
        </Modal.Header>
        <Modal.Body className="flex flex-col gap-3">
          <div className="flex w-full items-center justify-center">
            <div
              className="relative"
              style={{
                aspectRatio: `${w} / ${h}`,
                width: `min(100%, ${Math.round((w / h) * 520)}px)`,
                maxHeight: '60vh',
              }}
            >
              <canvas
                ref={imageCanvasRef}
                width={w}
                height={h}
                className="absolute inset-0 h-full w-full rounded border border-border-default object-contain"
              />
              <canvas
                ref={maskCanvasRef}
                width={w}
                height={h}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onPointerLeave={onPointerLeave}
                className="absolute inset-0 h-full w-full touch-none rounded"
                style={{ cursor: 'none' }}
              />
              {cursor && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute rounded-full border shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
                  style={{
                    left: `${cursor.x * cursor.scale - (brushSize * cursor.scale) / 2}px`,
                    top: `${cursor.y * cursor.scale - (brushSize * cursor.scale) / 2}px`,
                    width: `${brushSize * cursor.scale}px`,
                    height: `${brushSize * cursor.scale}px`,
                    borderColor: mode === 'paint' ? 'rgba(255,255,255,0.9)' : 'rgba(255,180,180,0.9)',
                    background: mode === 'paint'
                      ? 'rgba(220,60,60,0.18)'
                      : 'rgba(0,0,0,0.12)',
                  }}
                />
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-border-default bg-bg-input p-0.5">
              {(['paint', 'erase'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  className={cn(
                    'rounded px-3 py-1.5 text-[11px] font-medium transition-colors',
                    mode === m ? 'bg-accent text-white shadow-sm' : 'text-fg-muted hover:text-fg-secondary',
                  )}
                >
                  {m === 'paint' ? 'Paint' : 'Erase'}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={clearMask}
              className="rounded-md border border-border-default px-3 py-1.5 text-[11px] font-medium text-fg-muted transition-colors hover:border-border-strong hover:text-fg-secondary"
            >
              Clear all
            </button>
          </div>

          <Field label="Brush size">
            <Slider
              value={brushSize}
              onValueChange={(v) => setBrushSize(Math.round(v))}
              min={4}
              max={Math.min(512, Math.max(w, h))}
              step={1}
              ariaLabel="Brush size"
            />
            <span className="w-12 shrink-0 text-right text-[12px] font-medium tabular-nums text-fg-secondary">
              {brushSize}px
            </span>
          </Field>
        </Modal.Body>
        <Modal.Footer className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border-default px-3 py-1.5 text-[12px] text-fg-muted transition-colors hover:border-border-strong hover:text-fg-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { void save(); }}
            disabled={!dirty && !layer.paintedMaskBlobId}
            className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save mask
          </button>
        </Modal.Footer>
      </Modal.Column>
    </Modal>
  );
}
