import { useMemo } from 'react';
import { useStore } from '@/lib/store';
import { ROUND_ROBIN } from '@/lib/storage';
import { RESOURCE_LIST, type ResourceKind } from '@/lib/routing';

export type Availability = {
  /** Names of the servers that have this resource — for display. */
  servers: string[];
  /** Stable IDs of the servers that have this resource — for filtering. */
  serverIds: string[];
  /** Whether the resource is usable given the current routing target. */
  enabled: boolean;
};

/**
 * Returns a `(name) => Availability` lookup for one resource kind, given the
 * routing target and each server's reported capabilities:
 *
 * - routing pinned to a server → enabled iff that server has it
 * - round-robin → enabled iff *some* online server has it. The router is
 *   resource-aware: it queues the job on a server that actually has the
 *   resource, so a model only needs to exist on one of them.
 *
 * Models that aren't enabled are still shown in the dropdowns — disabled, with
 * a tooltip listing where they do live.
 */
export function useResourceAvailability(kind: ResourceKind): (name: string) => Availability {
  const servers = useStore(s => s.servers);
  const serverInfo = useStore(s => s.serverInfo);
  const routing = useStore(s => s.routing);

  return useMemo(() => {
    const listKey = RESOURCE_LIST[kind];
    const has = (serverId: string, name: string) =>
      (serverInfo[serverId]?.[listKey] ?? []).includes(name);

    // "Online" = servers we have capabilities for.
    const online = servers.filter(s => serverInfo[s.id]);
    const targets = routing === ROUND_ROBIN ? online : online.filter(s => s.id === routing);

    return (name: string): Availability => {
      const owners = servers.filter(s => has(s.id, name));
      return {
        servers: owners.map(s => s.name),
        serverIds: owners.map(s => s.id),
        // Resource-aware router → a job can land on any target that has the
        // resource, so `some` (not `every`) decides usability.
        enabled: targets.some(s => has(s.id, name)),
      };
    };
  }, [servers, serverInfo, routing, kind]);
}

/** A `title` tooltip describing where a resource lives. */
export function availabilityHint(a: Availability): string {
  if (a.servers.length === 0) return 'Not installed on any server';
  return `${a.enabled ? 'Available on' : 'Only available on'}: ${a.servers.join(', ')}`;
}
