/**
 * IndexedDB-backed cache for CivitAI data. Two object stores:
 *
 *   civitai-hashes  — keyed by model SHA256. The `by-hash` lookup result;
 *                     maps a local model file to its CivitAI identity.
 *   civitai-models  — keyed by CivitAI modelId. The full `models/:id` payload
 *                     the metadata modal renders (all versions, gallery, …).
 *
 * Why IndexedDB and not localStorage (which the rest of `storage.ts` uses):
 * these payloads can grow to several MB (full responses, image arrays,
 * descriptions) — past localStorage's ~5 MB ceiling — and they're read on
 * startup / modal open, where a synchronous multi-MB JSON.parse would jank
 * the UI. IndexedDB is async and effectively unbounded for this.
 *
 * Entries are immutable-by-key, so there's no invalidation logic here; the
 * freshness policy (permanent "found", expiring "not-found") lives in
 * `civitai.ts`. Bumping SCHEMA_VERSION drops and rebuilds every store — fine,
 * it's only a cache.
 */
import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'imagelab';
const HASH_STORE = 'civitai-hashes';
const MODEL_STORE = 'civitai-models';
const JOBS_STORE = 'jobs';
/** Bump when a cache entry shape changes — wipes & rebuilds the civitai
 *  stores. Must stay in lock-step with `jobsDb.ts`'s version since they
 *  share the same database. */
const SCHEMA_VERSION = 2;

type CacheStatus = 'found' | 'not-found' | 'error';

/** A `by-hash` lookup result, keyed by model SHA256. */
export interface CivitaiCacheEntry {
  /** Model SHA256 — the primary key. */
  hash: string;
  /**
   * 'found'     — CivitAI returned metadata (`data` is the full response).
   * 'not-found' — CivitAI 404'd; the model isn't on CivitAI (`data` is null).
   * 'error'     — transient failure; NOT persisted, returned in-memory only.
   */
  status: CacheStatus;
  /** When this entry was fetched (`Date.now()`). */
  fetchedAt: number;
  /** The full, verbatim `by-hash` response when `status === 'found'`, else null. */
  data: unknown | null;
}

/** A full `models/:id` payload, keyed by CivitAI modelId. */
export interface CivitaiModelCacheEntry {
  /** CivitAI modelId — the primary key. */
  modelId: number;
  /** When this entry was fetched (`Date.now()`). Always 'found' — misses throw. */
  fetchedAt: number;
  /** The full, verbatim `models/:id` response. */
  data: unknown;
}

let _db: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!_db) {
    _db = openDB(DB_NAME, SCHEMA_VERSION, {
      upgrade(database) {
        // Civitai caches: drop and recreate on any version bump (they rebuild
        // themselves from the network on next use, no migration needed).
        for (const name of [HASH_STORE, MODEL_STORE]) {
          if (database.objectStoreNames.contains(name)) database.deleteObjectStore(name);
        }
        database.createObjectStore(HASH_STORE, { keyPath: 'hash' });
        database.createObjectStore(MODEL_STORE, { keyPath: 'modelId' });
        // Ensure the jobs store exists too — historically jobsDb.ts owned its
        // creation at its own version 1, but if civitaiCache opens first at
        // v2 and the user has no prior data, the jobs store would never get
        // created. Defensively create it here as well.
        if (!database.objectStoreNames.contains(JOBS_STORE)) {
          database.createObjectStore(JOBS_STORE, { keyPath: 'id' });
        }
      },
      blocked() { console.warn('[civitaiCache] open is blocked — another tab/connection is holding an older version'); },
      blocking() { console.warn('[civitaiCache] this connection is blocking another open at a newer version'); },
    });
  }
  return _db;
}

// ── by-hash store ──────────────────────────────────────────────────────────

/** Read one hash entry. Returns undefined if the hash has never been cached. */
export async function getCivitai(hash: string): Promise<CivitaiCacheEntry | undefined> {
  return (await db()).get(HASH_STORE, hash) as Promise<CivitaiCacheEntry | undefined>;
}

/**
 * Batch-read many hashes in a single readonly transaction.
 *
 * Implementation notes: the previous version used `hashes.map(async h => await tx.store.get(h))`,
 * which is a footgun with `idb` + many keys. Each async callback `await`s its
 * request, which yields a microtask AFTER the request resolves; with hundreds
 * of keys the transaction can auto-commit before the next `tx.store.get(h)`
 * runs, throwing `TransactionInactiveError` and (worse) hanging
 * `Promise.all` if some requests never settled. We now fire every request
 * synchronously before any `await`, so all gets are queued on the same live
 * transaction.
 */
export async function getCivitaiMany(hashes: string[]): Promise<Map<string, CivitaiCacheEntry>> {
  const out = new Map<string, CivitaiCacheEntry>();
  if (!hashes.length) return out;
  const database = await db();
  const tx = database.transaction(HASH_STORE, 'readonly');
  // Queue ALL requests synchronously before awaiting any — keeps the
  // transaction alive across the whole batch.
  const requests = hashes.map((hash) => tx.store.get(hash) as Promise<CivitaiCacheEntry | undefined>);
  const entries = await Promise.all(requests);
  for (let i = 0; i < hashes.length; i++) {
    const entry = entries[i];
    if (entry) out.set(hashes[i], entry);
  }
  await tx.done;
  return out;
}

/** Write one hash entry. */
export async function putCivitai(entry: CivitaiCacheEntry): Promise<void> {
  await (await db()).put(HASH_STORE, entry);
}

/** Write many hash entries in a single readwrite transaction. */
export async function putCivitaiMany(entries: CivitaiCacheEntry[]): Promise<void> {
  if (!entries.length) return;
  const tx = (await db()).transaction(HASH_STORE, 'readwrite');
  await Promise.all(entries.map((entry) => tx.store.put(entry)));
  await tx.done;
}

// ── by-modelId store ───────────────────────────────────────────────────────

/** Read one full-model entry. Returns undefined if the modelId isn't cached. */
export async function getCivitaiModel(modelId: number): Promise<CivitaiModelCacheEntry | undefined> {
  return (await db()).get(MODEL_STORE, modelId) as Promise<CivitaiModelCacheEntry | undefined>;
}

/** Write one full-model entry. */
export async function putCivitaiModel(entry: CivitaiModelCacheEntry): Promise<void> {
  await (await db()).put(MODEL_STORE, entry);
}

// ── maintenance ────────────────────────────────────────────────────────────

/** Drop every cached entry in both stores. */
export async function clearCivitaiCache(): Promise<void> {
  const database = await db();
  await Promise.all([database.clear(HASH_STORE), database.clear(MODEL_STORE)]);
}
