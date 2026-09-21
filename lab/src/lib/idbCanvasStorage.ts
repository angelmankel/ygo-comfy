/**
 * IndexedDB-backed implementation of `CanvasStorage`.
 *
 * Lives in its own database (`imagelab-canvas`) — NOT in the shared
 * `imagelab` DB used by `jobsDb.ts` + `civitaiCache.ts` — because CLAUDE.md's
 * "IndexedDB databases" Gotcha calls out shared-DB version coupling as a
 * known source of pain. Per-feature DBs let the canvas system evolve its
 * schema independently of unrelated stores.
 *
 * Object stores (schema v1):
 *   - `layers`        — keyPath 'id', stores full CanvasLayer rows.
 *   - `layerHistory`  — keyPath 'id', with secondary index `byLayerId`
 *                       on `layerId` for fast per-layer history queries.
 *   - `blobs`         — out-of-line keys (blobId is the key directly), stores
 *                       raw `Blob`s for layer-history images.
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { CanvasLayer, LayerHistoryEntry } from './types';
import type { CanvasStorage } from './canvasStorage';
import { defaultWorkflow } from './storage';

const DB_NAME = 'imagelab-canvas';
const SCHEMA_VERSION = 1;
const LAYERS_STORE = 'layers';
const HISTORY_STORE = 'layerHistory';
const HISTORY_BY_LAYER_INDEX = 'byLayerId';
const BLOBS_STORE = 'blobs';

let _db: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!_db) {
    _db = openDB(DB_NAME, SCHEMA_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(LAYERS_STORE)) {
          database.createObjectStore(LAYERS_STORE, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(HISTORY_STORE)) {
          const store = database.createObjectStore(HISTORY_STORE, { keyPath: 'id' });
          store.createIndex(HISTORY_BY_LAYER_INDEX, 'layerId', { unique: false });
        }
        if (!database.objectStoreNames.contains(BLOBS_STORE)) {
          // Out-of-line keys: the caller's blobId is the IDB key directly.
          database.createObjectStore(BLOBS_STORE);
        }
      },
      blocked() {
        console.warn('[idbCanvasStorage] open is blocked — another tab/connection is holding an older version');
      },
      blocking() {
        console.warn('[idbCanvasStorage] this connection is blocking another open at a newer version');
      },
    });
  }
  return _db;
}

export function createIDBCanvasStorage(): CanvasStorage {
  return {
    async listLayers() {
      const database = await db();
      return (await database.getAll(LAYERS_STORE)) as CanvasLayer[];
    },

    async saveLayer(layer) {
      const database = await db();
      await database.put(LAYERS_STORE, layer);
    },

    async deleteLayer(id) {
      const database = await db();
      // Find this layer's history rows.
      const tx = database.transaction([HISTORY_STORE, LAYERS_STORE], 'readwrite');
      const index = tx.objectStore(HISTORY_STORE).index(HISTORY_BY_LAYER_INDEX);
      const rows = (await index.getAll(id)) as LayerHistoryEntry[];
      const candidateBlobIds = new Set<string>(rows.map((r) => r.blobId));
      // Delete history rows + the layer row in one tx.
      for (const row of rows) {
        await tx.objectStore(HISTORY_STORE).delete(row.id);
      }
      await tx.objectStore(LAYERS_STORE).delete(id);
      await tx.done;

      // For each candidate blobId, drop it iff no other history row still
      // references it. Done in a fresh read-only check + per-key delete; doing
      // this in the same tx as the deletions above would race with the index.
      for (const blobId of candidateBlobIds) {
        const stillReferenced = await isBlobReferenced(database, blobId);
        if (!stillReferenced) {
          await database.delete(BLOBS_STORE, blobId);
        }
      }
    },

    async appendLayerHistory(_layerId, entry) {
      const database = await db();
      await database.put(HISTORY_STORE, entry);
    },

    async listLayerHistory(layerId) {
      const database = await db();
      const rows = (await database.getAllFromIndex(
        HISTORY_STORE,
        HISTORY_BY_LAYER_INDEX,
        layerId,
      )) as LayerHistoryEntry[];
      // Newest-first.
      rows.sort((a, b) => b.at - a.at);
      return rows;
    },

    async deleteLayerHistoryEntry(_layerId, entryId) {
      const database = await db();
      const row = (await database.get(HISTORY_STORE, entryId)) as LayerHistoryEntry | undefined;
      if (!row) return;
      await database.delete(HISTORY_STORE, entryId);
      const stillReferenced = await isBlobReferenced(database, row.blobId);
      if (!stillReferenced) {
        await database.delete(BLOBS_STORE, row.blobId);
      }
    },

    async getBlob(blobId) {
      const database = await db();
      const value = await database.get(BLOBS_STORE, blobId);
      return (value as Blob | undefined) ?? null;
    },

    async putBlob(blobId, blob) {
      const database = await db();
      await database.put(BLOBS_STORE, blob, blobId);
    },

    async deleteBlob(blobId) {
      const database = await db();
      await database.delete(BLOBS_STORE, blobId);
    },
  };
}

/** Does any row in `layerHistory` still reference this blobId? */
async function isBlobReferenced(database: IDBPDatabase, blobId: string): Promise<boolean> {
  // No direct index on blobId — walk via cursor and short-circuit on first hit.
  const tx = database.transaction(HISTORY_STORE, 'readonly');
  let cursor = await tx.store.openCursor();
  while (cursor) {
    const row = cursor.value as LayerHistoryEntry;
    if (row.blobId === blobId) {
      // Don't await tx.done — we're bailing early; the tx will auto-close.
      return true;
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  return false;
}

// ── Dev-only manual exercise ───────────────────────────────────────────────

/**
 * Walk the adapter through its paces against a real IDB. Not a test — just a
 * sanity check the dev can run from the devtools console:
 *
 *     window.__exerciseCanvasStorage()
 *
 * Logs PASS / FAIL with detail. Idempotent enough to re-run repeatedly.
 */
export async function exerciseCanvasStorage(): Promise<boolean> {
  const tag = '[exerciseCanvasStorage]';
  const storage = createIDBCanvasStorage();
  const fails: string[] = [];

  const wf = defaultWorkflow();
  const now = Date.now();
  const l1: CanvasLayer = {
    id: `__test-l1-${now}`,
    type: 'empty',
    name: 'test layer 1',
    bounds: { x: 0, y: 0, w: 512, h: 512 },
    zIndex: 0,
    visible: true,
    locked: false,
    workflow: wf,
    background: { kind: 'transparent' },
    layers: [],
    createdAt: now,
  };
  const l2: CanvasLayer = {
    id: `__test-l2-${now}`,
    type: 'empty',
    name: 'test layer 2',
    bounds: { x: 100, y: 100, w: 512, h: 512 },
    zIndex: 1,
    visible: true,
    locked: false,
    workflow: wf,
    background: { kind: 'solid', color: '#222222' },
    layers: [],
    createdAt: now,
  };

  try {
    await storage.saveLayer(l1);
    await storage.saveLayer(l2);

    const all = await storage.listLayers();
    const hasBoth =
      all.some((l) => l.id === l1.id) && all.some((l) => l.id === l2.id);
    if (!hasBoth) fails.push(`listLayers missing one of (${l1.id}, ${l2.id}); got ${all.length}`);

    // Write 3 history entries for layer 1 + a small blob each.
    const entries: { blobId: string; entryId: string }[] = [];
    for (let i = 0; i < 3; i++) {
      const blobId = `__test-blob-${now}-${i}`;
      const entryId = `__test-h-${now}-${i}`;
      const blob = new Blob([new Uint8Array([i, i, i, i])], { type: 'application/octet-stream' });
      await storage.putBlob(blobId, blob);
      await storage.appendLayerHistory(l1.id, {
        id: entryId,
        layerId: l1.id,
        blobId,
        positive: 'test',
        negative: '',
        seed: i,
        model: 'test.safetensors',
        serverId: 'test-server',
        width: 512,
        height: 512,
        at: now + i,
      });
      entries.push({ blobId, entryId });
    }

    const history = await storage.listLayerHistory(l1.id);
    if (history.length !== 3) fails.push(`expected 3 history rows, got ${history.length}`);
    // Confirm newest-first ordering.
    if (history.length >= 2 && history[0].at < history[1].at) {
      fails.push(`history is not newest-first: ${history.map((h) => h.at).join(',')}`);
    }

    // Confirm blobs round-trip.
    for (const { blobId } of entries) {
      const back = await storage.getBlob(blobId);
      if (!back) fails.push(`blob ${blobId} not retrievable`);
    }

    // Delete layer 1 — cascade should clear its history rows + blobs.
    await storage.deleteLayer(l1.id);

    const remainingLayers = await storage.listLayers();
    if (remainingLayers.some((l) => l.id === l1.id)) fails.push('layer 1 still present after deleteLayer');

    const remainingHistory = await storage.listLayerHistory(l1.id);
    if (remainingHistory.length !== 0) fails.push(`expected 0 history rows after cascade, got ${remainingHistory.length}`);

    for (const { blobId } of entries) {
      const back = await storage.getBlob(blobId);
      if (back) fails.push(`blob ${blobId} survived cascade`);
    }

    // Cleanup: drop layer 2 too.
    await storage.deleteLayer(l2.id);
  } catch (err) {
    fails.push(`threw: ${String(err)}`);
  }

  if (fails.length) {
    // eslint-disable-next-line no-console
    console.error(`${tag} FAIL`, fails);
    return false;
  }
  // eslint-disable-next-line no-console
  console.log(`${tag} PASS`);
  return true;
}

if (typeof window !== 'undefined') {
  (window as unknown as { __exerciseCanvasStorage?: typeof exerciseCanvasStorage }).__exerciseCanvasStorage =
    exerciseCanvasStorage;
}
