/**
 * CivitAI network + cache layer.
 *
 * The browser app talks to CivitAI directly (no app backend), mirroring how
 * `lib/comfy.ts` talks to ComfyUI. Two endpoints are used:
 *
 *   by-hash   GET /model-versions/by-hash/:sha256
 *             Maps a local model file → its CivitAI identity (one version,
 *             carrying `modelId`). Cached in IndexedDB keyed by hash. A SHA256
 *             never changes, so a "found" entry is permanent; "not found"
 *             results are cached too (so local-only models aren't re-queried
 *             every load) but expire after NOT_FOUND_TTL.
 *
 *   by-id     GET /models/:id
 *             The full model — every version, gallery, license, stats — that
 *             the metadata modal renders. Cached in IndexedDB keyed by modelId.
 *
 * Full responses are stored verbatim — trim at render time, not here.
 *
 * View-layer helpers (formatting, HTML stripping, etc.) live in
 * `features/model-metadata/civitai.ts`, which re-exports the types below.
 *
 * Reference: https://github.com/civitai/civitai/wiki/REST-API-Reference
 */
import {
  getCivitaiMany,
  putCivitaiMany,
  getCivitaiModel,
  putCivitaiModel,
  type CivitaiCacheEntry,
} from './civitaiCache';
import { loadCivitaiSettings } from './storage';

const CIVITAI_API = 'https://civitai.com/api/v1';
/** Civitai Red mirrors the same /api/v1/* surface but serves the adult catalog.
 *  Some adult-rated models only appear under this host. */
const CIVITAI_RED_API = 'https://civitai.red/api/v1';

/** Parsed CivitAI reference — either form may be absent. Callers use
 *  modelId to open the metadata modal and versionId (if present) to
 *  pre-select a specific version inside it. */
export type CivitaiRef = { modelId?: number; versionId?: number };

/**
 * Parse a user-pasted CivitAI reference. Accepts:
 *   - bare numeric id          → assumed to be a modelId
 *   - "model:<n>" / "version:<n>" → explicit kind
 *   - AIR urn: `urn:air:<ecosystem>:<type>:civitai:<modelId>[@<versionId>]`
 *   - civitai.com / civitai.red URL:
 *       /models/<id>[?modelVersionId=<v>]
 *       /models/<id>/...?modelVersionId=<v>
 *       /api/v1/models/<id>
 *       /api/v1/model-versions/<id>
 *
 * Returns `{}` if nothing usable is found — caller shows a parse-error.
 */
export function parseCivitaiRef(raw: string): CivitaiRef {
  const s = raw.trim();
  if (!s) return {};

  // AIR urn — modelId is the 5th colon-segment, optional @versionId suffix.
  // Per CivitAI: urn:air:<ecosystem>:<type>:<source>:<id>[@<version>]
  const air = /^urn:air:[^:]+:[^:]+:civitai:(\d+)(?:@(\d+))?/i.exec(s);
  if (air) {
    return {
      modelId: Number(air[1]),
      versionId: air[2] ? Number(air[2]) : undefined,
    };
  }

  // Explicit prefixes.
  const explicit = /^(model|version)\s*[:=#]\s*(\d+)$/i.exec(s);
  if (explicit) {
    const n = Number(explicit[2]);
    return explicit[1].toLowerCase() === 'version' ? { versionId: n } : { modelId: n };
  }

  // Bare number.
  if (/^\d+$/.test(s)) return { modelId: Number(s) };

  // URL. Use the URL parser to extract path + ?modelVersionId.
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!/(^|\.)civitai\.(com|red)$/i.test(u.hostname)) {
      // Not a Civitai host — last-ditch attempt to find any numeric segment.
    } else {
      // /api/v1/model-versions/<id>
      const apiVer = /\/api\/v1\/model-versions\/(\d+)/i.exec(u.pathname);
      if (apiVer) return { versionId: Number(apiVer[1]) };
      // /api/v1/models/<id>
      const apiMod = /\/api\/v1\/models\/(\d+)/i.exec(u.pathname);
      if (apiMod) {
        const v = u.searchParams.get('modelVersionId');
        return { modelId: Number(apiMod[1]), versionId: v ? Number(v) : undefined };
      }
      // /models/<id>[/...]
      const webMod = /\/models\/(\d+)/i.exec(u.pathname);
      if (webMod) {
        const v = u.searchParams.get('modelVersionId');
        return { modelId: Number(webMod[1]), versionId: v ? Number(v) : undefined };
      }
    }
    // Generic fallback — first run of digits anywhere in the path.
    const m = /\/(\d{3,})\b/.exec(u.pathname);
    if (m) return { modelId: Number(m[1]) };
  } catch { /* not a URL — fall through */ }

  return {};
}

