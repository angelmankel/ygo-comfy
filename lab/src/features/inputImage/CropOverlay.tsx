import { useEffect, useRef, useState } from 'react';
import type { CropRect } from './imageOps';

type Props = {
  imageWidth: number;
  imageHeight: number;
  onApply: (rect: CropRect) => void;
  onCancel: () => void;
};

type DragKind = 'move' | 'nw' | 'ne' | 'sw' | 'se' | null;

/**
 * Absolutely-positioned overlay that sits on top of an image and lets the
 * user drag a crop rectangle. State lives in *image coordinates* (so we get
 * pixel-accurate cropping regardless of how the image is scaled to fit).
 * Renders the rect by % of the parent box, which matches the parent
 * `<img>` because they share the same containing element.
 */
export function CropOverlay({ imageWidth, imageHeight, onApply, onCancel }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Initial rect: a centered 80% × 80% box (typical user intent).
  const [rect, setRect] = useState<CropRect>({
    x: Math.round(imageWidth * 0.1),
    y: Math.round(imageHeight * 0.1),
    w: Math.round(imageWidth * 0.8),
    h: Math.round(imageHeight * 0.8),
  });

  // While dragging, anchor + the rect-at-drag-start.
  const dragRef = useRef<{
    kind: DragKind;
    startX: number;
    startY: number;
    rect: CropRect;
    pxPerImgX: number;
    pxPerImgY: number;
  } | null>(null);

  const startDrag = (kind: Exclude<DragKind, null>) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const root = rootRef.current;
    if (!root) return;
    const r = root.getBoundingClientRect();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      kind,
      startX: e.clientX,
      startY: e.clientY,
      rect: { ...rect },
      pxPerImgX: r.width / imageWidth,
      pxPerImgY: r.height / imageHeight,
    };
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = (e.clientX - d.startX) / d.pxPerImgX;
      const dy = (e.clientY - d.startY) / d.pxPerImgY;
      const r = { ...d.rect };
      const clampX = (x: number) => Math.max(0, Math.min(imageWidth, x));
      const clampY = (y: number) => Math.max(0, Math.min(imageHeight, y));
      switch (d.kind) {
        case 'move': {
          const nx = clampX(r.x + dx);
          const ny = clampY(r.y + dy);
          // Keep size; clamp position so the rect stays inside the image.
          r.x = Math.min(nx, imageWidth - r.w);
          r.y = Math.min(ny, imageHeight - r.h);
          r.x = Math.max(0, r.x);
          r.y = Math.max(0, r.y);
          break;
        }
        case 'nw': {
          const x2 = r.x + r.w;
          const y2 = r.y + r.h;
          const nx = clampX(r.x + dx);
          const ny = clampY(r.y + dy);
          r.x = Math.min(nx, x2 - 8);
          r.y = Math.min(ny, y2 - 8);
          r.w = x2 - r.x;
          r.h = y2 - r.y;
          break;
        }
        case 'ne': {
          const x1 = r.x;
          const y2 = r.y + r.h;
          const nx2 = clampX(r.x + r.w + dx);
          const ny = clampY(r.y + dy);
          r.y = Math.min(ny, y2 - 8);
          r.w = Math.max(8, nx2 - x1);
          r.h = y2 - r.y;
          break;
        }
        case 'sw': {
          const x2 = r.x + r.w;
          const y1 = r.y;
          const nx = clampX(r.x + dx);
          const ny2 = clampY(r.y + r.h + dy);
          r.x = Math.min(nx, x2 - 8);
          r.w = x2 - r.x;
          r.h = Math.max(8, ny2 - y1);
          break;
        }
        case 'se': {
          const x1 = r.x;
          const y1 = r.y;
          const nx2 = clampX(r.x + r.w + dx);
          const ny2 = clampY(r.y + r.h + dy);
          r.w = Math.max(8, nx2 - x1);
          r.h = Math.max(8, ny2 - y1);
          break;
        }
      }
      setRect(r);
    };
    const end = () => { dragRef.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [imageWidth, imageHeight]);

  // Render the rect in % of the root so it tracks the displayed `<img>`.
  const pct = {
    left:   `${(rect.x / imageWidth) * 100}%`,
    top:    `${(rect.y / imageHeight) * 100}%`,
    width:  `${(rect.w / imageWidth) * 100}%`,
    height: `${(rect.h / imageHeight) * 100}%`,
  };

  return (
    <div ref={rootRef} className="absolute inset-0">
      {/* Dimmed area outside the rect via four overlays. */}
      <div className="absolute left-0 right-0 top-0 bg-black/55" style={{ height: pct.top }} />
      <div className="absolute left-0 right-0 bottom-0 bg-black/55" style={{ top: `calc(${pct.top} + ${pct.height})` }} />
      <div className="absolute bg-black/55" style={{ top: pct.top, height: pct.height, left: 0, width: pct.left }} />
      <div className="absolute bg-black/55" style={{ top: pct.top, height: pct.height, left: `calc(${pct.left} + ${pct.width})`, right: 0 }} />

      {/* The rect itself + corner handles. */}
      <div
        className="absolute cursor-move border-2 border-accent"
        style={pct}
        onPointerDown={startDrag('move')}
      >
        <Handle position="nw" onPointerDown={startDrag('nw')} />
        <Handle position="ne" onPointerDown={startDrag('ne')} />
        <Handle position="sw" onPointerDown={startDrag('sw')} />
        <Handle position="se" onPointerDown={startDrag('se')} />
      </div>

      {/* Floating action bar */}
      <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/65 px-3 py-1.5 backdrop-blur-md">
        <span className="font-mono text-[10px] text-white/70">
          {Math.round(rect.w)}×{Math.round(rect.h)} @ {Math.round(rect.x)},{Math.round(rect.y)}
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md bg-white/15 px-2.5 py-1 text-[11px] font-medium text-white/85 hover:bg-white/25"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onApply(rect)}
          className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-accent-hover"
        >
          Apply crop
        </button>
      </div>
    </div>
  );
}

function Handle({
  position,
  onPointerDown,
}: {
  position: 'nw' | 'ne' | 'sw' | 'se';
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const pos = {
    nw: '-left-1.5 -top-1.5 cursor-nwse-resize',
    ne: '-right-1.5 -top-1.5 cursor-nesw-resize',
    sw: '-left-1.5 -bottom-1.5 cursor-nesw-resize',
    se: '-right-1.5 -bottom-1.5 cursor-nwse-resize',
  }[position];
  return (
    <div
      onPointerDown={onPointerDown}
      className={`absolute h-3 w-3 rounded-sm border-2 border-accent bg-white ${pos}`}
    />
  );
}
