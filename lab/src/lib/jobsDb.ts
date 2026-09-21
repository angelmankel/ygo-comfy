import { openDB, type IDBPDatabase } from 'idb';
import type { Job } from './types';

/**
 * IndexedDB-backed persistence for the generation queue.
 *
 * Unlike everything else (which lives in localStorage via `storage.ts`), jobs
 * go in IndexedDB: they're written on every status change and we want that to
 * be cheap + structured. Each `Job` carries its own `serverId` — the queue UI
 * and the reconciler use it to attribute jobs to servers.
 *
 * Lifecycle: a job is added when a prompt is queued, updated as it runs, and
 * deleted on completion (the finished image is kept in history instead) or
 * when the user dismisses it.
 */

const DB_NAME = 'imagelab';
/** Must stay in lock-step with `civitaiCache.ts`'s version — they share
 *  this database. If they diverge, the lower-version `openDB` either
 *  blocks indefinitely (waiting for the higher connection to close) or
 *  throws VersionError when it opens second. */
const DB_VERSION = 2;
const STORE = 'jobs';
const HASH_STORE = 'civitai-hashes';
const MODEL_STORE = 'civitai-models';

let _db: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!_db) {
    _db = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Create whichever stores don't yet exist. Both jobsDb and civitaiCache
        // can race to be the first opener; whichever wins runs the upgrade,
        // so each side has to create every store the OTHER side expects.
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(HASH_STORE)) {
          db.createObjectStore(HASH_STORE, { keyPath: 'hash' });
        }
        if (!db.objectStoreNames.contains(MODEL_STORE)) {
          db.createObjectStore(MODEL_STORE, { keyPath: 'modelId' });
        }
      },
      blocked() { console.warn('[jobsDb] open is blocked — another tab is holding an older version'); },
      blocking() { console.warn('[jobsDb] this connection is blocking another open at a newer version'); },
    });
  }
  return _db;
}

/** Every persisted job, across all servers. */
export async function loadJobs(): Promise<Job[]> {
  try {
    const raw = (await (await getDb()).getAll(STORE)) as Array<Job & { workspaceId?: string }>;
    // Accept the legacy `workspaceId` field for jobs persisted before the rename.
    return raw.map(j => ({ ...j, serverId: j.serverId || j.workspaceId || '' }));
  } catch {
    return [];
  }
}

/** Insert or replace a job. */
export async function putJob(job: Job): Promise<void> {
  try {
    await (await getDb()).put(STORE, job);
  } catch {
    /* ignore — persistence is best-effort */
  }
}

/** Drop a single job (completed or dismissed). */
export async function deleteJob(id: string): Promise<void> {
  try {
    await (await getDb()).delete(STORE, id);
  } catch {
    /* ignore */
  }
}

/** Drop every job belonging to a server that's being removed. */
export async function deleteJobsForServer(serverId: string): Promise<void> {
  try {
    const db = await getDb();
    const all = (await db.getAll(STORE)) as Array<Job & { workspaceId?: string }>;
    const tx = db.transaction(STORE, 'readwrite');
    await Promise.all(
      all
        .filter(j => (j.serverId || j.workspaceId) === serverId)
        .map(j => tx.store.delete(j.id)),
    );
    await tx.done;
  } catch {
    /* ignore */
  }
}