/** Fetch the modelId for a given version id. Used when the user pastes a
 *  version-only reference and we need the parent model to open the modal. */
export async function fetchCivitaiModelIdForVersion(
  versionId: number,
  signal?: AbortSignal,
): Promise<number | null> {
  try {
    const res = await fetchWithTimeout(`${CIVITAI_API}/model-versions/${versionId}`, { signal });
    if (!res.ok) return null;
    const json = await res.json() as { modelId?: number };
    return typeof json.modelId === 'number' ? json.modelId : null;
  } catch {
    return null;
  }
}

/**
 * CivitAI's image CDN encodes the requested width as a path segment
 * (e.g. `.../width=450/foo.jpeg`). Swap that segment to request a smaller
 * (or larger) variant — the CDN re-encodes server-side and the resulting
 * image is dramatically smaller for grid thumbnails.
 *
 * When the URL doesn't match the expected pattern we return it untouched
 * (covers external host overrides, signed URLs, the rare full-size link).
 */
export function civitaiThumbUrl(url: string, width: number): string {
  if (!url) return url;
  const w = Math.max(64, Math.round(width));
  const replaced = url.replace(/\/width=\d+\//, `/width=${w}/`);
  if (replaced !== url) return replaced;
  // No `width=N` segment yet — insert one before the filename so the CDN
  // still sizes the response. Matches the CivitAI Next/Image transform shape.
  const m = url.match(/^(https?:\/\/[^/]+\/[^/]+\/[^/]+)\/([^/?#]+)(\?.*)?$/);
  if (m) return `${m[1]}/width=${w}/${m[2]}${m[3] ?? ''}`;
  return url;
}

/** Re-check a "not found" hash after this long. "Found" entries never expire. */
const NOT_FOUND_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

/** How many CivitAI requests to keep in flight at once. They rate-limit
 *  per-IP and there's no documented quota; 3 is empirically the highest we
 *  can sustain on a fresh page load with ~150 models without triggering a
 *  cluster of 429s. */
const CONCURRENCY = 3;

/** Per-request timeout. CivitAI sometimes accepts a connection then never
 *  responds (rate-limit drop, Cloudflare challenge, etc.) — without a
 *  timeout the modal's "Loading metadata…" would hang forever. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Backoff after a 429. One retry only — past that we return 'error' and
 *  let the caller surface it. */
const RATE_LIMIT_BACKOFF_MS = 2500;

/**
 * `fetch()` with a built-in timeout AND a way to compose an external signal
 * (so e.g. closing the metadata modal mid-fetch aborts cleanly). On timeout
 * the returned promise rejects with `'AbortError'`, which callers map to a
 * meaningful error message.
 */
async function fetchWithTimeout(url: string, opts: { signal?: AbortSignal } = {}): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  const onExternalAbort = () => ac.abort();
  if (opts.signal) {
    if (opts.signal.aborted) ac.abort();
    else opts.signal.addEventListener('abort', onExternalAbort, { once: true });
  }
  try {
    return await fetch(withCivitaiAuth(url), { signal: ac.signal });
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onExternalAbort);
  }
}

/** CivitAI accepts the API token either as a Bearer header or as a `?token=`
 *  query param. We use the query-param form because civitai.com doesn't return
 *  CORS headers on the preflight that a custom `Authorization` header forces,
 *  whereas a plain GET with only a token param is a "simple request" and skips
 *  preflight entirely. Token is read fresh from localStorage each call so a
 *  Settings change takes effect immediately without a reload. */
function withCivitaiAuth(url: string): string {
  if (!/^https?:\/\/(?:[^/]+\.)?civitai\.(?:com|red)\//i.test(url)) return url;
  const key = loadCivitaiSettings().apiKey.trim();
  if (!key) return url;
  return url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(key);
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Diagnostics surface — quiet by default, loud on failure. The success path
 * never logs; rate-limits / timeouts / exceptions log at `console.warn`.
 *
 * Per-request counters live on `window.__civitaiStats` for peeking from
 * DevTools, and `window.civitaiPing()` does a one-shot reachability check.
 * Opt into verbose `info` logs with `localStorage.civitaiDebug = '1'`.
 */
type CivitaiDiagnostics = { issued: number; ok: number; notFound: number; rateLimited: number; failed: number; timedOut: number };
const STATS: CivitaiDiagnostics = { issued: 0, ok: 0, notFound: 0, rateLimited: 0, failed: 0, timedOut: 0 };
function verboseEnabled(): boolean {
  try { return localStorage.getItem('civitaiDebug') === '1'; } catch { return false; }
}
/** Verbose log — opt-in via localStorage. */
function vlog(...args: unknown[]) { if (verboseEnabled()) console.info('[civitai]', ...args); }
/** Failure log — always on. */
function wlog(...args: unknown[]) { console.warn('[civitai]', ...args); }
if (typeof window !== 'undefined') {
  (window as unknown as { __civitaiStats: CivitaiDiagnostics }).__civitaiStats = STATS;
}

/** Manual connection test — paste `window.civitaiPing()` in DevTools to
 *  verify the API is reachable from the browser. */
export async function civitaiPing(): Promise<{ ok: boolean; status: number; ms: number; bytes: number; error?: string }> {
  const url = `${CIVITAI_API}/models/4384`;
  const start = performance.now();
  try {
    const res = await fetchWithTimeout(url);
    const text = await res.text();
    return { ok: res.ok, status: res.status, ms: Math.round(performance.now() - start), bytes: text.length };
  } catch (e) {
    return { ok: false, status: 0, ms: Math.round(performance.now() - start), bytes: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
if (typeof window !== 'undefined') {
  (window as unknown as { civitaiPing: typeof civitaiPing }).civitaiPing = civitaiPing;
}

// ── API shapes ─────────────────────────────────────────────────────────────
// The subset of CivitAI's responses the app renders. The full objects are
// cached, so untyped fields still exist at runtime.

export type CivitaiCreator = { username: string; image: string | null };

export type CivitaiStats = {
  downloadCount: number;
  thumbsUpCount: number;
  thumbsDownCount: number;
  commentCount: number;
  rating?: number;
  ratingCount?: number;
};

export type CivitaiFileMetadata = {
  fp: string | null; // "fp16" | "fp32" | "bf16"
  size: string | null; // "full" | "pruned"
  format: string | null; // "SafeTensor" | "PickleTensor" | "Other"
};

export type CivitaiFile = {
  id: number;
  name: string;
  sizeKB: number;
  type: string; // "Model" | "VAE" | "Training Data" | ...
  primary?: boolean;
  metadata: CivitaiFileMetadata;
  hashes: Partial<Record<'AutoV1' | 'AutoV2' | 'SHA256' | 'CRC32' | 'BLAKE3', string>>;
  pickleScanResult?: string;
  virusScanResult?: string;
  downloadUrl: string;
};

export type CivitaiImageMeta = {
  prompt?: string;
  negativePrompt?: string;
  sampler?: string;
  steps?: number;
  cfgScale?: number;
  seed?: number;
  [key: string]: unknown;
};

export type CivitaiImage = {
  url: string;
  width: number;
  height: number;
  nsfwLevel: number;
  hash?: string;
  meta: CivitaiImageMeta | null;
};

export type CivitaiModelVersion = {
  id: number;
  name: string;
  baseModel: string; // "SDXL 1.0" | "SDXL Lightning" | "SD 1.5" | "Flux.1 D" | ...
  baseModelType?: string;
  createdAt: string;
  publishedAt?: string;
  description: string | null; // HTML
  trainedWords: string[];
  files: CivitaiFile[];
  images: CivitaiImage[];
  stats: CivitaiStats;
};

export type CivitaiModel = {
  id: number;
  name: string;
  description: string | null; // HTML
  type: string; // "Checkpoint" | "LORA" | "VAE" | "Controlnet" | ...
  nsfw: boolean;
  tags: string[];
  allowNoCredit: boolean;
  allowCommercialUse: string[]; // e.g. ["Image", "Rent", "Sell"]
  allowDerivatives: boolean;
  allowDifferentLicense: boolean;
  creator: CivitaiCreator;
  stats: CivitaiStats;
  modelVersions: CivitaiModelVersion[];
};

/**
 * The `by-hash` response: a single model version, plus the `modelId` / `model`
 * fields that let us pivot to the full `models/:id` payload.
 */
export type CivitaiVersionByHash = CivitaiModelVersion & {
  modelId: number;
  model: { name: string; type: string; nsfw?: boolean; poi?: boolean };
};

export type { CivitaiCacheEntry };

// ── by-hash: file → CivitAI identity ───────────────────────────────────────

/**
 * Fetch one hash directly from CivitAI. Distinguishes "not on CivitAI" (404 —
 * a cacheable negative result) from a transient error (network / 5xx / 429
 * — not cached, so it'll be retried next time). 429s are retried once after
 * a short back-off.
 */
export async function fetchCivitaiByHash(hash: string, signal?: AbortSignal): Promise<CivitaiCacheEntry> {
  const url = `${CIVITAI_API}/model-versions/by-hash/${hash}`;
  STATS.issued++;
  const t0 = performance.now();
  try {
    let res = await fetchWithTimeout(url, { signal });
    if (res.status === 429) {
      STATS.rateLimited++;
      wlog(`429 on by-hash ${hash.slice(0, 10)} — backing off ${RATE_LIMIT_BACKOFF_MS}ms`);
      await sleep(RATE_LIMIT_BACKOFF_MS);
      if (signal?.aborted) return { hash, status: 'error', fetchedAt: Date.now(), data: null };
      res = await fetchWithTimeout(url, { signal });
    }
    if (res.status === 404) {
      STATS.notFound++;
      return { hash, status: 'not-found', fetchedAt: Date.now(), data: null };
    }
    if (!res.ok) {
      STATS.failed++;
      wlog(`HTTP ${res.status} on by-hash ${hash.slice(0, 10)} (${Math.round(performance.now() - t0)}ms)`);
      return { hash, status: 'error', fetchedAt: Date.now(), data: null };
    }
    const data = (await res.json()) as CivitaiVersionByHash;
    STATS.ok++;
    return { hash, status: 'found', fetchedAt: Date.now(), data };
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === 'AbortError') STATS.timedOut++; else STATS.failed++;
    wlog(`exception on by-hash ${hash.slice(0, 10)}: ${name ?? 'unknown'} (${Math.round(performance.now() - t0)}ms)`);
    return { hash, status: 'error', fetchedAt: Date.now(), data: null };
  }
}

/** Is a cache entry good enough to use without re-fetching? */
function isFresh(entry: CivitaiCacheEntry): boolean {
  if (entry.status === 'found') return true;
  if (entry.status === 'not-found') return Date.now() - entry.fetchedAt < NOT_FOUND_TTL;
  return false; // 'error' entries are never persisted, but be safe
}

/** Run an async fn over items with a bounded number in flight at once. */
async function pooled<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export interface ResolveOptions {
  /**
   * Called as each hash resolves — cache hits fire immediately, network
   * fetches fire as they land. Lets the UI populate progressively instead of
   * waiting for the whole batch.
   */
  onResolved?: (entry: CivitaiCacheEntry) => void;
  /** Abort signal — stops issuing new fetches when triggered. */
  signal?: AbortSignal;
}

/**
 * Resolve CivitAI metadata for a set of model hashes. Reads the IndexedDB
 * cache first, fetches only what's missing/stale (bounded concurrency), writes
 * the new results back, and returns everything as a `hash -> entry` map.
 *
 * Errors are returned in the map (status `'error'`) but not cached, so they
 * retry on the next call.
 */
export async function resolveCivitai(
  hashes: string[],
  opts: ResolveOptions = {},
): Promise<Map<string, CivitaiCacheEntry>> {
  const { onResolved, signal } = opts;
  const unique = [...new Set(hashes)].filter(Boolean);
  const result = new Map<string, CivitaiCacheEntry>();

  // 1. Batch-read the cache.
  vlog(`resolveCivitai entered; reading IDB cache for ${unique.length} hashes…`);
  const cacheReadStart = performance.now();
  let cached: Map<string, CivitaiCacheEntry>;
  try {
    cached = await getCivitaiMany(unique);
  } catch (e) {
    wlog(`IDB cache read THREW after ${Math.round(performance.now() - cacheReadStart)}ms — proceeding with empty cache`, e);
    cached = new Map();
  }
  vlog(`IDB cache read returned ${cached.size}/${unique.length} entries in ${Math.round(performance.now() - cacheReadStart)}ms`);
  const toFetch: string[] = [];
  for (const hash of unique) {
    const hit = cached.get(hash);
    if (hit && isFresh(hit)) {
      result.set(hash, hit);
      onResolved?.(hit);
    } else {
      toFetch.push(hash);
    }
  }
  vlog(`resolveCivitai: ${unique.length} hashes (cache hits: ${unique.length - toFetch.length}, fetching: ${toFetch.length})`);

  // 2. Fetch the misses with bounded concurrency.
  const fresh: CivitaiCacheEntry[] = [];
  await pooled(toFetch, CONCURRENCY, async (hash) => {
    if (signal?.aborted) return;
    const entry = await fetchCivitaiByHash(hash, signal);
    result.set(hash, entry);
    if (entry.status !== 'error') fresh.push(entry);
    onResolved?.(entry);
  });

  // 3. Persist the new found/not-found results (errors are skipped above).
  if (fresh.length) await putCivitaiMany(fresh);

  if (toFetch.length) {
    vlog(`resolveCivitai done — issued=${STATS.issued} ok=${STATS.ok} 404=${STATS.notFound} 429=${STATS.rateLimited} timeout=${STATS.timedOut} fail=${STATS.failed}`);
  }
  return result;
}

// ── by-id: the full model for the metadata modal ───────────────────────────

/**
 * Fetch a model's full metadata from CivitAI, served from the IndexedDB cache
 * when available. Throws on a non-OK response (the metadata modal surfaces the
 * error) — failures are not cached, so they retry on the next open.
 */
export async function fetchCivitaiModel(modelId: number, signal?: AbortSignal): Promise<CivitaiModel> {
  const cached = await getCivitaiModel(modelId);
  if (cached) return cached.data as CivitaiModel;

  const url = `${CIVITAI_API}/models/${modelId}`;
  vlog(`fetchCivitaiModel ${modelId} → ${url}`);
  STATS.issued++;
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { signal });
    if (res.status === 429) {
      STATS.rateLimited++;
      wlog(`429 on model ${modelId} — backing off ${RATE_LIMIT_BACKOFF_MS}ms`);
      await sleep(RATE_LIMIT_BACKOFF_MS);
      if (signal?.aborted) throw new Error('CivitAI: cancelled');
      res = await fetchWithTimeout(url, { signal });
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      STATS.timedOut++;
      wlog(`timeout on model ${modelId} after ${Math.round(performance.now() - t0)}ms`);
      throw new Error('CivitAI: request timed out (network or rate-limit)');
    }
    STATS.failed++;
    wlog(`exception on model ${modelId}:`, e);
    throw e;
  }
  if (res.status === 429) { STATS.rateLimited++; throw new Error('CivitAI: rate limited — try again in a minute'); }
  if (!res.ok) { STATS.failed++; throw new Error(`CivitAI: model ${modelId} returned HTTP ${res.status}`); }
  STATS.ok++;
  vlog(`fetchCivitaiModel ${modelId} ok in ${Math.round(performance.now() - t0)}ms`);
  const data = (await res.json()) as CivitaiModel;

  await putCivitaiModel({ modelId, fetchedAt: Date.now(), data });
  return data;
}

// ── images: gallery samples *with* generation params ───────────────────────

/** A page of gallery images plus the cursor for the next page (null = last page). */
export type CivitaiImagePage = {
  items: CivitaiImage[];
  nextCursor: string | null;
};

/**
 * Gallery content filter. CivitAI's `nsfw` param is counter-intuitive:
 * `nsfw=true` returns *only* NSFW, `nsfw=false` *only* SFW, omitted = both.
 */
export type NsfwFilter = 'all' | 'sfw' | 'nsfw';

const IMAGE_PAGE_SIZE = 10;

/**
 * Fetch a page of a model version's gallery images from the dedicated Images
 * API.
 *
 * The `models/:id` payload strips each image's `meta` (it only flags
 * `hasMeta`), so the metadata modal's "generation settings" come up empty if
 * sourced from there. This endpoint keeps the full `meta` (prompt, sampler,
 * steps, cfg, seed, …).
 *
 * Cursor-paginated — pass the previous page's `nextCursor` to get the next
 * batch. Returns `null` on a request failure (so callers can fall back to the
 * meta-less model-payload set); a successful response with no items is a real
 * empty result (e.g. the filter matched nothing) and returns `{ items: [] }`.
 */
export async function fetchCivitaiImages(
  modelVersionId: number,
  cursor?: string | null,
  nsfw: NsfwFilter = 'all',
): Promise<CivitaiImagePage | null> {
  try {
    const params = new URLSearchParams({
      modelVersionId: String(modelVersionId),
      limit: String(IMAGE_PAGE_SIZE),
    });
    if (cursor) params.set('cursor', cursor);
    if (nsfw === 'sfw') params.set('nsfw', 'false');
    else if (nsfw === 'nsfw') params.set('nsfw', 'true');
    // 'all' → omit the param entirely (the API then returns both)

    let res = await fetchWithTimeout(`${CIVITAI_API}/images?${params}`);
    if (res.status === 429) {
      await sleep(RATE_LIMIT_BACKOFF_MS);
      res = await fetchWithTimeout(`${CIVITAI_API}/images?${params}`);
    }
    if (!res.ok) return null;
    const json = (await res.json()) as {
      items?: CivitaiImage[];
      metadata?: { nextCursor?: string | number | null };
    };
    const nc = json.metadata?.nextCursor;
    return { items: json.items ?? [], nextCursor: nc != null ? String(nc) : null };
  } catch {
    return null;
  }
}

// ── search: paginated model feed for the in-app browser ───────────────────

export type CivitaiSearchType =
  | 'Checkpoint' | 'LORA' | 'LoCon' | 'TextualInversion'
  | 'Hypernetwork' | 'AestheticGradient' | 'Controlnet' | 'Poses'
  | 'VAE' | 'Upscaler' | 'Wildcards';

export type CivitaiSearchSort =
  | 'Highest Rated' | 'Most Downloaded' | 'Most Liked' | 'Most Discussed'
  | 'Most Collected' | 'Most Buzz' | 'Newest';

export type CivitaiSearchPeriod = 'AllTime' | 'Year' | 'Month' | 'Week' | 'Day';

export type CivitaiSearchParams = {
  query?: string;
  /** Each value is a CivitAI model type — multiple OR together. */
  types?: CivitaiSearchType[];
  /** CivitAI base-model labels: "SDXL 1.0", "Pony", "Illustrious", "SD 1.5", "Flux.1 D", … */
  baseModels?: string[];
  sort?: CivitaiSearchSort;
  period?: CivitaiSearchPeriod;
  /** When false, CivitAI omits NSFW entries entirely. When true, both
   *  SFW + NSFW are included (CivitAI doesn't expose an NSFW-only filter
   *  on /models the way /images does). */
  nsfw?: boolean;
  /** Cursor from the previous page's `nextCursor`. */
  cursor?: string | null;
  /** Page size — 20 by default. */
  limit?: number;
  /** Which catalog to hit. 'red' switches to civitai.red, which mirrors the
   *  same API but serves the adult catalog (some adult-rated models only
   *  surface there). Defaults to the standard civitai.com catalog. */
  catalog?: 'civitai' | 'red';
  /** CivitAI rating bitfield (1=G, 2=PG, 4=PG13, 8=R, 16=X, 32=XXX). When
   *  set, sent as repeated `browsingLevels` params and ALSO applied as a
   *  client-side filter against each item's `nsfwLevel`. Unauthed callers
   *  see the API ignore the params, so client-side is what actually narrows
   *  the list. Undefined / 0 disables the filter. */
  browsingLevels?: number;
};

/** One row in a paginated search response. Includes the modelVersions array
 *  so the browser tile can pick a hero image without a follow-up fetch. */
export type CivitaiSearchHit = CivitaiModel;

export type CivitaiSearchPage = {
  items: CivitaiSearchHit[];
  nextCursor: string | null;
};

/**
 * Search the CivitAI model catalog. Powers the in-app model browser.
 *
 * Returns null on a request failure so the caller can render an inline error
 * without throwing through React's render path. Empty results (zero hits)
 * come back as `{ items: [], nextCursor: null }`.
 */
export async function searchCivitaiModels(
  params: CivitaiSearchParams,
  signal?: AbortSignal,
): Promise<CivitaiSearchPage | null> {
  try {
    const qp = new URLSearchParams();
    qp.set('limit', String(params.limit ?? 20));
    if (params.query) qp.set('query', params.query);
    if (params.sort) qp.set('sort', params.sort);
    if (params.period) qp.set('period', params.period);
    if (params.nsfw === false) qp.set('nsfw', 'false');
    if (params.cursor) qp.set('cursor', params.cursor);
    (params.types ?? []).forEach((t) => qp.append('types', t));
    (params.baseModels ?? []).forEach((b) => qp.append('baseModels', b));
    const levelMask = params.browsingLevels ?? 0;
    if (levelMask) {
      for (const bit of [1, 2, 4, 8, 16, 32]) {
        if (levelMask & bit) qp.append('browsingLevels', String(bit));
      }
    }

    const base = params.catalog === 'red' ? CIVITAI_RED_API : CIVITAI_API;
    const url = `${base}/models?${qp}`;
    STATS.issued++;
    let res = await fetchWithTimeout(url, { signal });
    if (res.status === 429) {
      STATS.rateLimited++;
      await sleep(RATE_LIMIT_BACKOFF_MS);
      if (signal?.aborted) return null;
      res = await fetchWithTimeout(url, { signal });
    }
    if (!res.ok) { STATS.failed++; return null; }
    STATS.ok++;
    const json = (await res.json()) as {
      items?: CivitaiSearchHit[];
      metadata?: { nextCursor?: string | number | null };
    };
    const nc = json.metadata?.nextCursor;
    let items = json.items ?? [];
    // Unauthed `browsingLevels` is silently ignored by the API, so narrow
    // client-side: an item's `nsfwLevel` is a bitfield of every level its
    // content spans — keep items whose bits overlap the requested mask.
    if (levelMask) {
      items = items.filter((it) => {
        const lvl = (it as { nsfwLevel?: number }).nsfwLevel ?? 0;
        return lvl === 0 ? (levelMask & 1) !== 0 : (lvl & levelMask) !== 0;
      });
    }
    return { items, nextCursor: nc != null ? String(nc) : null };
  } catch {
    return null;
  }
}
