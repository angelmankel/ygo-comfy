/**
 * Unified-tile hook for the Collections panel.
 *
 * The panel doesn't care whether an image came from a generation (HistoryEntry)
 * or a user upload (ImportedImage) — both render as the same square thumbnail
 * with the same hover actions. This hook merges both lists into a single
 * `Tile[]` shape, applies the panel's filters/sort, and manages the blob
 * `Object URL` lifecycle for imports so the grid can render thumbnails
 * synchronously after first mount.
 *
 * Object URL strategy: keep a module-level Map<id, url> cache shared across
 * every consumer of this hook in the page. We `createObjectURL` on first sight
 * of an imported image and `revokeObjectURL` only when the image is deleted
 * (i.e. it leaves the `importedImages` list). The overlay can open and close
 * many times without re-allocating URLs — important when the user is going
 * back and forth between Collections and the generation view.
 */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { viewUrl } from '@/lib/comfy';
import { favoriteViewUrl, type ServerFavorite } from '@/lib/favorites';
import { getImportedBlob } from '@/lib/importedDb';
import type { HistoryEntry, ImportedImage } from '@/lib/types';

export type TileSource = 'history' | 'import' | 'favorite';
export type Sort = 'newest' | 'oldest' | 'name';
export type Source = 'all' | 'history' | 'imports';
/** The left-rail bucket the user has selected. `all`/`imports`/`favorites`
 *  are virtual; anything else is a user-created Collection id. */
export type RailBucket = 'all' | 'imports' | 'favorites' | string;

/** Unified shape for a single image card in the panel. The underlying record
 *  is exposed so actions that need it (recall, server attribution) can branch
 *  on `source`. */
export type Tile = {
  id: string;
  source: TileSource;
  thumbnailUrl: string;
  /** Best display name — for history, the model + seed; for imports, the
   *  original filename. */
  title: string;
  width: number;
  height: number;
  createdAt: number;
  liked: boolean;
  tags?: string[];
  description?: string;
  aiPrompt?: string;
  history?: HistoryEntry;
  imported?: ImportedImage;
  favorite?: ServerFavorite & { serverId: string };
};

// ─── Module-level Object URL cache ──────────────────────────────────────────
// One entry per imported image id. Survives overlay open/close so the user
// can flip back and forth without re-decoding blobs. Entries leave the cache
// only when the image is removed from `importedImages` (we diff on every
// hook update — see the effect below).
const urlCache: Map<string, string> = new Map();
/** In-flight blob → URL promises, so concurrent renders don't kick off the
 *  same IDB read twice. */
const inflight: Map<string, Promise<void>> = new Map();

async function ensureUrlForImport(id: string, onReady: () => void) {
  if (urlCache.has(id)) return;
  if (inflight.has(id)) {
    await inflight.get(id);
    return;
  }
  const p = (async () => {
    const blob = await getImportedBlob(id);
    if (!blob) return;
    urlCache.set(id, URL.createObjectURL(blob));
    onReady();
  })();
  inflight.set(id, p);
  try { await p; } finally { inflight.delete(id); }
}

function pruneObjectUrls(activeIds: Set<string>) {
  for (const [id, url] of urlCache.entries()) {
    if (!activeIds.has(id)) {
      URL.revokeObjectURL(url);
      urlCache.delete(id);
    }
  }
}

// ─── Tile shaping ───────────────────────────────────────────────────────────

function tileFromHistory(e: HistoryEntry, hostFor: (id: string) => string): Tile {
  const host = hostFor(e.serverId);
  const url = host ? viewUrl(e, host) : '';
  return {
    id: e.id,
    source: 'history',
    thumbnailUrl: url,
    title: e.model ? `${e.model} · seed ${e.seed}` : `seed ${e.seed}`,
    width: e.workflow?.width ?? 0,
    height: e.workflow?.height ?? 0,
    createdAt: e.createdAt,
    liked: !!e.liked,
    tags: e.tags,
    description: e.description,
    aiPrompt: e.aiPrompt,
    history: e,
  };
}

function tileFromFavorite(fav: ServerFavorite, serverId: string, host: string): Tile {
  return {
    id: `fav:${serverId}:${fav.id}`,
    source: 'favorite',
    thumbnailUrl: host ? favoriteViewUrl(host, fav.id) : '',
    title: fav.filename,
    width: 0,
    height: 0,
    // `saved_at` is float seconds; the rest of the system speaks ms.
    createdAt: Math.round(fav.saved_at * 1000),
    liked: true, // anything in the favorites tree is by definition a favorite
    favorite: { ...fav, serverId },
  };
}

