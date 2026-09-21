import { useEffect } from 'react';
import { useStore } from '@/lib/store';
import { fetchModelHashes, type ModelHash } from '@/lib/comfy';
import { resolveCivitai, type CivitaiCacheEntry } from '@/lib/civitai';

/**
 * Loads the model-hash cache from the ImageLab custom node on *every* server,
 * merges them (a model file is the same content wherever it lives, so they're
 * de-duped by hash), then eagerly resolves CivitAI metadata so model cards can
 * show previews. Re-runs when the server list changes.
 *
 * Hashes land in `store.modelHashes`; CivitAI results stream into
 * `store.civitaiByHash` as they resolve, buffered + flushed once per microtask
 * (a warm cache fires the callback for every model in one synchronous burst).
 */
export function useModelHashes() {
  const servers = useStore(s => s.servers);
  const setModelHashes = useStore(s => s.setModelHashes);
  const mergeCivitai = useStore(s => s.mergeCivitai);

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();

    const buffer: CivitaiCacheEntry[] = [];
    let flushScheduled = false;
    const flush = () => {
      flushScheduled = false;
      if (!cancelled && buffer.length) mergeCivitai(buffer.splice(0));
    };

    (async () => {
      const results = await Promise.allSettled(
        servers.map(s => fetchModelHashes(s.host)),
      );
      if (cancelled) return;

      const byHash = new Map<string, ModelHash>();
      results.forEach((r, i) => {
        const sv = servers[i];
        if (r.status === 'fulfilled' && r.value) {
          for (const m of r.value.models) byHash.set(m.hash, m);
        } else if (r.status === 'rejected') {
          // The ImageLab node returns a useful 404 when not installed, and a
          // 5xx if the index isn't built yet. Either way, no hashes → no
          // CivitAI lookups → no model previews / metadata. Stays as a
          // console.warn so missing-node setups don't fail silently.
          console.warn(`[imagelab-node] ${sv.name} (${sv.host}) failed:`, r.reason);
        }
      });
      const merged = [...byHash.values()];
      setModelHashes(merged);

      void resolveCivitai(merged.map(m => m.hash), {
        signal: ac.signal,
        onResolved: entry => {
          buffer.push(entry);
          if (!flushScheduled) {
            flushScheduled = true;
            queueMicrotask(flush);
          }
        },
      });
    })();

    return () => { cancelled = true; ac.abort(); };
  }, [servers, setModelHashes, mergeCivitai]);
}
