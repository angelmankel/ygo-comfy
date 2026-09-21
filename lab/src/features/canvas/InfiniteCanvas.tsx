import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useCanvas } from '@/lib/canvasContext';
import { useStore } from '@/lib/store';
import { useCanvasStore } from '@/lib/canvasStore';
import { createCanvasController, type CanvasController } from '@/lib/canvasController';
import { LayerSizeBadge } from './LayerSizeBadge';
import { importImagesAsCanvasLayers } from '@/lib/canvasImport';
import { canvasStorage } from '@/lib/canvasStorageInstance';

type Props = {
  navOffset?: number;
  /** Pixel width of an open left side panel (else 0). Used by fit-to-view so
   *  fitted content lands in the visible canvas area, not under an overlay. */
  leftInset?: number;
  /** Same for the right side panel. */
  rightInset?: number;
};

/**
 * Thin host for the imperative 2D canvas controller (`lib/canvasController`):
 * owns the DOM refs, feeds the controller live `canvasSize` / `navOffset`, and
 * publishes it on the canvas context so siblings can drive it.
 */
export function InfiniteCanvas({ navOffset = 0, leftInset = 0, rightInset = 0 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { controller, setController } = useCanvas();

  const navOffsetRef = useRef(navOffset);
  navOffsetRef.current = navOffset;
  const leftInsetRef = useRef(leftInset);
  leftInsetRef.current = leftInset;
  const rightInsetRef = useRef(rightInset);
  rightInsetRef.current = rightInset;
  const controllerRef = useRef<CanvasController | null>(null);

  // Repaint when global grid config changes (step size or snap toggle).
  const gridStep = useCanvasStore(s => s.gridStep);
  const snapEnabled = useCanvasStore(s => s.snapEnabled);
  useEffect(() => { controllerRef.current?.requestRender(); }, [gridStep, snapEnabled]);

  // Repaint when canvas layers change — drives the bounds-overlay redraws.
  const canvasLayers = useCanvasStore(s => s.canvasLayers);
  const activeLayerId = useCanvasStore(s => s.activeLayerId);
  const canvasLayersHydrated = useCanvasStore(s => s.canvasLayersHydrated);
  useEffect(() => { controllerRef.current?.requestRender(); }, [canvasLayers, activeLayerId]);

  // Repaint when the mask-visibility toggle or active selection rect changes
  // — neither lives in canvasLayers, so the layers-array effect above misses
  // them. Without this the overlay only appears on the next user-triggered
  // re-render (pan/zoom).
  const masksVisible = useCanvasStore(s => s.masksVisible);
  const activeSelection = useCanvasStore(s => s.activeSelection);
  useEffect(() => { controllerRef.current?.requestRender(); }, [masksVisible, activeSelection]);

  // Fit-to-view on first paint after the controller + layers are both ready.
  // Without this, a reload showing layers far from world-origin looks like
  // an empty over-zoomed canvas. Runs at most once per controller instance —
  // the user can pan/zoom freely after.
  const didInitialFit = useRef(false);
  useEffect(() => {
    if (didInitialFit.current) return;
    if (!controller) return;
    if (!canvasLayersHydrated) return;
    didInitialFit.current = true;
    // Defer one frame so the rehydrate effect has had a chance to start
    // stamping images (cheap; the fit doesn't depend on stamps anyway,
    // bounds alone are enough).
    requestAnimationFrame(() => controller.fitToViewport(navOffsetRef.current));
  }, [controller, canvasLayersHydrated]);

  // Rehydrate each layer's stamp from per-layer history. Tracks the
  // selectedHistoryId we last loaded per layer so we only re-fetch when it
  // changes (e.g. boot, ←/→ nav from outside the controller, a new generation
  // completing on a layer that isn't actively being looked at). The
  // controller's setLayerImage call ALSO fires from the gen completion +
  // navigateLayerHistory paths; this effect is the safety net for everything
  // else, especially first paint after reload.
  const loadedHistoryByLayer = useRef<Map<string, string | null>>(new Map());
  // When the controller changes (e.g. StrictMode remount), drop per-controller
  // state — the new controller has no sprites loaded and hasn't seen a fit yet.
  const lastControllerSeen = useRef(controller);
  if (lastControllerSeen.current !== controller) {
    lastControllerSeen.current = controller;
    loadedHistoryByLayer.current.clear();
    didInitialFit.current = false;
  }
  useEffect(() => {
    if (!controller) return;
    const ctl = controller;
    const liveIds = new Set<string>();
    for (const layer of canvasLayers) {
      liveIds.add(layer.id);
      const want = layer.selectedHistoryId ?? null;
      const have = loadedHistoryByLayer.current.get(layer.id);
      if (have === want) continue;
      loadedHistoryByLayer.current.set(layer.id, want);
      if (!want) {
        ctl.setLayerImage(layer.id, null);
        continue;
      }
      // Async load — tolerate the layer being removed or selectedHistoryId
      // changing again before this resolves.
      void (async () => {
        try {
          const history = await canvasStorage.listLayerHistory(layer.id);
          const entry = history.find(h => h.id === want);
          if (!entry) return;
          // Stale guard: if selectedHistoryId moved on while we were
          // fetching, drop this load — a more recent effect run will
          // handle the new id.
          if (loadedHistoryByLayer.current.get(layer.id) !== want) return;
          const blob = await canvasStorage.getBlob(entry.blobId);
          if (!blob) return;
          if (loadedHistoryByLayer.current.get(layer.id) !== want) return;
          // Pass entry.blobId so the viewport-eviction system (#27) can
          // re-fetch this layer's pixels when it scrolls off and back on
          // screen, instead of leaking the texture forever.
          ctl.setLayerImage(layer.id, URL.createObjectURL(blob), entry.blobId);
        } catch (err) {
          console.warn('[InfiniteCanvas] layer stamp hydrate failed', err);
        }
      })();
    }
    // Clean up tracking for removed layers.
    for (const id of [...loadedHistoryByLayer.current.keys()]) {
      if (!liveIds.has(id)) loadedHistoryByLayer.current.delete(id);
    }
  }, [canvasLayers, controller]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const controller = createCanvasController(canvas, container, {
      getNavOffset: () => navOffsetRef.current,
      getGridStep: () => useCanvasStore.getState().gridStep,
      getSnapEnabled: () => useCanvasStore.getState().snapEnabled,
      getLeftInset: () => leftInsetRef.current,
      getRightInset: () => rightInsetRef.current,
      getLayers: () => useCanvasStore.getState().canvasLayers.filter(l => !l.isFolder),
      getMasksVisible: () => useCanvasStore.getState().masksVisible,
      getActiveSelection: () => useCanvasStore.getState().activeSelection,
      setActiveSelection: (sel) => useCanvasStore.getState().setActiveSelection(sel),
      getLayerMaskExpand: (id) => {
        const layer = useCanvasStore.getState().canvasLayers.find(l => l.id === id);
        return Math.max(0, Number(layer?.workflow?.inpaintMaskExpand) || 0);
      },
      getActiveLayerId: () => useCanvasStore.getState().activeLayerId,
      setActiveLayer: (id) => useCanvasStore.getState().setActiveLayer(id),
      setLayerBounds: (id, bounds) => useCanvasStore.getState().updateCanvasLayer(id, { bounds }),
      getActiveTool: () => useCanvasStore.getState().activeTool,
      setActiveTool: (id) => useCanvasStore.getState().setActiveTool(id as 'move'),
      getBrushSettings: () => {
        const b = useCanvasStore.getState().brush;
        return {
          size: b.size,
          hardness: b.hardness,
          opacity: b.opacity,
          spacing: b.spacing,
          color: b.color,
        };
      },
      setBrushSettings: (patch) => useCanvasStore.getState().setBrush(patch),
      // Brush engine pre-acknowledges history entries it just baked from the
      // live RT — the rehydrate effect below honors this map and skips the
      // PNG fetch, keeping the clean in-memory pixels on screen.
      markHistoryLoaded: (layerId, historyId) => {
        loadedHistoryByLayer.current.set(layerId, historyId);
      },
      onEyedropperPick: (color) => {
        useCanvasStore.getState().setBrush({ color });
      },
      // Viewport-eviction restore (#27): when a layer scrolls back into view
      // after its texture was freed, the controller asks for the blob via
      // this callback. canvasStorage is the same backing IDB the rest of the
      // app uses, so the round-trip is fast.
      fetchBlob: (blobId) => canvasStorage.getBlob(blobId),
      onImageActivate: () => {
        // Ignore the dblclick that pairs with the click that just closed the viewer.
        if (Date.now() - useStore.getState().viewerClosedAt < 500) return;
        useStore.getState().openViewer();
      },
    });
    controllerRef.current = controller;
    setController(controller);
    return () => {
      controller.dispose();
      controllerRef.current = null;
      setController(null);
    };
  }, [setController]);

  // ---- Drag-and-drop import ------------------------------------------------
  // Drop OS files (or in-app dragged images, once those tiles are wired) onto
  // the canvas to create From-image layers. Drop point = bounds center.
  // dragEnter counter prevents the "leave" event from firing while the user
  // drags over child elements (a single mousedown counts as multiple
  // enter/leave on the tree).
  const [dragOver, setDragOver] = useState(false);
  const dragEnterCount = useRef(0);
  const setStatus = useStore(s => s.setStatus);

  // Only show the drop overlay for file-typed drags. In-app drags carry
  // application/x-imagelab-image; OS file drops carry "Files". Anything else
  // (text selections, etc.) is ignored.
  const isImportDrag = (e: DragEvent) => {
    const types = e.dataTransfer.types;
    if (!types) return false;
    for (const t of types) {
      if (t === 'Files' || t === 'application/x-imagelab-image') return true;
    }
    return false;
  };

  const onDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (!isImportDrag(e)) return;
    e.preventDefault();
    dragEnterCount.current += 1;
    setDragOver(true);
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!isImportDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!isImportDrag(e)) return;
    dragEnterCount.current -= 1;
    if (dragEnterCount.current <= 0) {
      dragEnterCount.current = 0;
      setDragOver(false);
    }
  };
  const onDrop = async (e: DragEvent<HTMLDivElement>) => {
    if (!isImportDrag(e)) return;
    e.preventDefault();
    dragEnterCount.current = 0;
    setDragOver(false);

    // In-app drag wins over OS file drop: history tiles + future collection
    // tiles set application/x-imagelab-image with a URL we fetch into a Blob.
    const inAppPayload = e.dataTransfer.getData('application/x-imagelab-image');
    if (inAppPayload) {
      try {
        const parsed = JSON.parse(inAppPayload) as { url?: string };
        if (!parsed.url) throw new Error('payload missing url');
        const res = await fetch(parsed.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const result = await importImagesAsCanvasLayers([blob], e.clientX, e.clientY);
        if (result[0] && 'layerId' in result[0]) {
          setStatus('Imported as new layer', 'ok');
        } else {
          setStatus('Import failed', 'error');
        }
      } catch (err) {
        console.warn('[canvas drop] in-app import failed', err);
        setStatus('Could not import dragged image', 'error');
      }
      return;
    }

    // OS file drop.
    const files = Array.from(e.dataTransfer.files ?? []).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) {
      setStatus('No image files in drop', 'error');
      return;
    }
    const results = await importImagesAsCanvasLayers(files, e.clientX, e.clientY);
    const ok = results.filter(r => 'layerId' in r).length;
    const failed = results.length - ok;
    if (failed > 0) {
      setStatus(`Imported ${ok}/${results.length} image${ok === 1 ? '' : 's'}`, ok > 0 ? 'busy' : 'error');
    } else {
      setStatus(`Imported ${ok} image${ok === 1 ? '' : 's'} as ${ok === 1 ? 'a layer' : 'layers'}`, 'ok');
    }
  };

  return (
    <div
      ref={containerRef}
      data-brush-cursor-surface="canvas"
      className="relative h-full w-full overflow-hidden bg-bg-base"
      style={{ touchAction: 'none' }}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        // Match Pixi's renderer clear color. Pixi outputs truly transparent
        // pixels where erase has zeroed alpha; without this CSS background
        // the DOM compositor would show whatever's behind the canvas in
        // the page (which reads as "white" against a light parent), making
        // erased areas look like white paint. The CSS background guarantees
        // erased = dark canvas color regardless of theme/page layout.
        style={{ backgroundColor: '#070a10' }}
      />
      <LayerSizeBadge />
      {dragOver && (
        <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-accent/8 backdrop-blur-[1px]">
          <div className="rounded-md bg-bg-elev/90 px-3 py-2 text-[12px] text-fg-secondary shadow-lg">
            Drop image to create a new layer
          </div>
        </div>
      )}
    </div>
  );
}
