/**
 * Drag-and-drop import: turn a Blob (from OS file drop, history-tile drag,
 * etc.) into a new From-image canvas layer at a target screen position.
 *
 * Mirrors the stamp-on-generate flow in lib/store.ts (`stampLayerHistory`):
 * the blob is persisted to canvasStorage as a separate copy + a
 * LayerHistoryEntry is written + the layer's selectedHistoryId points at it.
 * That gives drop-imported layers their own per-layer history start point,
 * independent of global history.
 */
import { useCanvasStore } from './canvasStore';
import { canvasStorage } from './canvasStorageInstance';
import { getCanvasController } from './canvasContext';
import { uid } from './storage';
import type { LayerHistoryEntry } from './types';

/**
 * Read a Blob into an HTMLImageElement so we can get its intrinsic
 * dimensions. Resolves with the image + a fresh blob URL that the caller
 * is responsible for revoking (or handing off to `setLayerImage`, which
 * takes ownership of blob: URLs).
 */
function loadImageFromBlob(blob: Blob): Promise<{ img: HTMLImageElement; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

export type ImportResult = { layerId: string } | { error: string };

/**
 * Import one Blob as a new From-image canvas layer.
 *
 * Bounds: sized to the image's intrinsic pixel dimensions, centered on the
 * world point under (clientX, clientY). When snap-to-grid is on, the
 * top-left of the bounds is snapped to the grid step. The new layer is
 * auto-activated.
 *
 * `offset` shifts the bounds in world coords from the drop point — used by
 * batch drops to avoid stacking N layers exactly on top of each other.
 */
export async function importImageAsCanvasLayer(
  blob: Blob,
  clientX: number,
  clientY: number,
  offset: { dx: number; dy: number } = { dx: 0, dy: 0 },
): Promise<ImportResult> {
  if (!blob.type.startsWith('image/')) {
    return { error: `Unsupported file type: ${blob.type || 'unknown'}` };
  }
  const ctl = getCanvasController();
  if (!ctl) return { error: 'Canvas not ready' };

  let imgInfo: { img: HTMLImageElement; url: string };
  try {
    imgInfo = await loadImageFromBlob(blob);
  } catch {
    return { error: 'Could not decode image' };
  }
  const { img, url } = imgInfo;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (iw <= 0 || ih <= 0) {
    URL.revokeObjectURL(url);
    return { error: 'Invalid image dimensions' };
  }

  // Drop point → world coords, then derive bounds top-left so the image is
  // centered on that point. Apply per-image offset (for batch drops).
  const wp = ctl.clientToWorld(clientX, clientY);
  let bx = wp.x - iw / 2 + offset.dx;
  let by = wp.y - ih / 2 + offset.dy;

  // Snap top-left to grid when snap is on.
  const cs = useCanvasStore.getState();
  if (cs.snapEnabled) {
    bx = Math.round(bx / cs.gridStep) * cs.gridStep;
    by = Math.round(by / cs.gridStep) * cs.gridStep;
  }

  // Persist the dropped image's blob first so the new layer's first
  // per-layer history entry has stable pixels to point at. If persist
  // fails we still create the layer (it renders visually via the in-memory
  // blob URL) but it won't survive a reload.
  let blobId: string | null = null;
  try {
    const id = uid();
    await canvasStorage.putBlob(id, blob);
    blobId = id;
  } catch (err) {
    console.warn('[canvasImport] blob persist failed', err);
  }

  // Create the empty layer with bounds. addCanvasLayer also activates it.
  const layerId = cs.addCanvasLayer({
    bounds: { x: bx, y: by, w: iw, h: ih },
  });

  // Write a per-layer history entry pointing at the dropped blob, then
  // select it — that's how the sprite shows the image and how img2img /
  // inpaint generations find their source pixels under the new model.
  if (blobId) {
    try {
      const entry: LayerHistoryEntry = {
        id: uid(),
        layerId,
        blobId,
        positive: '',
        negative: '',
        seed: 0,
        model: '',
        serverId: '',
        width: iw,
        height: ih,
        at: Date.now(),
      };
      await canvasStorage.appendLayerHistory(layerId, entry);
      useCanvasStore.getState().updateCanvasLayer(layerId, { selectedHistoryId: entry.id });
    } catch (err) {
      console.warn('[canvasImport] history persist failed', err);
    }
  }

  // Stamp the image visually. setLayerImage owns the blob URL's lifetime
  // from here on (it'll revoke on next swap or layer dispose). Pass the
  // blobId so the viewport-eviction system (#27) can re-fetch this layer's
  // pixels from storage when it scrolls back into view.
  ctl.setLayerImage(layerId, url, blobId);
  return { layerId };
}

/**
 * Import multiple Blobs in sequence, stacking each with a small cascading
 * offset so the layers don't perfectly overlap on the canvas.
 */
export async function importImagesAsCanvasLayers(
  blobs: Blob[],
  clientX: number,
  clientY: number,
): Promise<ImportResult[]> {
  const cs = useCanvasStore.getState();
  // Cascading offset: 1 grid step per image when snap is on, else 24px.
  const step = cs.snapEnabled ? cs.gridStep : 24;
  const results: ImportResult[] = [];
  for (let i = 0; i < blobs.length; i++) {
    const dx = i * step;
    const dy = i * step;
    results.push(await importImageAsCanvasLayer(blobs[i], clientX, clientY, { dx, dy }));
  }
  return results;
}
