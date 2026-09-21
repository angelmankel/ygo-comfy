/**
 * Client for the `/imagelab/favorites` endpoints on the ComfyUI custom node.
 *
 * The custom node persists explicitly favorited images into
 * `<comfy_output>/imagelab_favorites/<MM-DD-YYYY>/<filename>` so they survive
 * ComfyUI restarts (PreviewImage outputs in `temp/` are wiped on every boot —
 * see `comfy.ts:buildGraph`).
 *
 * Every call is host-scoped: a "server favorite" lives on exactly one
 * ComfyUI host; the frontend aggregates across servers when populating the
 * Collections view.
 */
import { comfyHttpFor } from './comfy';

export type ServerFavorite = {
  /** `MM-DD-YYYY/filename` — stable id used for delete + view. */
  id: string;
  date: string;
  filename: string;
  size: number;
  /** Server-side mtime, seconds since epoch (float). */
  saved_at: number;
};

export type FavoritesSnapshot = {
  version: string;
  favorites: ServerFavorite[];
};

/** POST a temp/output/input image into the favorites tree for today. */
export async function createFavorite(
  host: string,
  source: { filename: string; subfolder?: string; type?: string },
): Promise<ServerFavorite> {
  const res = await fetch(`${comfyHttpFor(host)}/imagelab/favorites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: source.filename,
      subfolder: source.subfolder || '',
      type: source.type || 'temp',
    }),
  });
  if (!res.ok) {
    let msg = `Favorite save failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) msg = `Favorite save failed: ${body.error}`;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  const body = await res.json();
  return body.favorite as ServerFavorite;
}

/** Fetch the current favorites snapshot. Previously sent `If-None-Match` for
 *  ETag-based 304s, but ComfyUI's CORS layer doesn't whitelist that header so
 *  every preflight failed under HTTPS. Dropped the header to keep the request
 *  a CORS "simple" GET (no preflight); the cost is one full payload per 15s
 *  poll instead of a 304, which is negligible. */
export async function listFavorites(
  host: string,
  _ifNoneMatch?: string,
): Promise<FavoritesSnapshot | null> {
  const res = await fetch(`${comfyHttpFor(host)}/imagelab/favorites`);
  if (!res.ok) throw new Error(`Favorites list failed (${res.status})`);
  return await res.json() as FavoritesSnapshot;
}

export async function deleteFavorite(host: string, favoriteId: string): Promise<void> {
  const res = await fetch(`${comfyHttpFor(host)}/imagelab/favorites/${favoriteId}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Favorite delete failed (${res.status})`);
  }
}

/** Direct-fetch URL for a single favorite. */
export function favoriteViewUrl(host: string, favoriteId: string): string {
  const [date, ...rest] = favoriteId.split('/');
  const filename = rest.join('/');
  return `${comfyHttpFor(host)}/imagelab/favorites/view?` + new URLSearchParams({ date, filename });
}
