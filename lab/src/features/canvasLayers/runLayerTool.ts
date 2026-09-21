/**
 * Run a ComfyUI ToolGraph against the active canvas layer's currently-selected
 * history image. Used by the canvas top-toolbar "Tools" popover (Remove BG,
 * Blur, Sharpen, Invert, …). Mirrors the per-generation stamping path: result
 * blob is written via canvasStorage, appended as a fresh LayerHistoryEntry,
 * selected, and pushed to the layer's sprite via the controller.
 */
import { useStore } from '@/lib/store';
import { useCanvasStore } from '@/lib/canvasStore';
import { canvasStorage } from '@/lib/canvasStorageInstance';
import { getCanvasController } from '@/lib/canvasContext';
import { runImageTool, type ToolGraphBuilder } from '@/lib/imageJobs';
import { blobToPngBlob } from '@/lib/brush/pibr';
import { uid } from '@/lib/storage';
import type { LayerHistoryEntry } from '@/lib/types';

export async function runActiveLayerTool(
  toolName: string,
  graph: ToolGraphBuilder,
): Promise<boolean> {
  const s = useStore.getState();
  const cs = useCanvasStore.getState();
  const setStatus = s.setStatus;

  const layerId = cs.activeLayerId;
  const layer = layerId ? cs.canvasLayers.find(l => l.id === layerId) : null;
  if (!layer) {
    setStatus(`${toolName}: select a layer first`, 'error');
    return false;
  }
  if (!layer.selectedHistoryId) {
    setStatus(`${toolName}: this layer has no image yet — generate or import one first`, 'error');
    return false;
  }
  const target = s.peekNextServer();
  if (!target) {
    setStatus(`${toolName}: no online servers`, 'error');
    return false;
  }

  // Resolve the source image. The layer's selected history entry has the
  // blob id we need to feed to ComfyUI.
  const entries = await canvasStorage.listLayerHistory(layer.id);
  const entry = entries.find(e => e.id === layer.selectedHistoryId);
  if (!entry) {
    setStatus(`${toolName}: selected history entry is gone`, 'error');
    return false;
  }
  const rawSourceBlob = await canvasStorage.getBlob(entry.blobId);
  if (!rawSourceBlob) {
    setStatus(`${toolName}: source image blob missing`, 'error');
    return false;
  }
  // Brush-commit entries are stored as PIBR (raw premultiplied RGBA, custom
  // header). PIL can't decode that — convert to PNG before upload. PNG
  // blobs pass through unchanged.
  const sourceBlob = await blobToPngBlob(rawSourceBlob);

  setStatus(`Running ${toolName.toLowerCase()} on ${target.name}…`, 'busy');
  let outBlob: Blob;
  try {
    outBlob = await runImageTool(target.host, sourceBlob, `tool-${layer.id.slice(0, 6)}.png`, graph);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(`${toolName} failed: ${msg}`, 'error');
    return false;
  }

  // Stamp result: persist blob, append layer history entry, set selected,
  // push to canvas sprite. Mirrors stampLayerHistory in store.ts.
  const blobId = uid();
  try {
    await canvasStorage.putBlob(blobId, outBlob);
  } catch (err) {
    setStatus(`${toolName}: persist failed`, 'error');
    console.warn('[runActiveLayerTool] putBlob failed', err);
    return false;
  }
  const dims = await new Promise<{ w: number; h: number }>((resolve) => {
    const img = new Image();
    const u = URL.createObjectURL(outBlob);
    img.onload = () => { URL.revokeObjectURL(u); resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
    img.onerror = () => { URL.revokeObjectURL(u); resolve({ w: entry.width, h: entry.height }); };
    img.src = u;
  });
  const stamped: LayerHistoryEntry = {
    id: uid(),
    layerId: layer.id,
    blobId,
    positive: `[${toolName.toLowerCase()}] ${entry.positive}`,
    negative: entry.negative,
    seed: entry.seed,
    model: entry.model,
    serverId: target.id,
    width: dims.w,
    height: dims.h,
    at: Date.now(),
  };
  try {
    await canvasStorage.appendLayerHistory(layer.id, stamped);
  } catch (err) {
    setStatus(`${toolName}: history persist failed`, 'error');
    console.warn('[runActiveLayerTool] appendLayerHistory failed', err);
    return false;
  }
  cs.updateCanvasLayer(layer.id, { selectedHistoryId: stamped.id });
  const fresh = URL.createObjectURL(outBlob);
  getCanvasController()?.setLayerImage(layer.id, fresh, blobId);
  setStatus(`${toolName} done`, 'ok');
  return true;
}
