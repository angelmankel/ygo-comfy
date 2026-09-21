/**
 * Persistence adapter for the upcoming canvas-layer system (epic #18).
 *
 * The future infinite-canvas-as-compositor needs to persist:
 *   - canvas layers (with bounds, workflow snapshot, background)
 *   - per-layer history (independent of the global HistoryEntry list)
 *   - the actual image blobs those history entries reference
 *
 * Routing every read/write through this interface — rather than scattering
 * IDB calls through future store actions — lets us swap in a remote backend
 * (e.g. a `RemoteCanvasStorage` for cross-device sync) without touching any
 * caller. As such, the interface must stay free of IDB-specific types
 * (transactions, cursors, key ranges, etc.).
 *
 * See `idbCanvasStorage.ts` for the IndexedDB-backed implementation and
 * `canvasStorageInstance.ts` for the singleton callers should import.
 */
import type { CanvasLayer, LayerHistoryEntry } from './types';

export interface CanvasStorage {
  /** Read every canvas layer. Order is unspecified — callers sort by zIndex. */
  listLayers(): Promise<CanvasLayer[]>;

  /** Upsert a single layer by id. */
  saveLayer(layer: CanvasLayer): Promise<void>;

  /**
   * Delete a layer + cascade clean its history rows and any blobs those rows
   * referenced (when no other layer-history row still references them).
   */
  deleteLayer(id: string): Promise<void>;

  /**
   * Append one history entry for a layer. The caller is responsible for
   * having already called `putBlob(entry.blobId, blob)` first.
   */
  appendLayerHistory(layerId: string, entry: LayerHistoryEntry): Promise<void>;

  /** Read every history entry for a layer, newest-first (descending `at`). */
  listLayerHistory(layerId: string): Promise<LayerHistoryEntry[]>;

  /**
   * Delete one history entry. If no other history row references its blob,
   * the blob is dropped too.
   */
  deleteLayerHistoryEntry(layerId: string, entryId: string): Promise<void>;

  getBlob(blobId: string): Promise<Blob | null>;
  putBlob(blobId: string, blob: Blob): Promise<void>;
  deleteBlob(blobId: string): Promise<void>;
}
