import { useMemo } from 'react';
import { useStore } from '@/lib/store';
import { viewUrl } from '@/lib/comfy';
import type { HistoryEntry } from '@/lib/types';

/**
 * A local-history image scoped to a single model file — the "ImageLab" half of
 * the model-modal gallery toggle. Carries the underlying entry so the hero
 * action buttons (delete / favorite) can target it without re-derivation.
 */
export type LocalGalleryImage = {
  /** Discriminant — distinguishes from a CivitAI image at the call site. */
  kind: 'local';
  url: string;
  entry: HistoryEntry;
};

/**
 * True when a history entry was generated with the given model file. Checks
 * the checkpoint slot first (matches most opens), then any LoRA in the
 * captured workflow snapshot, then the workflow VAE. We deliberately don't
 * trust just `entry.model` for LoRA opens — that field is the *checkpoint*.
 */
function entryUsedModel(entry: HistoryEntry, fileName: string): boolean {
  if (!fileName) return false;
  if (entry.model === fileName) return true;
  const wf = entry.workflow;
  if (!wf) return false;
  if (wf.vae && wf.vae === fileName) return true;
  for (const l of wf.loras ?? []) if (l?.name === fileName) return true;
  return false;
}

/**
 * History entries that used `fileName`, in newest-first order, paired with a
 * resolved `viewUrl` for each. Returns an empty array when no matches exist or
 * the entry's server isn't in the current server list (host unresolvable).
 *
 * Memoised against the live history + servers slices so the modal doesn't
 * re-walk the entire history every render.
 */
export function useLocalGalleryImages(fileName: string | null): LocalGalleryImage[] {
  const history = useStore((s) => s.history);
  const servers = useStore((s) => s.servers);
  return useMemo(() => {
    if (!fileName) return [];
    const hosts = new Map(servers.map((sv) => [sv.id, sv.host]));
    const out: LocalGalleryImage[] = [];
    for (const entry of history) {
      if (!entryUsedModel(entry, fileName)) continue;
      const host = hosts.get(entry.serverId);
      if (!host || !entry.filename) continue;
      out.push({ kind: 'local', url: String(viewUrl(entry, host)), entry });
    }
    // history is already newest-first; preserve that.
    return out;
  }, [history, servers, fileName]);
}
