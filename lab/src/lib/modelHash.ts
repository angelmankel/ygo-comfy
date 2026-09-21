/**
 * Helpers for matching a ComfyUI model name to its hash entry and CivitAI data.
 *
 * ComfyUI model names (from `/object_info`, e.g. `SDXL/foo.safetensors`) are
 * relative to their type folder. The custom node's hash `key` is relative to
 * the whole models dir (`checkpoints/SDXL/foo.safetensors`), so the ComfyUI
 * name is always a suffix of the key.
 */
import type { ModelHash } from './comfy';
import type { CivitaiCacheEntry, CivitaiModelVersion, CivitaiVersionByHash } from './civitai';

/** Find the hash entry for a ComfyUI model name, or undefined if not hashed. */
export function findModelHash(hashes: ModelHash[], fileName: string): ModelHash | undefined {
  if (!fileName) return undefined;
  return (
    hashes.find((h) => h.key === fileName || h.key.endsWith('/' + fileName)) ??
    hashes.find((h) => h.filename === fileName.split('/').pop())
  );
}

/**
 * The preview image URL for a model, if its CivitAI metadata has resolved.
 * Returns undefined when the model isn't hashed, isn't on CivitAI, or hasn't
 * been resolved yet.
 */
export function modelPreviewUrl(
  hashes: ModelHash[],
  civitaiByHash: Record<string, CivitaiCacheEntry>,
  fileName: string,
): string | undefined {
  return modelPreviewUrls(hashes, civitaiByHash, fileName)[0];
}

/**
 * The full ordered list of CivitAI preview candidates for a model — the caller
 * can walk them in turn, falling back to the next when one 404s. Returns an
 * empty array when no metadata has resolved yet.
 */
export function modelPreviewUrls(
  hashes: ModelHash[],
  civitaiByHash: Record<string, CivitaiCacheEntry>,
  fileName: string,
): string[] {
  const match = findModelHash(hashes, fileName);
  if (!match) return [];
  const entry = civitaiByHash[match.hash];
  if (!entry || entry.status !== 'found') return [];
  const data = entry.data as CivitaiVersionByHash;
  return (data.images ?? []).map((img) => img.url).filter((url): url is string => !!url);
}

// ---------------------------------------------------------------------------
// Base-model family normalisation
//
// CivitAI reports `baseModel` as a free-form string like "SDXL 1.0",
// "SDXL Lightning", "Pony", "Flux.1 D". We collapse those into a small set of
// stable bucket ids so a filter chip row stays readable. Anything we don't
// recognise falls into `Other` (the raw string is still available for tooltips).
// ---------------------------------------------------------------------------

/** Stable bucket ids — `Unknown` is for models that have no CivitAI hit. */
export const BASE_MODEL_BUCKETS = [
  'SD 1.5', 'SD 2.x', 'SD 3.x', 'SDXL', 'Pony', 'Illustrious', 'NoobAI',
  'Flux', 'Cascade', 'PixArt', 'AuraFlow', 'Other', 'Unknown',
] as const;
export type BaseModelBucket = typeof BASE_MODEL_BUCKETS[number];

/** Map a raw CivitAI `baseModel` string to one of our buckets. */
export function bucketForBaseModel(raw: string | undefined | null): BaseModelBucket {
  if (!raw) return 'Unknown';
  const s = raw.toLowerCase();
  // Order matters — check the more-specific labels first (Pony / Illustrious /
  // NoobAI are SDXL-derived but get their own buckets on CivitAI).
  if (s.includes('pony')) return 'Pony';
  if (s.includes('illustrious')) return 'Illustrious';
  if (s.includes('noobai') || s.includes('noob ai')) return 'NoobAI';
  if (s.includes('flux')) return 'Flux';
  if (s.includes('cascade')) return 'Cascade';
  if (s.includes('pixart')) return 'PixArt';
  if (s.includes('auraflow')) return 'AuraFlow';
  if (s.startsWith('sdxl') || s.includes('sdxl')) return 'SDXL';
  if (s.includes('sd 3') || s.startsWith('sd3') || s.includes('sd-3')) return 'SD 3.x';
  if (s.includes('sd 2') || s.startsWith('sd2') || s.includes('sd-2')) return 'SD 2.x';
  if (s.includes('sd 1') || s.startsWith('sd1') || s.includes('sd-1') || s === 'sd 1.5') return 'SD 1.5';
  return 'Other';
}

/**
 * The base-model bucket for a ComfyUI model file — `Unknown` when the file
 * isn't hashed yet or CivitAI hasn't returned data. Drives the picker's
 * filter chips.
 */
export function modelBaseBucket(
  hashes: ModelHash[],
  civitaiByHash: Record<string, CivitaiCacheEntry>,
  fileName: string,
): BaseModelBucket {
  const match = findModelHash(hashes, fileName);
  if (!match) return 'Unknown';
  const entry = civitaiByHash[match.hash];
  if (!entry || entry.status !== 'found') return 'Unknown';
  const data = entry.data as CivitaiVersionByHash;
  return bucketForBaseModel(data.baseModel);
}

// ---------------------------------------------------------------------------
// Preview ordering — what the popover's hover slideshow plays. Pure function;
// the caller decides which CivitAI URLs and which local history URLs to feed
// in. Called once per hover-in so 'random' yields a new shuffle each time.
// ---------------------------------------------------------------------------

import type { ModelPreviewSource } from './storage';

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Build the ordered play-list for one model's preview slideshow.
 *  - `urls`: CivitAI image candidates (already in CivitAI's curated order).
 *  - `historyUrls`: locally-generated images using this model, newest first.
 *  - `source`: the user's setting.
 *
 * 'first' / 'popular' return CivitAI order verbatim (we don't have per-image
 * stats from `by-hash` yet — 'popular' is reserved for when we do).
 * 'random' shuffles CivitAI's list. 'history' interleaves the most recent
 * local generation in front. In every case duplicates are dropped.
 */
export function orderForPreview(
  urls: string[],
  historyUrls: string[],
  source: ModelPreviewSource,
): string[] {
  const dedupe = (arr: string[]) => {
    const seen = new Set<string>();
    return arr.filter((u) => (u && !seen.has(u) ? (seen.add(u), true) : false));
  };
  switch (source) {
    case 'random':
      return dedupe([...shuffleInPlace([...urls]), ...historyUrls]);
    case 'history':
      return dedupe([...historyUrls, ...urls]);
    case 'popular':
    case 'first':
    default:
      return dedupe([...urls, ...historyUrls]);
  }
}

/**
 * Every locally-hashed model's hash, uppercased — a fast membership set for
 * "is this on disk?" checks. An empty set means the hash cache hasn't loaded
 * (the ImageLab node isn't reachable yet), so callers should treat on-disk
 * status as *unknown* rather than false.
 */
export function localHashSet(hashes: ModelHash[]): Set<string> {
  return new Set(hashes.map((h) => h.hash.toUpperCase()));
}

/**
 * True when a CivitAI model version is present on disk — i.e. one of its
 * files' hashes matches a locally-hashed model. Matches against every hash a
 * file reports (SHA256, AutoV2, …) so it works regardless of which the local
 * cache stores.
 */
export function versionOnDisk(local: Set<string>, version: CivitaiModelVersion): boolean {
  return version.files.some((f) =>
    Object.values(f.hashes).some((h) => h != null && local.has(h.toUpperCase())),
  );
}
