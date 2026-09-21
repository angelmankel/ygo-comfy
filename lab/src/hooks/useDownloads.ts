import { useEffect, useRef } from 'react';
import { useStore } from '@/lib/store';
import { useDownloadsStore } from '@/features/downloads/store';

/**
 * Drives the downloads panel's polling. The ImageLab node doesn't push
 * progress, so we poll `GET /imagelab/downloads` on every server — fast
 * (1.5s) while anything is actively downloading, slow (10s) when idle, just
 * to pick up downloads started elsewhere (e.g. the `IMAGELAB_AUTO_DOWNLOAD`
 * env var on server boot).
 *
 * Mount once, near the app root.
 *
 * The immediate refresh on effect-setup is throttled: a download that both
 * starts and ends quickly would otherwise cause `hasActive` to flip true →
 * false in rapid succession, recreating the effect each time and firing a
 * fresh `refresh()` per recreation. We skip the leading refresh if one fired
 * within the last `MIN_REFRESH_GAP_MS`; the polling cadence itself is
 * unchanged so behaviour under sustained activity is identical.
 */
const MIN_REFRESH_GAP_MS = 800;
let _lastRefreshAt = 0;

export function useDownloads() {
  const servers = useStore((s) => s.servers);
  const refresh = useDownloadsStore((s) => s.refresh);
  const hasActive = useDownloadsStore((s) => s.rows.some((r) => r.status === 'downloading'));
  // Track which interval cadence is currently scheduled. Recreating the
  // effect only to swap the cadence is fine; firing a fresh refresh on every
  // such recreation is what causes the back-to-back hits.
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const now = Date.now();
    if (now - _lastRefreshAt >= MIN_REFRESH_GAP_MS) {
      _lastRefreshAt = now;
      void refresh();
    }
    intervalRef.current = setInterval(() => {
      if (cancelled) return;
      _lastRefreshAt = Date.now();
      void refresh();
    }, hasActive ? 1500 : 10000);
    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [servers, refresh, hasActive]);
}
