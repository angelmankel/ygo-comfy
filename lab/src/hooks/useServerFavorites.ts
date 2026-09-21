import { useEffect } from 'react';
import { useStore } from '@/lib/store';
import { listFavorites } from '@/lib/favorites';

/**
 * Periodically refresh each server's favorite-image list. The endpoint is
 * ETag'd (304 when unchanged) so the polling cost is essentially free when
 * nothing has been favorited recently.
 *
 * We poll because favorites can be created from any client pointed at the
 * same ComfyUI host — there's no push notification for cross-client sync.
 * Mount once near the app root.
 */
const POLL_MS = 15_000;

export function useServerFavorites() {
  const servers = useStore(s => s.servers);

  useEffect(() => {
    let cancelled = false;

    // Read live serverInfo + setter via getState so the interval doesn't
    // get torn down + restarted (firing an immediate refresh) every time
    // any server reports its capabilities.
    const refresh = async () => {
      const { serverInfo, serverFavoritesVersion, setServerFavorites } = useStore.getState();
      for (const sv of servers) {
        // Skip offline servers — no point hammering a host that just dropped.
        if (!serverInfo[sv.id]) continue;
        const prevVersion = serverFavoritesVersion[sv.id];
        try {
          const snap = await listFavorites(sv.host, prevVersion);
          if (cancelled || !snap) continue;
          setServerFavorites(sv.id, snap.version, snap.favorites);
        } catch {
          // Server may be offline / extension not installed — swallow and
          // try again next tick. The Collections view degrades gracefully
          // (no favorites for this host).
        }
      }
    };

    void refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [servers]);
}
