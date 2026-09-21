import { useEffect, useState } from 'react';
import { canvasStorage } from '@/lib/canvasStorageInstance';
import { blobToDisplayUrl } from '@/lib/brush/pibr';

/**
 * Resolve a layer's currently-selected history entry to a display-friendly
 * object URL. Returns null while loading, while the layer has no selection,
 * or if the blob can't be resolved. Handles PIBR-format brush commits via
 * blobToDisplayUrl. Revokes the URL on unmount / change.
 */
export function useLayerSelectedThumb(
  layerId: string,
  selectedHistoryId: string | undefined,
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    if (!selectedHistoryId) {
      setUrl(null);
      return () => { /* nothing to revoke */ };
    }
    (async () => {
      try {
        const entries = await canvasStorage.listLayerHistory(layerId);
        if (cancelled) return;
        const entry = entries.find(e => e.id === selectedHistoryId);
        if (!entry) { setUrl(null); return; }
        const blob = await canvasStorage.getBlob(entry.blobId);
        if (cancelled || !blob) { setUrl(null); return; }
        const next = await blobToDisplayUrl(blob);
        if (cancelled) { URL.revokeObjectURL(next); return; }
        created = next;
        setUrl(next);
      } catch {
        if (!cancelled) setUrl(null);
      }
    })();
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [layerId, selectedHistoryId]);
  return url;
}