function tileFromImport(i: ImportedImage, urlsTick: number): Tile {
  // `urlsTick` isn't read — its presence in the closure forces React to
  // re-run `useMemo` when the URL cache changes. Without it, `useMemo` would
  // return cached tiles even after a blob URL became available.
  void urlsTick;
  return {
    id: i.id,
    source: 'import',
    thumbnailUrl: urlCache.get(i.id) ?? '',
    title: i.name,
    width: i.width,
    height: i.height,
    createdAt: i.createdAt,
    liked: !!i.liked,
    tags: i.tags,
    description: i.description,
    aiPrompt: i.aiPrompt,
    imported: i,
  };
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export type TileFilters = {
  bucket: RailBucket;
  search: string;
  sort: Sort;
  source: Source;
};

export function useCollectionTiles(filters: TileFilters): { tiles: Tile[]; total: number } {
  const history = useStore((s) => s.history);
  const importedImages = useStore((s) => s.importedImages);
  const servers = useStore((s) => s.servers);
  const collections = useStore((s) => s.collections);
  const serverFavorites = useStore((s) => s.serverFavorites);

  // `urlsTick` increments every time the Object URL cache gains a new entry.
  // We feed it into `useMemo` below so the tile list re-derives when a thumb
  // becomes available.
  const [urlsTick, setUrlsTick] = useState(0);

  // Sync the Object URL cache against the current imported-images list. Drops
  // URLs whose images have been removed; warms URLs for any new images.
  useEffect(() => {
    const ids = new Set(importedImages.map((i) => i.id));
    pruneObjectUrls(ids);
    let cancelled = false;
    const onReady = () => { if (!cancelled) setUrlsTick((t) => t + 1); };
    for (const img of importedImages) {
      void ensureUrlForImport(img.id, onReady);
    }
    return () => { cancelled = true; };
  }, [importedImages]);

  // Server-id → host lookup, memoised so unrelated server-list mutations
  // don't churn the tile list.
  const hostFor = useMemo(() => {
    const map = new Map(servers.map((s) => [s.id, s.host]));
    return (id: string) => map.get(id) ?? '';
  }, [servers]);

  return useMemo(() => {
    // Server favorites that aren't already represented by a local history
    // entry — those would be either (a) starred from another client, or
    // (b) starred locally but the history record has rolled off the
    // HISTORY_MAX cap. Both should still appear in Collections so the user
    // sees every persisted image.
    const localFavoriteIds = new Set(
      history
        .filter((h) => h.favoriteId)
        .map((h) => `${h.serverId}::${h.favoriteId}`),
    );
    const orphanFavorites: Tile[] = [];
    for (const sv of servers) {
      const favs = serverFavorites[sv.id] || [];
      for (const fav of favs) {
        const key = `${sv.id}::${fav.id}`;
        if (localFavoriteIds.has(key)) continue;
        orphanFavorites.push(tileFromFavorite(fav, sv.id, sv.host));
      }
    }

    const all: Tile[] = [
      ...history.map((h) => tileFromHistory(h, hostFor)),
      ...importedImages.map((i) => tileFromImport(i, urlsTick)),
      ...orphanFavorites,
    ];

    // 1. Bucket — virtual buckets first, then user collections.
    let bucketed: Tile[];
    if (filters.bucket === 'all') {
      bucketed = all;
    } else if (filters.bucket === 'imports') {
      bucketed = all.filter((t) => t.source === 'import');
    } else if (filters.bucket === 'favorites') {
      bucketed = all.filter((t) => t.liked);
    } else {
      const collection = collections.find((c) => c.id === filters.bucket);
      const members = new Set(collection?.itemIds ?? []);
      bucketed = all.filter((t) => members.has(t.id));
    }

    // 2. Source filter (cross-cutting with the bucket).
    let filtered = bucketed;
    if (filters.source === 'history') filtered = filtered.filter((t) => t.source === 'history');
    else if (filters.source === 'imports') filtered = filtered.filter((t) => t.source === 'import');

    // 3. Search — case-insensitive across title, tags, description, and the
    //    underlying positive prompt (for history). Tag-only queries (prefix
    //    with `#`) bypass the other fields.
    const q = filters.search.trim().toLowerCase();
    if (q) {
      const tagOnly = q.startsWith('#');
      const needle = tagOnly ? q.slice(1) : q;
      filtered = filtered.filter((t) => {
        if (tagOnly) return t.tags?.some((tag) => tag.toLowerCase().includes(needle));
        const haystack = [
          t.title,
          t.description ?? '',
          t.aiPrompt ?? '',
          t.history?.positive ?? '',
          ...(t.tags ?? []),
        ].join(' • ').toLowerCase();
        return haystack.includes(needle);
      });
    }

    // 4. Sort.
    const sorted = [...filtered];
    if (filters.sort === 'newest') sorted.sort((a, b) => b.createdAt - a.createdAt);
    else if (filters.sort === 'oldest') sorted.sort((a, b) => a.createdAt - b.createdAt);
    else sorted.sort((a, b) => a.title.localeCompare(b.title));

    return { tiles: sorted, total: all.length };
  }, [history, importedImages, hostFor, collections, filters, urlsTick, servers, serverFavorites]);
}
