/**
 * Per-layer history navigation: ←/→ steps the active layer through its
 * per-layer history entries (stored by canvasStorage, populated on
 * stamp-on-generate completions). The selected entry's blob is loaded and
 * stamped into the layer's sprite via the canvas controller.
 *
 * Lifetime: each navigation creates a fresh blob URL; the controller's
 * setLayerImage revokes the previous blob URL it owned. Net = one live URL
 * per layer at any time.
 */
import { useCanvasStore } from './canvasStore';
import { canvasStorage } from './canvasStorageInstance';
import { getCanvasController } from './canvasContext';

// Reentrancy guard: holding ← / → at typematic rate must not stack overlapping
// blob fetches that race their setLayerImage callbacks. The latest call wins.
let inflightLayerId: string | null = null;
let inflightSeq = 0;

/**
 * Navigate the active layer's per-layer history.
 * `direction = -1` → newer entry (toward index 0 in the newest-first list).
 * `direction = +1` → older entry. Same semantics as `<HistoryPanel>`'s
 * arrow handler.
 *
 * No-op (returns false) if: no active layer, layer has no history, or the
 * navigation would have no effect (already at the edge).
 */
export async function navigateLayerHistory(direction: -1 | 1): Promise<boolean> {
  const cs = useCanvasStore.getState();
  const activeId = cs.activeLayerId;
  if (!activeId) return false;
  const layer = cs.canvasLayers.find(l => l.id === activeId);
  if (!layer) return false;

  const seq = ++inflightSeq;
  inflightLayerId = activeId;

  const history = await canvasStorage.listLayerHistory(activeId);
  // Race protection: if the user switched layers or fired another nav while
  // the IDB read was in flight, abandon this one.
  if (seq !== inflightSeq || inflightLayerId !== activeId) return false;
  if (history.length === 0) return false;
  // canvasStorage.listLayerHistory returns rows in insertion order; we want
  // newest-first. Sort by `at` descending.
  history.sort((a, b) => b.at - a.at);

  const cur = history.findIndex(h => h.id === layer.selectedHistoryId);
  const targetIdx = cur < 0
    ? 0
    : direction === -1 ? Math.max(0, cur - 1) : Math.min(history.length - 1, cur + 1);
  const target = history[targetIdx];
  if (!target || target.id === layer.selectedHistoryId) return false;

  // Update the store first so any subscribers re-render with the new selected
  // id immediately. The blob fetch + sprite swap follows.
  useCanvasStore.getState().updateCanvasLayer(activeId, { selectedHistoryId: target.id });

  const blob = await canvasStorage.getBlob(target.blobId);
  if (seq !== inflightSeq) return false;
  if (!blob) return false;

  const url = URL.createObjectURL(blob);
  getCanvasController()?.setLayerImage(activeId, url);
  return true;
}

/** Whether the active layer has any history — useful for shortcut `when` guards. */
export function activeLayerHasHistory(): boolean {
  const cs = useCanvasStore.getState();
  if (!cs.activeLayerId) return false;
  // We can only know cheaply (sync) if we cache, which we don't yet — so the
  // guard is "has active layer". The async navigateLayerHistory is a no-op if
  // history is empty anyway.
  return true;
}
