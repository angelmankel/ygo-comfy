import { useEffect, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { connectComfyWs } from '@/lib/comfy';
import { loadJobs } from '@/lib/jobsDb';
import type { Job } from '@/lib/types';

/**
 * Owns the ComfyUI connections — one websocket per server.
 *
 * Every piece of event-handling logic lives in the store (`handleWsEvent`,
 * `refreshServerInfo`, `reconcileServerJobs`); this hook is purely WS
 * lifecycle: open/close + initial job hydration. Keeping React out of the
 * data flow means we never have to read `useStore.getState()` inside event
 * handlers to dodge stale closures, and the effect's deps no longer lie
 * about what's actually read.
 */
export function useComfyConnection() {
  const allServers = useStore(s => s.servers);
  // Skip disabled servers entirely — no WS, no capability poll. Re-enabling
  // changes `allServers` identity and re-runs this effect to bring them back.
  // Memoized so the filter doesn't produce a fresh array reference every
  // render — otherwise the effect below would tear down + reconnect every WS
  // on every store update, and live progress/binary preview frames would
  // never have time to arrive between reconnects.
  const servers = useMemo(
    () => allServers.filter(s => s.enabled !== false),
    [allServers],
  );

  useEffect(() => {
    let cancelled = false;
    const cleanups: Array<() => void> = [];

    (async () => {
      // Hydrate persisted jobs (merge with anything queued this session).
      const persisted = await loadJobs();
      if (cancelled) return;
      const byId = new Map<string, Job>(persisted.map(j => [j.id, j]));
      for (const j of useStore.getState().jobs) byId.set(j.id, j);
      useStore.getState().setJobs([...byId.values()]);

      // Fetch each server's capabilities, then reconcile its jobs against
      // the live queue + history.
      await Promise.allSettled(servers.map(async (server) => {
        await useStore.getState().refreshServerInfo(server.id);
        if (cancelled) return;
        void useStore.getState().reconcileServerJobs(server.id);
      }));
      if (cancelled) return;

      const online = Object.keys(useStore.getState().serverInfo).length;
      useStore.getState().setStatus(
        online
          ? `Connected · ${online}/${servers.length} server${servers.length === 1 ? '' : 's'} online`
          : 'Offline — no servers reachable',
        online ? 'ok' : 'error',
      );
    })();

    // Connect a websocket per server. Each (re)connect refreshes the
    // server's capabilities so going up/down is reflected without a reload.
    for (const server of servers) {
      const close = connectComfyWs(server.host, {
        onOpen: () => {
          if (cancelled) return;
          void useStore.getState().refreshServerInfo(server.id);
          // Re-reconcile on every WS (re)open. ComfyUI doesn't replay
          // progress / executing events to clients that connect mid-job,
          // so without this poll a running job stays stuck until the next
          // node fires — or worse, finishes and we never notice.
          void useStore.getState().reconcileServerJobs(server.id);
        },
        onEvent: (ev) => { void useStore.getState().handleWsEvent(server.id, ev); },
      });
      cleanups.push(close);
    }

    // Periodic reconcile fallback. While any job is active anywhere, poll
    // every 4 seconds to pick up completions / status changes the WS may
    // have missed. Cheap (one /queue request per server with active jobs)
    // and stops the moment the queue empties.
    const poll = setInterval(() => {
      if (cancelled) return;
      const { jobs, servers: liveServers } = useStore.getState();
      if (!jobs.length) return;
      const active = new Set(jobs.map(j => j.serverId));
      for (const id of active) {
        if (liveServers.some(sv => sv.id === id)) {
          void useStore.getState().reconcileServerJobs(id);
        }
      }
    }, 4000);

    return () => {
      cancelled = true;
      clearInterval(poll);
      cleanups.forEach(c => c());
    };
  }, [servers]);
}
