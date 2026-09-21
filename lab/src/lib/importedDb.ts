import { openDB, type IDBPDatabase } from 'idb';

/**
 * IndexedDB-backed blob store for imported images. The id key matches the
 * `ImportedImage.id` recorded in localStorage (`IMPORTED_IMAGES_KEY`), so the
 * Collections panel can render its tile grid synchronously from the metadata
 * list and resolve `URL.createObjectURL(blob)` on demand for each thumbnail.
 *
 * Lives in its OWN database (`imagelab-imports`) rather than the shared
 * `imagelab` DB used by `jobsDb` + `civitaiCache`, because those two modules
 * each open it with their own `DB_VERSION`/`SCHEMA_VERSION` and adding a third
 * store would risk an upgrade that wipes the CivitAI cache. A separate DB is
 * a cheap isolation.
 */

const DB_NAME = 'imagelab-imports';
const DB_VERSION = 1;
const STORE = 'blobs';

let _db: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!_db) {
    _db = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE); // key passed explicitly per call
        }
      },
    });
  }
  return _db;
}

/** Write one blob, keyed by its `ImportedImage.id`. */
export async function putImportedBlob(id: string, blob: Blob): Promise<void> {
  try {
    await (await getDb()).put(STORE, blob, id);
  } catch {
    /* best-effort persistence */
  }
}

/** Read one blob. Returns undefined if the id has never been stored or the
 *  user cleared site data. */
export async function getImportedBlob(id: string): Promise<Blob | undefined> {
  try {
    return (await (await getDb()).get(STORE, id)) as Blob | undefined;
  } catch {
    return undefined;
  }
}

/** Delete one blob — paired with removing the matching `ImportedImage` entry
 *  from `IMPORTED_IMAGES_KEY`. */
export async function deleteImportedBlob(id: string): Promise<void> {
  try {
    await (await getDb()).delete(STORE, id);
  } catch {
    /* ignore */
  }
}

/** Drop every imported blob — used by a future "clear imports" action. */
export async function clearImportedBlobs(): Promise<void> {
  try {
    await (await getDb()).clear(STORE);
  } catch {
    /* ignore */
  }
}
