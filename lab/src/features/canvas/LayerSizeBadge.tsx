import { useEffect, useRef, useState } from 'react';
import { useCanvasStore } from '@/lib/canvasStore';
import { useCanvas } from '@/lib/canvasContext';

/**
 * Pixel-size badge anchored just outside the bottom-left corner of the
 * currently-active layer's bounds. Updates in real time as the user drags
 * or resizes the layer — rAF-polls `worldToContainer` because pan/zoom
 * happens off the React tree (the controller drives Pixi directly) and we
 * can't react to it through Zustand alone.
 */
export function LayerSizeBadge() {
  const activeId = useCanvasStore(s => s.activeLayerId);
  const layer = useCanvasStore(s =>
    s.activeLayerId ? s.canvasLayers.find(l => l.id === s.activeLayerId) ?? null : null);
  const { controller } = useCanvas();
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!controller || !activeId || !layer || layer.isFolder) {
      setPos(null);
      return;
    }
    const tick = () => {
      const ctl = controller;
      const layers = useCanvasStore.getState().canvasLayers;
      const l = layers.find(x => x.id === activeId);
      if (!l) { setPos(null); rafRef.current = requestAnimationFrame(tick); return; }
      // Anchor just below the bottom-left corner of the layer bounds. The
      // chip's own height is added in CSS via translateY(0) — we keep the
      // anchor on the corner and let an outer translate push it below.
      const p = ctl.worldToContainer(l.bounds.x, l.bounds.y + l.bounds.h);
      if (p) setPos({ left: p.x, top: p.y });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [controller, activeId, layer]);

  if (!activeId || !layer || layer.isFolder || !pos) return null;
  const w = Math.round(layer.bounds.w);
  const h = Math.round(layer.bounds.h);

  return (
    <div
      style={{
        position: 'absolute',
        left: pos.left,
        top: pos.top,
        // Sit just outside the corner: 6px gap below the bounds, flush-left
        // with the left edge. transform keeps the anchor point at (x, y+h)
        // so the chip naturally drops below into "outside" territory.
        transform: 'translate(0, 6px)',
        pointerEvents: 'none',
      }}
      className="rounded bg-bg-elev/85 px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums text-fg-secondary shadow-sm ring-1 ring-border-default backdrop-blur-sm"
    >
      {w}×{h}
    </div>
  );
}
