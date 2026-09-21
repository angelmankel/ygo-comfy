import { useEffect, useRef, useState } from 'react';
import { useCanvasStore } from '@/lib/canvasStore';
import { useCanvas } from '@/lib/canvasContext';
import { getBrushTipTexture } from '@/lib/brush/brushTip';

/**
 * Mouse-following brush preview. Visible whenever Brush or Erase is the
 * active tool. Draws a circle whose size = brush size in screen pixels
 * (zoom-aware) and whose alpha falloff mirrors `brush.hardness`, so the
 * user gets a true-to-stamp preview before clicking.
 *
 * Visibility rule: always shown while the tool is active. Over the canvas
 * the OS cursor is hidden (set to 'none' by the controller) so the brush
 * cursor IS the cursor. Over the settings popover the OS cursor remains
 * visible alongside this overlay — the user needs the OS cursor to grab
 * slider thumbs, and they see size changes live as they drag.
 *
 * Sized via radial gradient on a div (same falloff math as brushTip.ts).
 * Could use an actual Pixi-rendered preview but the gradient is visually
 * indistinguishable at typical brush sizes and avoids the cost of mounting
 * a second canvas just for the cursor.
 */
export function BrushCursor() {
  const activeTool = useCanvasStore(s => s.activeTool);
  const brush = useCanvasStore(s => s.brush);
  const { controller } = useCanvas();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const visibleRef = useRef(false);

  const isActive = activeTool === 'brush' || activeTool === 'erase';

  useEffect(() => {
    if (!isActive) {
      setPos(null);
      return;
    }
    // Visibility surfaces are tagged with `data-brush-cursor-surface`:
    //   - `canvas` → always show while hovering (this is the painting area)
    //   - `panel`  → show only while a pointer button is pressed (the user
    //                is dragging a brush-settings slider — they want live
    //                size feedback; otherwise the cursor would obscure the
    //                slider thumbs they're trying to read)
    // Anywhere else (parameters panel, top nav, etc.) the cursor stays
    // hidden so it doesn't bleed into unrelated UI.
    const onMove = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      const surface = target?.closest?.('[data-brush-cursor-surface]')
        ?.getAttribute('data-brush-cursor-surface');
      const buttonsDown = e.buttons !== 0;
      const show =
        surface === 'canvas' ||
        (surface === 'panel' && buttonsDown);
      setPos(show ? { x: e.clientX, y: e.clientY } : null);
    };
    const onLeave = () => setPos(null);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerleave', onLeave);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, [isActive]);

  // Subscribe to view changes so the cursor resizes during pan/zoom even
  // when the mouse isn't moving. onViewChange's payload is just a bool,
  // so we re-read zoom from the controller on every callback.
  useEffect(() => {
    if (!controller || !isActive) return;
    setZoom(controller.getZoom());
    return controller.onViewChange(() => setZoom(controller.getZoom()));
  }, [controller, isActive]);

  // Warm the tip texture cache on hardness change so the gradient in the
  // cursor visual stays in lockstep with what the engine will actually
  // stamp. brushTip is keyed by quantised hardness.
  useEffect(() => {
    if (!isActive) return;
    getBrushTipTexture(brush.hardness);
  }, [brush.hardness, isActive]);

  if (!isActive || !pos) return null;
  visibleRef.current = true;

  const screenSize = Math.max(2, brush.size * zoom);

  return (
    <div
      style={{
        position: 'fixed',
        left: pos.x - screenSize / 2,
        top: pos.y - screenSize / 2,
        width: screenSize,
        height: screenSize,
        // Outline-only ring — readable on light + dark backgrounds via the
        // white border + black drop shadow. No internal fill so the user
        // sees the underlying pixels they're about to stamp on.
        border: '1px solid rgba(255,255,255,0.85)',
        borderRadius: '50%',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.55)',
        pointerEvents: 'none',
        zIndex: 9999,
        transform: 'translateZ(0)',
      }}
    />
  );
}
