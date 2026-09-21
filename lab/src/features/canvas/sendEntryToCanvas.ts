/**
 * Send a history entry to the infinite canvas as a fresh image layer.
 *
 * Mirrors the post-generation completion flow in `store.handleWsEvent`
 * (new canvas layer → setLayerImage → stamp per-layer history blob) so the
 * image survives reloads and shows up in the layer's history strip — but
 * triggered from a button in the generate top nav instead of a finished job.
 */
import type { HistoryEntry, LayerHistoryEntry } from '@/lib/types';
import { useStore } from '@/lib/store';
import { useCanvasStore } from '@/lib/canvasStore';
import { viewUrl } from '@/lib/comfy';
import { canvasStorage } from '@/lib/canvasStorageInstance';
import { getCanvasController } from '@/lib/canvasContext';
import { uid } from '@/lib/storage';

export async function sendEntryToCanvas(entry: HistoryEntry): Promise<void> {
  const s = useStore.getState();
  const cs = useCanvasStore.getState();
  const host = s.servers.find(sv => sv.id === entry.serverId)?.host;
  if (!host) return;

  const url = viewUrl(entry, host);

  // Fetch first so we can read the natural dimensions for the layer bounds.
  const resp = await fetch(url);
  if (!resp.ok) return;
  const blob = await resp.blob();
  const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error('decode failed'));
    img.src = URL.createObjectURL(blob);
  }).catch(() => ({ w: entry.workflow?.width ?? 1024, h: entry.workflow?.height ?? 1024 }));

  // Center the new layer in the world. addCanvasLayer normally sizes from
  // defaultLayerSize; pass the image's real dimensions instead so the sprite
  // doesn't get squashed into a square.
  const layerId = cs.addCanvasLayer({
    bounds: { x: -dims.w / 2, y: -dims.h / 2, w: dims.w, h: dims.h },
    name: 'From history',
  });

  // Persist the blob + per-layer history row so a refresh restores the image.
  const blobId = uid();
  await canvasStorage.putBlob(blobId, blob);
  const layerEntry: LayerHistoryEntry = {
    id: uid(),
    layerId,
    blobId,
    positive: entry.positive,
    negative: entry.negative,
    seed: entry.seed,
    model: entry.model,
    serverId: entry.serverId,
    width: dims.w,
    height: dims.h,
    at: Date.now(),
  };
  await canvasStorage.appendLayerHistory(layerId, layerEntry);
  cs.updateCanvasLayer(layerId, { selectedHistoryId: layerEntry.id });

  // Paint the sprite + late-bind it to the persisted blob so the viewport
  // eviction system can rehydrate it later.
  const ctl = getCanvasController();
  if (ctl) {
    ctl.setLayerImage(layerId, url, blobId);
  }

  // Switch the user over so they see the new layer immediately.
  cs.setMainView('canvas');
  cs.setActiveLayer(layerId);
  // Fit the new layer into view after the canvas mounts.
  setTimeout(() => getCanvasController()?.fitLayerToViewport(layerId, 64), 50);
}
