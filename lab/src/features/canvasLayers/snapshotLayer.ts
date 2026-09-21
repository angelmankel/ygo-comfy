/**
 * "Take a picture" of the canvas at a layer's bounds.
 *
 * Composites every visible layer beneath the target (via the controller's
 * captureBoundsComposite) and stamps the result as a new layer-history entry
 * for the target. Useful for locking in the current composite as a starting
 * point for inpaint or img2img on the same layer.
 */
import { useCanvasStore } from '@/lib/canvasStore';
import { canvasStorage } from '@/lib/canvasStorageInstance';
import { getCanvasController } from '@/lib/canvasContext';
import { uid } from '@/lib/storage';
import type { LayerHistoryEntry } from '@/lib/types';

export async function snapshotLayerComposite(layerId: string): Promise<boolean> {
  const ctl = getCanvasController();
  if (!ctl) return false;
  const blob = await ctl.captureBoundsComposite(layerId, {
    includeTarget: true,
    includeAbove: true,
  });
  if (!blob) return false;

  const cs = useCanvasStore.getState();
  const layer = cs.canvasLayers.find(l => l.id === layerId);
  if (!layer) return false;

  const blobId = uid();
  try {
    await canvasStorage.putBlob(blobId, blob);
  } catch {
    return false;
  }
  const entry: LayerHistoryEntry = {
    id: uid(),
    layerId,
    blobId,
    positive: layer.layers
      .filter(l => l.on && l.kind ==='positive')
      .map(l => l.text)
      .join(', '),
    negative: layer.layers
      .filter(l => l.on && l.kind ==='negative')
      .map(l => l.text)
      .join(', '),
    seed: 0,
    serverId: 'snapshot',
    width: Math.round(layer.bounds.w),
    height: Math.round(layer.bounds.h),
    at: Date.now(),
  };
  try {
    await canvasStorage.appendLayerHistory(layerId, entry);
  } catch {
    return false;
  }
  // Point the layer at the new snapshot + stamp the sprite from the blob URL
  // so the user sees the captured composite immediately.
  cs.updateCanvasLayer(layerId, { selectedHistoryId: entry.id });
  const fresh = URL.createObjectURL(blob);
  ctl.setLayerImage(layerId, fresh, blobId);
  return true;
}
