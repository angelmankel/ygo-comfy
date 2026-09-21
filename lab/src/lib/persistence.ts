import type { useStore } from './store';
import { useCanvasStore } from './canvasStore';
import {
  saveWorkflow, saveLayers, saveSnippets, saveSnippetCategories, saveHistory,
  saveVeniceSettings, saveCivitaiSettings, saveModelPreviewSource, saveModelPickerFilters, saveServerPickerFilters,
  saveAutoFrameOnComplete, saveSlideshowPlaying, saveCollectionsTileSize,
  saveCollections, saveImportedImages,
  saveServers, saveRouting, saveThemeState,
} from './storage';

type StoreApi = typeof useStore;
type Store = ReturnType<StoreApi['getState']>;

/**
 * Persistence middleware — listens to store mutations and coalesces writes
 * to `localStorage`. One scheduled flush per tick (100ms debounce), with a
 * synchronous flush on `pagehide` / hidden visibility so nothing is lost on
 * tab close or refresh.
 *
 * Replaces the dozens of inline `save*(...)` calls that used to live in
 * store actions — every persisted slice now has a single owner here.
 *
 * `fingerprint` returns a value whose identity changes when persistence is
 * needed. For slices that are immutably replaced (workflow, layers, …) the
 * slice itself is its own fingerprint; for composite persisters (routing,
 * theme) we read the primitive components so a no-op set doesn't re-write.
 *
 * `flush` reads the *current* state — never the snapshot captured at
 * change-detection time — so the coalesced write always reflects the latest
 * value, not an intermediate one.
 */
type Persister = {
  key: string;
  fingerprint: (s: Store) => unknown;
  flush: (s: Store) => void;
};

const persisters: Persister[] = [
  {
    key: 'workflow',
    fingerprint: s => s.workflow,
    flush: s => {
      // Scope-aware: when a canvas layer is *active AND the user is in the
      // canvas editor*, the live `workflow` represents that layer's params,
      // not the global workflow — its true home is the layer's own IDB
      // record (mirrored from setWorkflow). On every other view (generate,
      // collections, …) `workflow` is the global one and must be persisted,
      // even if some canvas layer is incidentally still "selected" in the
      // background. Mirrors runScopeSync's own scope predicate.
      const cs = useCanvasStore.getState();
      if (cs.activeLayerId && cs.mainView === 'canvas') return;
      saveWorkflow(s.workflow);
    },
  },
  {
    key: 'layers',
    fingerprint: s => s.layers,
    // Same scope-aware gate as workflow (#43): when a canvas layer is active
    // *and we're in the canvas editor*, the live `layers` is its prompt set,
    // not the global; persist only when no canvas layer owns the panel so
    // disk state stays "actually global."
    flush: s => {
      const cs = useCanvasStore.getState();
      if (cs.activeLayerId && cs.mainView === 'canvas') return;
      saveLayers(s.layers);
    },
  },
  { key: 'snippets',           fingerprint: s => s.snippets,           flush: s => saveSnippets(s.snippets) },
  { key: 'snippetCategories',  fingerprint: s => s.snippetCategories,  flush: s => saveSnippetCategories(s.snippetCategories) },
  { key: 'history',            fingerprint: s => s.history,            flush: s => saveHistory(s.history) },
  { key: 'venice',             fingerprint: s => s.venice,             flush: s => saveVeniceSettings(s.venice) },
  { key: 'civitai',            fingerprint: s => s.civitai,            flush: s => saveCivitaiSettings(s.civitai) },
  { key: 'modelPreviewSource', fingerprint: s => s.modelPreviewSource, flush: s => saveModelPreviewSource(s.modelPreviewSource) },
  { key: 'modelPickerFilters', fingerprint: s => s.modelPickerFilters, flush: s => saveModelPickerFilters(s.modelPickerFilters) },
  { key: 'serverPickerFilters',fingerprint: s => s.serverPickerFilters,flush: s => saveServerPickerFilters(s.serverPickerFilters) },
  { key: 'autoFrame',          fingerprint: s => s.autoFrameOnComplete,flush: s => saveAutoFrameOnComplete(s.autoFrameOnComplete) },
  { key: 'slideshowPlaying',   fingerprint: s => s.slideshowPlaying,   flush: s => saveSlideshowPlaying(s.slideshowPlaying) },
  { key: 'collectionsTileSize',fingerprint: s => s.collectionsTileSize,flush: s => saveCollectionsTileSize(s.collectionsTileSize) },
  { key: 'collections',        fingerprint: s => s.collections,        flush: s => saveCollections(s.collections) },
  { key: 'importedImages',     fingerprint: s => s.importedImages,     flush: s => saveImportedImages(s.importedImages) },
  { key: 'servers',            fingerprint: s => s.servers,            flush: s => saveServers(s.servers) },
  {
    key: 'routing',
    fingerprint: s => `${s.routing}|${s.roundRobinIndex}`,
    flush: s => saveRouting({ mode: s.routing, rrIndex: s.roundRobinIndex }),
  },
  {
    key: 'theme',
    fingerprint: s => `${s.themeId}|${s.customThemes.length}|${s.customThemes.map(t => t.id).join(',')}`,
    flush: s => saveThemeState({ activeId: s.themeId, customThemes: s.customThemes }),
  },
];

const DEBOUNCE_MS = 100;
const pending = new Set<Persister>();
let timer: ReturnType<typeof setTimeout> | null = null;
let storeRef: StoreApi | null = null;

function schedule(p: Persister) {
  pending.add(p);
  if (timer != null) return;
  timer = setTimeout(flushPersistence, DEBOUNCE_MS);
}

export function flushPersistence() {
  if (timer != null) { clearTimeout(timer); timer = null; }
  if (!storeRef || pending.size === 0) { pending.clear(); return; }
  const s = storeRef.getState();
  const items = [...pending];
  pending.clear();
  for (const p of items) {
    try { p.flush(s); } catch { /* swallow — typically QuotaExceeded */ }
  }
}

export function installPersistence(store: StoreApi) {
  storeRef = store;
  let prev = store.getState();
  // Re-fingerprint the custom-themes case: a deep change inside a theme object
  // doesn't change `themeId` but does change `customThemes` identity, so the
  // theme persister also keys on the array reference.
  store.subscribe((next) => {
    for (const p of persisters) {
      if (p.fingerprint(prev) !== p.fingerprint(next)) schedule(p);
    }
    // `customThemes` deep edits replace the array (immutable updates) so the
    // identity check below catches them; the string fingerprint above only
    // catches add/remove. Keep both — cheap and explicit.
    if (prev.customThemes !== next.customThemes) {
      const themePersister = persisters.find(p => p.key === 'theme')!;
      schedule(themePersister);
    }
    prev = next;
  });

  if (typeof window !== 'undefined') {
    // pagehide fires for refresh / close / bfcache; visibilitychange fires when
    // the user backgrounds the tab — both are last-chance opportunities to
    // commit pending writes before the JS context can vanish.
    window.addEventListener('pagehide', flushPersistence);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushPersistence();
    });
  }
}
