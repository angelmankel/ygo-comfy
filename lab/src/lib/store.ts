import { create } from 'zustand';
import { installPersistence } from './persistence';
import type {
  Layer, Snippet, SnippetCategory, HistoryEntry, WorkflowState, WorkflowCheckpoint, WorkflowLora,
  ServerInfo, Status, LayerKind, Job, Collection, ImportedImage,
} from './types';
import type { ModelHash, WsEvent } from './comfy';
import {
  interruptPrompt, deleteQueuedPrompt,
  fetchServerInfo, fetchPromptResult, fetchQueue,
} from './comfy';
import { createFavorite, deleteFavorite, type ServerFavorite } from './favorites';
import { getCanvasController } from './canvasContext';
import { useCanvasStore } from './canvasStore';
import { canvasStorage } from './canvasStorageInstance';
import type { LayerHistoryEntry } from './types';
import { missingResources } from './routing';
import type { CivitaiCacheEntry } from './civitai';
import {
  loadLayers, loadSnippets, loadSnippetCategories,
  loadHistory, loadWorkflow, loadVeniceSettings, loadCivitaiSettings,
  loadModelPreviewSource, loadModelPickerFilters, loadServerPickerFilters,
  loadAutoFrameOnComplete,
  loadSlideshowPlaying, loadCollectionsTileSize,
  loadThemeState, loadCollections, loadImportedImages,
  getServers, loadRouting, ROUND_ROBIN,
  FALLBACKS, HISTORY_MAX, uid, DEFAULT_COMFY_HOST, DEFAULT_CATEGORY_ID,
} from './storage';
import type { Server, VeniceSettings, CivitaiSettings, ModelPreviewSource, ModelPickerFilters, ServerPickerFilters } from './storage';
import { putImportedBlob, deleteImportedBlob } from './importedDb';
import type { Theme } from './themes';
import { resolveTheme } from './themes';
import { putJob, deleteJob as deleteJobDb, deleteJobsForServer } from './jobsDb';

/** Which server's preview the canvas shows: every server (`all`, a 2×2/3×3
 *  grid), whichever job streamed most recently (`last`), or one server id. */

/** Empty `ServerInfo` — the initial union before any server reports in. */
const EMPTY_INFO: ServerInfo = { ...FALLBACKS, models: [], upscaleModels: [] };

/**
 * Mirror a completed history entry into a canvas-layer's per-layer history
 * index. The blob is fetched independently and stored as a separate copy via
 * canvasStorage so deletes from one side don't affect the other (per the
 * decoupling requirement in epic #18). Also updates the layer's
 * `selectedHistoryId` so per-layer history navigation knows where it is.
 *
 * Best-effort: every step is wrapped in try/catch + console.warn — failures
 * never block the main completion path. The on-canvas stamp via
 * controller.setLayerImage already happened (it uses the live image URL),
 * so the user sees the result regardless of whether IDB persistence works.
 */
async function stampLayerHistory(layerId: string, entry: HistoryEntry, url: string) {
  try {
    // The layer may have been deleted between job-queue and job-complete.
    // updateCanvasLayer guards for unknown ids (no-op + warn) but check
    // up-front so we don't waste a blob fetch.
    const cs = useCanvasStore.getState();
    if (!cs.canvasLayers.some(l => l.id === layerId)) return;

    const blobId = uid();
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn(`[stampLayerHistory] blob fetch failed: ${resp.status}`);
      return;
    }
    const blob = await resp.blob();
    await canvasStorage.putBlob(blobId, blob);
    const layerEntry: LayerHistoryEntry = {
      id: uid(),
      layerId,
      blobId,
      positive: entry.positive,
      negative: entry.negative,
      seed: entry.seed,
      model: entry.model,
      serverId: entry.serverId,
      width: entry.workflow?.width ?? 0,
      height: entry.workflow?.height ?? 0,
      at: entry.createdAt,
    };
    await canvasStorage.appendLayerHistory(layerId, layerEntry);
    // Point the layer at its newest stamp so the sprite swaps to it and
    // per-layer ← / → nav starts here. The previous selection is one click
    // away in the layer-row's history strip.
    useCanvasStore.getState().updateCanvasLayer(layerId, {
      selectedHistoryId: layerEntry.id,
    });
    // Late-bind the controller's cache entry to this blob so the
    // viewport-eviction system (#27) can restore it if the layer scrolls
    // off-screen. The setLayerImage call earlier in the completion flow
    // didn't know the blob id yet — only after putBlob completes is it
    // safe to claim "this layer's texture comes from blob X."
    getCanvasController()?.setLayerBlobId(layerId, blobId);
  } catch (err) {
    console.warn('[stampLayerHistory] failed', err);
  }
}

/**
 * Set `useStore.layers` AND mirror it back to the active canvas layer's
 * IDB record if one is active (#43). Every prompt-layer mutating store
 * action must route through this — direct `set({ layers })` calls leak
 * past the per-canvas-layer scope, leaving edits in useStore that the
 * next layer switch (or reload) silently reverts.
 */
function setLayersAndMirror(layers: Layer[]) {
  useStore.setState({ layers });
  const cs = useCanvasStore.getState();
  // Only mirror into the active canvas layer when the user is actually
  // editing in the canvas view — otherwise generate-view layer edits leak
  // into a stale canvas-layer selection (and aren't persisted globally).
  // Mirrors runScopeSync's scope predicate.
  if (cs.activeLayerId && cs.mainView === 'canvas') {
    cs.updateCanvasLayer(cs.activeLayerId, { layers });
  }
}

/**
 * Crop a result image to a fractional sub-rect and return a fresh blob URL.
 * Used by the from-canvas inpaint path where the queued image is the wider
 * context but only the masked region belongs on the layer. Coords are
 * fractions of the result image's natural size so we don't need to know
 * what resolution ComfyUI ran the inpaint at. Returns `null` on load /
 * encode failure — callers fall back to the uncropped URL.
 */
async function cropImageUrl(
  url: string,
  crop: { fx: number; fy: number; fw: number; fh: number },
): Promise<string | null> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('image load failed'));
      el.src = url;
    });
    const sx = Math.max(0, Math.round(crop.fx * img.naturalWidth));
    const sy = Math.max(0, Math.round(crop.fy * img.naturalHeight));
    const sw = Math.max(1, Math.round(crop.fw * img.naturalWidth));
    const sh = Math.max(1, Math.round(crop.fh * img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(b => r(b), 'image/png'));
    return blob ? URL.createObjectURL(blob) : null;
  } catch (err) {
    console.warn('[cropImageUrl] failed', err);
    return null;
  }
}

/** Prompt ids whose completion fetch is in flight — used by `handleWsEvent`
 *  to dodge duplicate result fetches when ComfyUI fires `executing(node=null)`
 *  more than once for the same prompt. Module-level since the store is a
 *  singleton and the set is purely process-lifetime state, not persisted. */
const _completingPromptIds = new Set<string>();

/** Per-server in-flight `refreshServerInfo` promises — lets the three callers
 *  (initial boot, WS onOpen, post-download capability refresh) dedupe without
 *  coordinating. The promise lives in the map until it settles. */
const _inflightServerInfo = new Map<string, Promise<void>>();

/** Round-robin eligibility filter. Online by default; with a workflow, also
 *  capable of running it. Used by both `peekNextServer` and `advanceRoundRobin`
 *  so the cursor never walks a list one of them used and the other didn't. */
function rrEligibleServers(
  servers: Server[],
  serverInfo: Record<string, ServerInfo>,
  workflow: WorkflowState | undefined,
): Server[] {
  return servers.filter(sv => {
    if (sv.enabled === false) return false;
    const info = serverInfo[sv.id];
    if (!info) return false;
    if (!workflow) return true;
    return missingResources(workflow, info).length === 0;
  });
}

/** Merge every reporting server's capabilities into one union list — this is
 *  what populates the dropdown option lists. */
function unionInfo(record: Record<string, ServerInfo>): ServerInfo {
  const infos = Object.values(record);
  if (!infos.length) return EMPTY_INFO;
  const merge = (key: keyof ServerInfo): string[] => {
    const set = new Set<string>();
    for (const info of infos) for (const v of info[key]) set.add(v);
    return [...set];
  };
  return {
    samplers: merge('samplers'),
    schedulers: merge('schedulers'),
    models: merge('models'),
    vaes: merge('vaes'),
    loras: merge('loras'),
    tagModels: merge('tagModels'),
    upscaleModels: merge('upscaleModels'),
    controlnets: merge('controlnets'),
  };
}

type Store = {
  workflow: WorkflowState;
  /** Snapshot of the global workflow while a layer scope is active. Restored
   *  to `workflow` when leaving layer scope so the user's untouched global
   *  params come back. Internal — set by the panel-set scope-sync. */
  _globalWorkflowBackup: WorkflowState | null;
  /** Parallel to _globalWorkflowBackup but for `layers` (#43). Saved when
   *  a canvas layer activates so deselect restores the global prompt set. */
  _globalLayersBackup: Layer[] | null;
  layers: Layer[];
  snippets: Snippet[];
  snippetCategories: SnippetCategory[];
  venice: VeniceSettings;
  civitai: CivitaiSettings;
  /** Where the model picker's hover slideshow pulls its starting image from. */
  modelPreviewSource: ModelPreviewSource;
  /** Persisted base-model filter per model kind (checkpoint/lora/vae). */
  modelPickerFilters: ModelPickerFilters;
  /** Persisted per-server filter — list of server IDs the picker is scoped
   *  to. Empty array (or missing kind) = no filter (show all servers). */
  serverPickerFilters: ServerPickerFilters;
  /** When true (default), a completed job jumps the canvas to its image and
   *  fits to view; when false the canvas stays put. */
  autoFrameOnComplete: boolean;
  /** Min thumbnail width (px) for the Collections grid — driven by the
   *  slider in its toolbar. Wider = larger thumbnails / fewer columns. */
  collectionsTileSize: number;
  history: HistoryEntry[];
  /** The history entry the canvas / recall / info actions act on. */
  selectedEntry: HistoryEntry | null;
  /** Union of every server's capabilities — populates the dropdown options. */
  server: ServerInfo;
  /** Per-server capabilities, keyed by server id. Absent = offline/unknown. */
  serverInfo: Record<string, ServerInfo>;
  status: Status;

  // Generation queue — persisted to IndexedDB (`jobsDb`) so in-flight work
  // survives a refresh. Each job carries its own `serverId`.
  jobs: Job[];

  // Model hashes — merged across every server (a model file is the same
  // content wherever it lives). Feeds the model-metadata / CivitAI lookups.
  modelHashes: ModelHash[];
  // CivitAI `by-hash` lookups, keyed by SHA256. Content-addressed → global.
  civitaiByHash: Record<string, CivitaiCacheEntry>;

  /** Server-side favorites, keyed by server id. Populated by the favorites
   *  polling hook; consumed by the Collections grid. Each entry's content lives
   *  on exactly one ComfyUI host. */
  serverFavorites: Record<string, ServerFavorite[]>;
  /** ETag for each server's favorites list — lets the poll do conditional GETs. */
  serverFavoritesVersion: Record<string, string>;

  // Servers — ComfyUI endpoints. They hold no isolated state anymore; jobs are
  // spread across them by `routing`.
  servers: Server[];
  /** 'round-robin' or a specific server id. */
  routing: string;
  /** Rotating cursor for round-robin (index into the *online* servers). */
  roundRobinIndex: number;

  // Fullscreen image viewer — global so it can be opened from the canvas
  // floating button and keyboard shortcuts, not just the History panel.
  viewerOpen: boolean;
  viewerClosedAt: number;
  /** Whether the viewer should open with its info/metadata panel expanded. */
  viewerInfoOpen: boolean;
  /** Slideshow play/pause state — shared between the history fullscreen viewer
   *  and the model-metadata gallery so toggling in one place persists everywhere. */
  slideshowPlaying: boolean;

  /** Transient id of a freshly-added prompt layer that should be auto-focused
   *  and scrolled into view by `<LayerCard>` on its first paint. Cleared by
   *  the card after it consumes the signal so re-renders don't refocus and
   *  steal the cursor mid-edit. Never persisted. */
  pendingFocusLayerId: string | null;

  /** Active theme id — points at a built-in or a custom theme. */
  themeId: string;
  /** User-authored themes — forks of any built-in. */
  customThemes: Theme[];

  // Collections — user-defined image groups. Items are HistoryEntry OR
  // ImportedImage ids (same uid() namespace). See `lib/types.ts`.
  collections: Collection[];
  /** Imported (uploaded) image metadata. Blob bytes live in `importedDb.ts`. */
  importedImages: ImportedImage[];

  setWorkflow: (patch: Partial<WorkflowState>) => void;
  setStatus: (text: string, kind?: Status['kind']) => void;
  setServerInfo: (serverId: string, info: ServerInfo) => void;
  dropServerInfo: (serverId: string) => void;
  /** Fetch a server's `/object_info` and reconcile it into `serverInfo`. The
   *  only legitimate way to refresh a server's capabilities — dedupes concurrent
   *  in-flight refreshes per server. Drops the server's info on error. */
  refreshServerInfo: (serverId: string) => Promise<void>;
  /** Walk a server's persisted jobs against its live queue + history and
   *  promote / drop them accordingly. Used at boot and after WS (re)connect. */
  reconcileServerJobs: (serverId: string) => Promise<void>;
  /** Single entry-point for every WS frame from any server. Owns the entire
   *  preview-paint / progress / completion / error pipeline so the hook layer
   *  stays a thin lifecycle manager and React never sees stale closures. */
  handleWsEvent: (serverId: string, ev: WsEvent) => Promise<void>;

  // Routing
  setRouting: (mode: string) => void;
  /** The server a new job would go to right now — does NOT advance the
   *  round-robin cursor. Returns null when round-robin has no online servers.
   *
   *  When `opts.workflow` is supplied, the round-robin filter also excludes
   *  any server that's online but missing a resource the workflow needs
   *  (checkpoint, VAE, LoRA, sampler, …). Generation passes its workflow so
   *  the picker can't land on a dead-on-arrival server; non-generation
   *  callers (e.g. the image-tool runner in `EditImageModal`) leave it off
   *  because they're driving a different graph than the editor workflow. */
  peekNextServer: (opts?: { workflow?: WorkflowState }) => Server | null;
  /** Advance the round-robin cursor — called after a job is successfully
   *  queued, so a failed queue attempt doesn't silently skip a server.
   *  Pass the same `opts` you used for `peekNextServer` so the cursor walks
   *  the same filtered set. */
  advanceRoundRobin: (opts?: { workflow?: WorkflowState }) => void;

  // Jobs — the generation queue. Completed jobs are removed (the finished
  // image lives in history); errored jobs stay until dismissed.
  addJob: (job: Job) => void;
  updateJob: (id: string, patch: Partial<Job>) => void;
  removeJob: (id: string) => void;
  setJobs: (jobs: Job[]) => void;
  /** Cancel a job on its ComfyUI server (interrupt if running, dequeue if
   *  pending) and drop it from the local queue. */
  cancelJob: (id: string) => void;

  // Model hashes + CivitAI lookups
  setModelHashes: (hashes: ModelHash[]) => void;
  mergeCivitai: (entries: CivitaiCacheEntry[]) => void;

  // Server actions
  addServer: (name: string, host: string) => void;
  updateServer: (id: string, patch: Partial<Pick<Server, 'name' | 'host' | 'enabled'>>) => void;
  removeServer: (id: string) => void;

  // Fullscreen viewer actions
  openViewer: (opts?: { withInfo?: boolean }) => void;
  closeViewer: () => void;
  toggleViewer: () => void;
  setSlideshowPlaying: (playing: boolean) => void;

  // Layers
  addLayer: (kind: LayerKind, init?: Partial<Layer>) => string;
  /** Caller-side helpers for the one-shot `pendingFocusLayerId` signal —
   *  `request` flags a layer for focus + scroll; `consume` clears it after
   *  the LayerCard's first paint so re-renders never re-focus. */
  requestLayerFocus: (id: string) => void;
  consumeLayerFocus: () => void;
  updateLayer: (id: string, patch: Partial<Layer>) => void;
  removeLayer: (id: string) => void;
  duplicateLayer: (id: string) => void;
  reorderLayers: (kind: LayerKind, fromId: string, toId: string) => void;
  /** Wipe every layer of `kind` and install `items` in their place. Layers
   *  of the *other* kind are untouched (negative quality boilerplate stays
   *  while the user regenerates the positive prompt, and vice-versa). */
  replaceLayers: (kind: LayerKind, items: Array<{ tag: string; text: string; weight?: number }>) => void;
  moveLayer: (id: string, dir: -1 | 1) => void;

  // Snippets
  addSnippet: (s: Omit<Snippet, 'id'>) => string;
  updateSnippet: (id: string, patch: Partial<Omit<Snippet, 'id'>>) => void;
  removeSnippet: (id: string) => void;
  /** Insert the snippet as a new layer; the layer carries `originSnippetId`
   *  so the library can show the snippet as "on" and the toggle can find it. */
  insertSnippetAsLayer: (id: string) => void;
  /** Remove every layer originating from the given snippet (matched via
   *  `originSnippetId`). Used by the Snippet Library's on/off toggle. */
  removeLayersFromSnippet: (snippetId: string) => void;

  // Snippet categories
  addSnippetCategory: (name: string, icon?: string) => string;
  updateSnippetCategory: (id: string, patch: Partial<Omit<SnippetCategory, 'id'>>) => void;
  /** Remove a category; its snippets fall back to "Uncategorized". */
  removeSnippetCategory: (id: string) => void;

  // Venice AI settings
  setVenice: (patch: Partial<VeniceSettings>) => void;
  setCivitai: (patch: Partial<CivitaiSettings>) => void;

  // Model-preview source / model-picker filter persistence
  setModelPreviewSource: (src: ModelPreviewSource) => void;
  setModelPickerFilter: (kind: string, bucket: string) => void;
  setServerPickerFilter: (kind: string, serverIds: string[]) => void;
  setAutoFrameOnComplete: (on: boolean) => void;
  setCollectionsTileSize: (px: number) => void;

  // Checkpoints — live on `workflow.checkpoints`; [0] is the base, entries 2+ merge.
  addCheckpoint: (name: string) => void;
  removeCheckpoint: (id: string) => void;
  updateCheckpoint: (id: string, patch: Partial<Omit<WorkflowCheckpoint, 'id'>>) => void;

  // LoRAs — live on `workflow.loras`; these are convenience actions over setWorkflow.
  addLora: (name: string) => void;
  removeLora: (id: string) => void;
  updateLora: (id: string, patch: Partial<Omit<WorkflowLora, 'id'>>) => void;

  // History
  pushHistory: (entry: HistoryEntry) => HistoryEntry;
  selectHistoryEntry: (entry: HistoryEntry | null) => void;
  /** Apply the selected image's saved workflow + prompt layers to the editor. */
  recallSelected: () => void;
  clearHistory: () => void;
  toggleHistoryLiked: (id: string) => void;
  removeHistoryEntry: (id: string) => void;
  clearUnliked: () => void;
  /** Replace the cached favorite list for a server (called by the polling hook). */
  setServerFavorites: (serverId: string, version: string, favorites: ServerFavorite[]) => void;
  /** Delete a server-side favorite (no matching local history entry). Optimistically
   *  removes it from `serverFavorites` and hits the DELETE endpoint. */
  removeServerFavorite: (serverId: string, favoriteId: string) => void;

  // Collections
  createCollection: (name: string, icon?: string, color?: string) => string;
  renameCollection: (id: string, name: string) => void;
  updateCollection: (id: string, patch: Partial<Omit<Collection, 'id' | 'itemIds' | 'createdAt'>>) => void;
  deleteCollection: (id: string) => void;
  reorderCollections: (orderedIds: string[]) => void;
  /** Add an item id to a collection (no-op if already a member). */
  addToCollection: (collectionId: string, itemId: string) => void;
  /** Remove an item id from a single collection. */
  removeFromCollection: (collectionId: string, itemId: string) => void;
  /** Strip an item id from every collection — paired with deleting the item. */
  removeItemFromAllCollections: (itemId: string) => void;

  // Imported images — the user's uploaded files. Blob bytes go to IDB; this
  // store keeps the metadata list so the panel renders synchronously.
  addImportedImage: (blob: Blob, init: { name: string; width: number; height: number }) => Promise<ImportedImage>;
  removeImportedImage: (id: string) => void;
  toggleImportedLiked: (id: string) => void;

  /** Set AI metadata (tags/description/aiPrompt) on whichever list the item
   *  id belongs to (history or imported). One-call abstraction so the
   *  Collections panel doesn't have to branch. */
  setItemAi: (itemId: string, patch: { tags?: string[]; description?: string; aiPrompt?: string }) => void;

  // Theme actions
  setThemeId: (id: string) => void;
  /** Fork an existing theme into a new custom theme; returns the new id. */
  createCustomTheme: (sourceId: string, name?: string) => string;
  updateCustomTheme: (id: string, patch: Partial<Theme>) => void;
  deleteCustomTheme: (id: string) => void;
};

export const useStore = create<Store>((set, get) => {
  const routing0 = loadRouting();
  const theme0 = loadThemeState();

  return {
    workflow: loadWorkflow(),
    _globalWorkflowBackup: null,
    _globalLayersBackup: null,
    layers: loadLayers(),
    snippets: loadSnippets(),
    snippetCategories: loadSnippetCategories(),
    venice: loadVeniceSettings(),
    civitai: loadCivitaiSettings(),
    modelPreviewSource: loadModelPreviewSource(),
    modelPickerFilters: loadModelPickerFilters(),
    serverPickerFilters: loadServerPickerFilters(),
    autoFrameOnComplete: loadAutoFrameOnComplete(),
    collectionsTileSize: loadCollectionsTileSize(),
    history: loadHistory(),
    selectedEntry: null,
    server: EMPTY_INFO,
    serverInfo: {},
    status: { text: 'Connecting…', kind: '' },
    modelHashes: [],
    civitaiByHash: {},
    serverFavorites: {},
    serverFavoritesVersion: {},
    jobs: [],

    servers: getServers(),
    routing: routing0.mode,
    roundRobinIndex: routing0.rrIndex,

    viewerOpen: false,
    viewerClosedAt: 0,
    viewerInfoOpen: false,
    slideshowPlaying: loadSlideshowPlaying(true),
    pendingFocusLayerId: null,

    themeId: theme0.activeId,
    customThemes: theme0.customThemes,

    collections: loadCollections(),
    importedImages: loadImportedImages(),

    setWorkflow: (patch) => set(s => {
      const workflow = { ...s.workflow, ...patch };
      // Per-layer scope mirror: when a canvas layer is active *and the user
      // is editing in the canvas view*, the live `workflow` represents that
      // layer's params — push the edit into the layer's IDB record so future
      // activations or reloads restore correctly. On every other view the
      // workflow is global; mirroring it into a stale canvas-layer selection
      // would pollute that layer's params with edits the user expected to
      // hit the global workflow. Mirrors runScopeSync's scope predicate.
      const cs = useCanvasStore.getState();
      if (cs.activeLayerId && cs.mainView === 'canvas') {
        cs.updateCanvasLayer(cs.activeLayerId, { workflow });
      }
      return { workflow };
    }),
    setStatus: (text, kind = '') => set({ status: { text, kind } }),

    // No reconciliation here: the workflow is global and a model may legitimately
    // live on only some servers. Invalid-for-the-target selections are surfaced
    // as disabled options in the dropdowns and block generation instead.
    setServerInfo: (serverId, info) => set(s => {
      const serverInfo = { ...s.serverInfo, [serverId]: info };
      return { serverInfo, server: unionInfo(serverInfo) };
    }),
    dropServerInfo: (serverId) => set(s => {
      if (!(serverId in s.serverInfo)) return s;
      const serverInfo = { ...s.serverInfo };
      delete serverInfo[serverId];
      return { serverInfo, server: unionInfo(serverInfo) };
    }),

    refreshServerInfo: (serverId) => {
      const existing = _inflightServerInfo.get(serverId);
      if (existing) return existing;
      const server = get().servers.find(sv => sv.id === serverId);
      if (!server) return Promise.resolve();
      const p = (async () => {
        try {
          const info = await fetchServerInfo(server.host);
          get().setServerInfo(serverId, info);
        } catch {
          get().dropServerInfo(serverId);
        } finally {
          _inflightServerInfo.delete(serverId);
        }
      })();
      _inflightServerInfo.set(serverId, p);
      return p;
    },

    reconcileServerJobs: async (serverId) => {
      const server = get().servers.find(sv => sv.id === serverId);
      if (!server) return;
      const mine = get().jobs.filter(j => j.serverId === serverId);
      if (!mine.length) return;
      let queue: { running: string[]; pending: string[] };
      try { queue = await fetchQueue(server.host); } catch { return; }
      for (const job of mine) {
        if (queue.running.includes(job.id)) {
          const before = get().jobs.find(j => j.id === job.id);
          get().updateJob(job.id, { status: 'running' });
          // First time we're learning this is the running job — let the
          // status bar say so. ComfyUI doesn't replay progress events to
          // clients that connect mid-execution, so without this hint the
          // bar would stay on "Connecting…" until the next node finishes.
          if (before?.status !== 'running') {
            get().setStatus(`Running job on ${server.name}…`, 'busy');
          }
          continue;
        }
        if (queue.pending.includes(job.id)) {
          get().updateJob(job.id, { status: 'queued' });
          continue;
        }
        // Not running, not pending — finished while away, or dropped.
        const res = await fetchPromptResult(server.host, job.id, job);
        if ('error' in res) {
          get().removeJob(job.id);
        } else {
          const stamped = get().pushHistory({
            ...res.entry,
            serverId,
            ...(job.targetLayerId ? { layerId: job.targetLayerId } : {}),
          });
          get().removeJob(job.id);
          if (job.targetLayerId) {
            // Same layer-targeted post-completion path as in handleWsEvent.
            const ctl = getCanvasController();
            const stampUrl = job.resultCrop
              ? (await cropImageUrl(res.url, job.resultCrop)) ?? res.url
              : res.url;
            ctl?.setLayerImage(job.targetLayerId, stampUrl);
            void stampLayerHistory(job.targetLayerId, stamped, stampUrl);
            get().setStatus('Ready', 'ok');
          } else if (get().autoFrameOnComplete) {
            get().selectHistoryEntry(stamped);
            getCanvasController()?.loadHttpUrl(res.url, (ok) =>
              get().setStatus(ok ? 'Ready' : 'Image load failed', ok ? 'ok' : 'error'));
          } else {
            get().setStatus('Ready', 'ok');
          }
        }
      }
    },

    handleWsEvent: async (serverId, ev) => {
      const s = get();
      const setStatus = s.setStatus;

      if (ev.type === 'binary') {
        const blob = new Blob([ev.bytes as BlobPart], { type: ev.mime });
        // Update this server's live-preview slot so consumers not bound to
        // the Pixi canvas (Stripped canvas mode) get the latest frame. When
        // multiple servers are running concurrently, Stripped mode lays the
        // per-server previews out in a grid rather than thrashing one slot.
        useCanvasStore.getState().setLivePreview(serverId, URL.createObjectURL(blob));

        // Layer-targeted preview routing (#33): if a running job on this
        // server has a targetLayerId, stream the preview into that layer's
        // sprite via setLayerImage. The completion handler will replace this
        // with the final image. Untargeted gens don't paint to the infinite
        // canvas — the user can switch to Stripped mode to watch them.
        //
        // For inpaint jobs (`resultCrop` set), forward the fractional crop so
        // the preview frame is sub-rect'd before upload — ComfyUI streams the
        // wider context image with context padding around the masked region,
        // and only the inset rect actually belongs on the layer. The
        // completion handler already crops the final result via cropImageUrl.
        const ctl = getCanvasController();
        const running = s.jobs.find(j => j.serverId === serverId && j.status === 'running');
        if (ctl && running?.targetLayerId) {
          ctl.setLayerImage(
            running.targetLayerId,
            URL.createObjectURL(blob),
            null,
            running.resultCrop ?? null,
          );
        }
        return;
      }

      if (ev.type === 'progress') {
        setStatus(`Generating ${ev.value}/${ev.max}`, 'busy');
        const running = s.jobs.find(j => j.serverId === serverId && j.status === 'running');
        if (running) get().updateJob(running.id, { progress: { value: ev.value, max: ev.max } });
        return;
      }

      if (ev.type === 'execution_error') {
        setStatus(`Error: ${ev.message}`, 'error');
        const running = s.jobs.find(j => j.serverId === serverId && j.status === 'running');
        if (running) get().updateJob(running.id, { status: 'error', error: ev.message, node: undefined });
        useCanvasStore.getState().setLivePreview(serverId, null);
        return;
      }

      // ev.type === 'executing'
      const job = s.jobs.find(j => j.id === ev.promptId);
      if (ev.node !== null) {
        if (job) {
          // Bump executedNodes only when the node actually changes — ComfyUI
          // re-fires `executing` between progress events for samplers, and
          // counting each one would push the displayed count well past the
          // graph's real node count.
          const advance = job.node !== ev.node;
          get().updateJob(job.id, {
            status: 'running',
            node: ev.node,
            ...(advance ? { executedNodes: (job.executedNodes ?? 0) + 1 } : {}),
          });
        }
        setStatus(`Executing ${ev.node}`, 'busy');
        return;
      }

      // node === null → prompt finished.
      if (!job || _completingPromptIds.has(job.id)) return;
      const host = get().servers.find(sv => sv.id === job.serverId)?.host;
      if (!host) { get().removeJob(job.id); return; }

      _completingPromptIds.add(job.id);
      setStatus('Loading result…', 'busy');
      const res = await fetchPromptResult(host, job.id, job);
      _completingPromptIds.delete(job.id);

      if ('error' in res) {
        setStatus(`Result error: ${res.error}`, 'error');
        get().updateJob(job.id, { status: 'error', error: res.error });
        return;
      }

      // Tag the global history entry with the originating canvas layer (if any)
      // so downstream tools (filters, drag-from-history-to-canvas, etc.) can
      // attribute it back.
      const stamped = get().pushHistory({
        ...res.entry,
        serverId: job.serverId,
        ...(job.targetLayerId ? { layerId: job.targetLayerId } : {}),
      });

      if (job.targetLayerId) {
        // Layer-targeted: stamp into the layer's sprite + write a separate
        // per-layer history entry (the blob is fetched + stored independently
        // so deletes from global history don't break the layer). No auto-
        // frame in infinite mode — the result lands in the layer's bounds
        // wherever they were, no need to jerk the viewport around.
        const ctl = getCanvasController();
        const stampUrl = job.resultCrop
          ? (await cropImageUrl(res.url, job.resultCrop)) ?? res.url
          : res.url;
        ctl?.setLayerImage(job.targetLayerId, stampUrl);
        void stampLayerHistory(job.targetLayerId, stamped, stampUrl);
        setStatus('Ready', 'ok');
      } else if (get().autoFrameOnComplete) {
        // Untargeted: keep the existing auto-frame behaviour for now. Once
        // Stripped canvas mode (separate ticket) ships, this entire path
        // will route through that view instead.
        get().selectHistoryEntry(stamped);
        getCanvasController()?.loadHttpUrl(res.url, (ok) =>
          setStatus(ok ? 'Ready' : 'Image load failed', ok ? 'ok' : 'error'));
      } else {
        setStatus('Ready', 'ok');
      }
      // Generation done — drop this server's live preview so the stripped
      // canvas (and the future PiP box) snap back to the static result
      // instead of lingering on the last preview frame.
      useCanvasStore.getState().setLivePreview(job.serverId, null);
      get().removeJob(job.id);
    },

    setRouting: (mode) => {
      set({ routing: mode });
    },
    peekNextServer: (opts) => {
      const { servers, serverInfo, routing, roundRobinIndex } = get();
      if (routing !== ROUND_ROBIN) {
        // Pinned — return it even if offline / incapable; the caller surfaces
        // those errors with full context (which resources are missing, etc.).
        return servers.find(sv => sv.id === routing) ?? null;
      }
      const eligible = rrEligibleServers(servers, serverInfo, opts?.workflow);
      if (!eligible.length) return null;
      return eligible[roundRobinIndex % eligible.length];
    },
    advanceRoundRobin: (opts) => {
      const { servers, serverInfo, routing, roundRobinIndex } = get();
      if (routing !== ROUND_ROBIN) return;
      const eligible = rrEligibleServers(servers, serverInfo, opts?.workflow);
      if (!eligible.length) return;
      const rrIndex = ((roundRobinIndex % eligible.length) + 1) % eligible.length;
      set({ roundRobinIndex: rrIndex });
    },

    addJob: (job) => {
      putJob(job);
      set(s => ({ jobs: [...s.jobs, job] }));
    },
    updateJob: (id, patch) => set(s => {
      const jobs = s.jobs.map(j => j.id === id ? { ...j, ...patch } : j);
      const updated = jobs.find(j => j.id === id);
      if (updated) putJob(updated);
      return { jobs };
    }),
    removeJob: (id) => {
      deleteJobDb(id);
      set(s => ({ jobs: s.jobs.filter(j => j.id !== id) }));
    },
    setJobs: (jobs) => set({ jobs }),
    cancelJob: (id) => {
      const job = get().jobs.find(j => j.id === id);
      if (job) {
        // Act on the job's *own* server.
        const host = get().servers.find(sv => sv.id === job.serverId)?.host;
        if (host) {
          if (job.status === 'running') interruptPrompt(host).catch(() => { /* best effort */ });
          else if (job.status === 'queued') deleteQueuedPrompt(host, id).catch(() => { /* best effort */ });
        }
        // 'error' jobs have nothing left to cancel server-side.
      }
      get().removeJob(id);
    },

    setModelHashes: (hashes) => set({ modelHashes: hashes }),
    mergeCivitai: (entries) => set(s => {
      if (!entries.length) return s;
      const civitaiByHash = { ...s.civitaiByHash };
      for (const e of entries) civitaiByHash[e.hash] = e;
      return { civitaiByHash };
    }),

    addServer: (name, host) => {
      const server: Server = {
        id: uid(),
        name: name.trim() || 'Server',
        host: host.trim() || DEFAULT_COMFY_HOST,
        enabled: true,
      };
      const next = [...get().servers, server];
      set({ servers: next });
    },
    updateServer: (id, patch) => {
      const next = get().servers.map(sv => sv.id === id ? {
        ...sv,
        ...(patch.name !== undefined ? { name: patch.name.trim() || sv.name } : {}),
        ...(patch.host !== undefined ? { host: patch.host.trim() || sv.host } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      } : sv);
      // If we just disabled the currently-pinned server, drop its capability
      // record so the picker stops showing it as online — and fall the routing
      // back to round-robin (mirrors removeServer's behavior).
      const justDisabled = patch.enabled === false;
      if (justDisabled) {
        set(s => {
          const serverInfo = { ...s.serverInfo };
          delete serverInfo[id];
          return {
            servers: next,
            serverInfo,
            server: unionInfo(serverInfo),
            routing: s.routing === id ? ROUND_ROBIN : s.routing,
          };
        });
      } else {
        set({ servers: next });
      }
    },
    removeServer: (id) => {
      const { servers, routing } = get();
      if (servers.length <= 1) return; // never delete the last server
      const next = servers.filter(sv => sv.id !== id);
      deleteJobsForServer(id);
      // If routing was pinned to this server, fall back to round-robin.
      const nextRouting = routing === id ? ROUND_ROBIN : routing;
      set(s => {
        const serverInfo = { ...s.serverInfo };
        delete serverInfo[id];
        return {
          servers: next,
          serverInfo,
          server: unionInfo(serverInfo),
          jobs: s.jobs.filter(j => j.serverId !== id),
          routing: nextRouting,
        };
      });
    },

    openViewer: (opts) => set(s => ({
      viewerOpen: true,
      viewerInfoOpen: !!opts?.withInfo,
      // Make sure something is selected so the viewer has an image to show.
      selectedEntry: s.selectedEntry ?? s.history[0] ?? null,
    })),
    closeViewer: () => set({ viewerOpen: false, viewerClosedAt: Date.now() }),
    toggleViewer: () => {
      if (get().viewerOpen) { set({ viewerOpen: false, viewerClosedAt: Date.now() }); return; }
      get().openViewer();
    },
    setSlideshowPlaying: (playing) => set({ slideshowPlaying: playing }),

    addLayer: (kind, init = {}) => {
      const layer: Layer = {
        id: uid(),
        on: true,
        kind,
        tag: kind === 'positive' ? 'Subject' : 'Common',
        text: '',
        weight: 1.0,
        ...init,
      };
      const next = [...get().layers, layer];
      setLayersAndMirror(next);
      return layer.id;
    },
    requestLayerFocus: (id) => set({ pendingFocusLayerId: id }),
    consumeLayerFocus: () => set({ pendingFocusLayerId: null }),

    replaceLayers: (kind, items) => {
      const others = get().layers.filter(l => l.kind !== kind);
      const fresh: Layer[] = items.map(it => ({
        id: uid(),
        on: true,
        kind,
        tag: it.tag,
        text: it.text,
        weight: it.weight ?? 1.0,
      }));
      setLayersAndMirror([...others, ...fresh]);
    },
    updateLayer: (id, patch) => {
      const next = get().layers.map(l => l.id === id ? { ...l, ...patch } : l);
      setLayersAndMirror(next);
    },
    removeLayer: (id) => {
      const next = get().layers.filter(l => l.id !== id);
      setLayersAndMirror(next);
    },
    duplicateLayer: (id) => {
      const layers = get().layers;
      const idx = layers.findIndex(l => l.id === id);
      if (idx < 0) return;
      const next = [...layers];
      next.splice(idx + 1, 0, { ...layers[idx], id: uid() });
      setLayersAndMirror(next);
    },
    reorderLayers: (kind, fromId, toId) => {
      if (fromId === toId) return;
      const layers = [...get().layers];
      const fromIdx = layers.findIndex(l => l.id === fromId);
      const toIdx   = layers.findIndex(l => l.id === toId);
      if (fromIdx < 0 || toIdx < 0) return;
      if (layers[fromIdx].kind !== kind || layers[toIdx].kind !== kind) return;
      const [m] = layers.splice(fromIdx, 1);
      layers.splice(toIdx, 0, m);
      setLayersAndMirror(layers);
    },
    moveLayer: (id, dir) => {
      const layers = [...get().layers];
      const idx = layers.findIndex(l => l.id === id);
      if (idx < 0) return;
      const layer = layers[idx];
      let target = idx + dir;
      while (target >= 0 && target < layers.length && layers[target].kind !== layer.kind) target += dir;
      if (target < 0 || target >= layers.length) return;
      const [m] = layers.splice(idx, 1);
      layers.splice(target, 0, m);
      setLayersAndMirror(layers);
    },

    addSnippet: (s) => {
      const id = uid();
      const next = [...get().snippets, { ...s, id }];
      set({ snippets: next });
      return id;
    },
    updateSnippet: (id, patch) => {
      const next = get().snippets.map(s => s.id === id ? { ...s, ...patch } : s);
      set({ snippets: next });
    },
    removeSnippet: (id) => {
      const next = get().snippets.filter(s => s.id !== id);
      // Also clear `originSnippetId` from any layers that came from it so they
      // remain editable but no longer appear "on" in the library.
      const layers = get().layers.map(l => l.originSnippetId === id ? { ...l, originSnippetId: undefined } : l);
      set({ snippets: next });
      setLayersAndMirror(layers);
    },
    insertSnippetAsLayer: (id) => {
      const s = get().snippets.find(x => x.id === id);
      if (!s) return;
      get().addLayer(s.kind, { tag: s.tag, text: s.text, weight: s.weight, originSnippetId: s.id });
    },
    removeLayersFromSnippet: (snippetId) => {
      const next = get().layers.filter(l => l.originSnippetId !== snippetId);
      setLayersAndMirror(next);
    },

    addSnippetCategory: (name, icon) => {
      const id = uid();
      const next = [...get().snippetCategories, { id, name: name.trim() || 'Untitled', icon }];
      set({ snippetCategories: next });
      return id;
    },
    updateSnippetCategory: (id, patch) => {
      const next = get().snippetCategories.map(c => c.id === id ? {
        ...c,
        ...(patch.name !== undefined ? { name: patch.name.trim() || c.name } : {}),
        ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
      } : c);
      set({ snippetCategories: next });
    },
    removeSnippetCategory: (id) => {
      // Never let the built-in "Uncategorized" bucket disappear — it's the
      // landing zone for orphaned snippets.
      if (id === DEFAULT_CATEGORY_ID) return;
      const cats = get().snippetCategories.filter(c => c.id !== id);
      const snippets = get().snippets.map(s => s.categoryId === id ? { ...s, categoryId: DEFAULT_CATEGORY_ID } : s);
      set({ snippetCategories: cats, snippets });
    },

    setVenice: (patch) => {
      const next = { ...get().venice, ...patch };
      set({ venice: next });
    },

    setCivitai: (patch) => {
      const next = { ...get().civitai, ...patch };
      set({ civitai: next });
    },

    setModelPreviewSource: (src) => {
      set({ modelPreviewSource: src });
    },
    setModelPickerFilter: (kind, bucket) => {
      const next = { ...get().modelPickerFilters, [kind]: bucket };
      set({ modelPickerFilters: next });
    },
    setServerPickerFilter: (kind, serverIds) => {
      const next = { ...get().serverPickerFilters, [kind]: serverIds };
      set({ serverPickerFilters: next });
    },
    setAutoFrameOnComplete: (on) => {
      set({ autoFrameOnComplete: on });
    },
    setCollectionsTileSize: (px) => set({ collectionsTileSize: px }),

    // Route checkpoint + LoRA mutations through setWorkflow so the panel-set
    // scope mirror fires (#41) — without it, edits land in useStore.workflow
    // but never reach the active layer's IDB record, and a layer switch
    // silently reverts them on scope-sync.
    addCheckpoint: (name) => {
      const checkpoints = [...get().workflow.checkpoints, { id: uid(), name, ratio: 0.5 }];
      get().setWorkflow({ checkpoints });
    },
    removeCheckpoint: (id) => {
      // Zero checkpoints is a valid (if unusable) state — the ModelStack shows
      // an empty placeholder and `queuePrompt` surfaces "Pick a checkpoint
      // first" if the user tries to generate without one.
      const checkpoints = get().workflow.checkpoints.filter(c => c.id !== id);
      get().setWorkflow({ checkpoints });
    },
    updateCheckpoint: (id, patch) => {
      const checkpoints = get().workflow.checkpoints.map(c => c.id === id ? { ...c, ...patch } : c);
      get().setWorkflow({ checkpoints });
    },

    addLora: (name) => {
      const loras = [...get().workflow.loras, { id: uid(), name, strength: 1, clipStrength: 1, on: true }];
      get().setWorkflow({ loras });
    },
    removeLora: (id) => {
      const loras = get().workflow.loras.filter(l => l.id !== id);
      get().setWorkflow({ loras });
    },
    updateLora: (id, patch) => {
      const loras = get().workflow.loras.map(l => l.id === id ? { ...l, ...patch } : l);
      get().setWorkflow({ loras });
    },

    pushHistory: (entry) => {
      // The caller stamps `entry.serverId` (it knows which server ran the job).
      const next = [entry, ...get().history];
      if (next.length > HISTORY_MAX) next.length = HISTORY_MAX;
      set({ history: next });
      return entry;
    },
    selectHistoryEntry: (entry) => set({ selectedEntry: entry }),
    recallSelected: () => {
      const entry = get().selectedEntry;
      if (!entry) return;

      // Workflow — prefer the captured snapshot; otherwise best-effort from the
      // entry's seed + checkpoint, leaving everything else as the current params.
      const workflow: WorkflowState = entry.workflow
        ? entry.workflow
        : {
            ...get().workflow,
            seed: entry.seed,
            checkpoints: entry.model
              ? [{ id: uid(), name: entry.model, ratio: 0.5 }]
              : get().workflow.checkpoints,
          };

      // Prompt layers — prefer the captured snapshot; otherwise rebuild one layer
      // per kind from the compiled prompt strings. Fresh ids either way.
      let layers: Layer[];
      if (entry.layers && entry.layers.length) {
        layers = entry.layers.map(l => ({ ...l, id: uid() }));
      } else {
        layers = [];
        if (entry.positive) layers.push({ id: uid(), on: true, kind: 'positive', tag: 'Recalled', text: entry.positive, weight: 1 });
        if (entry.negative) layers.push({ id: uid(), on: true, kind: 'negative', tag: 'Recalled', text: entry.negative, weight: 1 });
      }
      // Route the workflow + layers writes through their mirror helpers
      // so per-canvas-layer scope is preserved (#41 + #43).
      get().setWorkflow(workflow);
      if (layers.length) setLayersAndMirror(layers);
      get().setStatus('Recalled parameters from the selected image', 'ok');
    },
    clearHistory: () => {
      set({ history: [], selectedEntry: null });
    },
    toggleHistoryLiked: (id) => {
      // Two-phase toggle: flip `liked` locally for snappy UI, then mirror to
      // the ComfyUI custom node (POST favorites for new likes, DELETE for
      // un-likes). On failure we revert the local flip so the UI doesn't
      // claim a persistence we don't have.
      const entry = get().history.find(h => h.id === id);
      if (!entry) return;
      const wasLiked = !!entry.liked;
      const nextLiked = !wasLiked;
      // Optimistic local update.
      const flipped = get().history.map(h => h.id === id ? { ...h, liked: nextLiked } : h);
      set(s => ({
        history: flipped,
        selectedEntry: s.selectedEntry?.id === id
          ? { ...s.selectedEntry, liked: nextLiked }
          : s.selectedEntry,
      }));

      const server = get().servers.find(sv => sv.id === entry.serverId);
      if (!server) {
        // No host to talk to — fall back to a purely-local star (legacy
        // behaviour). The user still gets the visual toggle.
        return;
      }

      const applyServerResult = (patch: Partial<HistoryEntry>) => {
        const next = get().history.map(h => h.id === id ? { ...h, ...patch } : h);
        set(s => ({
          history: next,
          selectedEntry: s.selectedEntry?.id === id ? { ...s.selectedEntry, ...patch } : s.selectedEntry,
        }));
      };

      const revertLocal = (msg: string) => {
        applyServerResult({ liked: wasLiked });
        get().setStatus(msg, 'error');
      };

      if (nextLiked) {
        // Star: copy the image into the favorites tree on its origin server.
        createFavorite(server.host, {
          filename: entry.filename,
          subfolder: entry.subfolder,
          type: entry.type,
        })
          .then(fav => {
            applyServerResult({ favoriteId: fav.id });
            // Optimistically merge into our cached favorites list so the
            // Collections view picks it up before the next poll lands.
            const current = get().serverFavorites[entry.serverId] || [];
            set(s => ({
              serverFavorites: {
                ...s.serverFavorites,
                [entry.serverId]: [fav, ...current.filter(f => f.id !== fav.id)],
              },
            }));
          })
          .catch(err => revertLocal(err instanceof Error ? err.message : 'Failed to save favorite'));
      } else if (entry.favoriteId) {
        // Un-star: remove from disk.
        const favId = entry.favoriteId;
        deleteFavorite(server.host, favId)
          .then(() => {
            applyServerResult({ favoriteId: undefined });
            const current = get().serverFavorites[entry.serverId] || [];
            set(s => ({
              serverFavorites: {
                ...s.serverFavorites,
                [entry.serverId]: current.filter(f => f.id !== favId),
              },
            }));
          })
          .catch(err => revertLocal(err instanceof Error ? err.message : 'Failed to remove favorite'));
      }
    },
    setServerFavorites: (serverId, version, favorites) => set(s => ({
      serverFavorites: { ...s.serverFavorites, [serverId]: favorites },
      serverFavoritesVersion: { ...s.serverFavoritesVersion, [serverId]: version },
    })),
    removeServerFavorite: (serverId, favoriteId) => {
      const server = get().servers.find(sv => sv.id === serverId);
      if (!server) return;
      // Optimistic local removal so the grid drops the tile immediately;
      // poll will reconcile on the next tick if the DELETE somehow fails.
      const current = get().serverFavorites[serverId] || [];
      set(s => ({
        serverFavorites: {
          ...s.serverFavorites,
          [serverId]: current.filter(f => f.id !== favoriteId),
        },
      }));
      deleteFavorite(server.host, favoriteId).catch(err =>
        get().setStatus(err instanceof Error ? err.message : 'Failed to remove favorite', 'error'),
      );
    },
    removeHistoryEntry: (id) => {
      const prev = get().history;
      const idx = prev.findIndex(h => h.id === id);
      const next = prev.filter(h => h.id !== id);
      set(s => {
        // If the user just deleted the active entry, pick a neighbour so the
        // canvas/viewer immediately reflects what's left instead of going
        // blank. History is newest-first, so prefer the older entry that
        // slides into the deleted slot (next[idx]); fall back to the newer
        // one when the deleted entry was the oldest.
        let selectedEntry = s.selectedEntry;
        if (selectedEntry?.id === id) {
          selectedEntry = idx >= 0 ? (next[idx] ?? next[idx - 1] ?? null) : null;
        }
        return { history: next, selectedEntry };
      });
    },
    clearUnliked: () => {
      const next = get().history.filter(h => h.liked);
      set(s => ({
        history: next,
        selectedEntry: next.some(h => h.id === s.selectedEntry?.id) ? s.selectedEntry : null,
      }));
    },

    // -----------------------------------------------------------------------
    // Theme actions
    // -----------------------------------------------------------------------
    setThemeId: (id) => {
      set({ themeId: id });
    },
    createCustomTheme: (sourceId, name) => {
      const source = resolveTheme(sourceId, get().customThemes);
      const newId = `custom-${uid()}`;
      const newTheme: Theme = {
        ...source,
        id: newId,
        name: name || `${source.name} (custom)`,
        blurb: 'Custom theme',
        builtIn: false,
      };
      const customThemes = [...get().customThemes, newTheme];
      set({ customThemes, themeId: newId });
      return newId;
    },
    updateCustomTheme: (id, patch) => {
      const customThemes = get().customThemes.map(t =>
        t.id === id ? { ...t, ...patch, id: t.id, builtIn: false } : t,
      );
      set({ customThemes });
    },
    deleteCustomTheme: (id) => {
      const customThemes = get().customThemes.filter(t => t.id !== id);
      // If the active theme was the one we deleted, fall back to the default.
      const activeId = get().themeId === id ? 'midnight' : get().themeId;
      set({ customThemes, themeId: activeId });
    },

    // -----------------------------------------------------------------------
    // Collections
    // -----------------------------------------------------------------------
    createCollection: (name, icon, color) => {
      const trimmed = name.trim() || 'New collection';
      const c: Collection = {
        id: uid(),
        name: trimmed,
        icon: icon?.trim() || undefined,
        color: color?.trim() || undefined,
        itemIds: [],
        createdAt: Date.now(),
      };
      const next = [...get().collections, c];
      set({ collections: next });
      return c.id;
    },
    renameCollection: (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const next = get().collections.map(c => c.id === id ? { ...c, name: trimmed } : c);
      set({ collections: next });
    },
    updateCollection: (id, patch) => {
      const next = get().collections.map(c => {
        if (c.id !== id) return c;
        return {
          ...c,
          ...(patch.name !== undefined ? { name: patch.name.trim() || c.name } : {}),
          ...(patch.icon !== undefined ? { icon: patch.icon.trim() || undefined } : {}),
          ...(patch.color !== undefined ? { color: patch.color.trim() || undefined } : {}),
        };
      });
      set({ collections: next });
    },
    deleteCollection: (id) => {
      const next = get().collections.filter(c => c.id !== id);
      set({ collections: next });
    },
    reorderCollections: (orderedIds) => {
      const map = new Map(get().collections.map(c => [c.id, c]));
      const next: Collection[] = [];
      for (const id of orderedIds) {
        const c = map.get(id);
        if (c) { next.push(c); map.delete(id); }
      }
      // Append anything missing from the ordering (defensive — shouldn't happen).
      for (const c of map.values()) next.push(c);
      set({ collections: next });
    },
    addToCollection: (collectionId, itemId) => {
      const next = get().collections.map(c => {
        if (c.id !== collectionId) return c;
        if (c.itemIds.includes(itemId)) return c;
        return { ...c, itemIds: [...c.itemIds, itemId] };
      });
      set({ collections: next });
    },
    removeFromCollection: (collectionId, itemId) => {
      const next = get().collections.map(c =>
        c.id === collectionId ? { ...c, itemIds: c.itemIds.filter(i => i !== itemId) } : c,
      );
      set({ collections: next });
    },
    removeItemFromAllCollections: (itemId) => {
      const next = get().collections.map(c =>
        c.itemIds.includes(itemId) ? { ...c, itemIds: c.itemIds.filter(i => i !== itemId) } : c,
      );
      set({ collections: next });
    },

    // -----------------------------------------------------------------------
    // Imported images — blobs in IndexedDB (`importedDb.ts`), metadata here.
    // -----------------------------------------------------------------------
    addImportedImage: async (blob, init) => {
      const img: ImportedImage = {
        id: uid(),
        name: init.name || 'image',
        mime: blob.type || 'image/png',
        width: Math.max(0, Math.trunc(init.width || 0)),
        height: Math.max(0, Math.trunc(init.height || 0)),
        bytes: blob.size,
        createdAt: Date.now(),
      };
      await putImportedBlob(img.id, blob);
      const next = [img, ...get().importedImages];
      set({ importedImages: next });
      return img;
    },
    removeImportedImage: (id) => {
      const next = get().importedImages.filter(i => i.id !== id);
      set({ importedImages: next });
      deleteImportedBlob(id); // fire-and-forget; nothing else depends on it
      get().removeItemFromAllCollections(id);
    },
    toggleImportedLiked: (id) => {
      const next = get().importedImages.map(i => i.id === id ? { ...i, liked: !i.liked } : i);
      set({ importedImages: next });
    },

    setItemAi: (itemId, patch) => {
      // Try history first.
      const history = get().history;
      if (history.some(h => h.id === itemId)) {
        const nextHist = history.map(h => h.id === itemId ? { ...h, ...patch } : h);
        set(s => ({
          history: nextHist,
          selectedEntry: s.selectedEntry?.id === itemId ? { ...s.selectedEntry, ...patch } : s.selectedEntry,
        }));
        return;
      }
      // Fall through to imported.
      const imported = get().importedImages;
      if (imported.some(i => i.id === itemId)) {
        const nextImp = imported.map(i => i.id === itemId ? { ...i, ...patch } : i);
        set({ importedImages: nextImp });
      }
    },

  };
});

// Wire up the debounced localStorage writer once the store exists. Every
// persisted slice change after this call is coalesced into a single batched
// write per ~100ms tick, plus a synchronous flush on tab hide/close.
installPersistence(useStore);

/**
 * Panel-set scope sync: subscribe to canvasStore changes and swap the live
 * `useStore.workflow` between the global workflow and the active layer's
 * workflow whenever scope changes.
 *
 * Scope is "global" when there's no active canvas layer OR the user is not
 * on the canvas view. (Selecting a layer is a canvas-editor concern — when
 * the user is on the Generate view they expect their global params to drive
 * the next job, not whatever layer happens to be selected in the canvas
 * editor underneath.) Otherwise it's "layer:<id>" — the live workflow
 * comes from layer.workflow and edits mirror back to it (handled
 * separately in setWorkflow above).
 *
 * The global workflow is preserved in `_globalWorkflowBackup` while a layer
 * scope is active, so toggling back restores the user's untouched global
 * params instead of inheriting the layer's settings.
 */
let _scopeSyncLastScope = 'global';
let _scopeSyncDidFirst = false;
const runScopeSync = () => {
  const cs = useCanvasStore.getState();
  if (!cs.canvasLayersHydrated) return;

  // Only honour a selected canvas layer while the user is actively in the
  // canvas/inpaint editor. On every other view (generate, collections,
  // browser, comfy) generation must use the global workflow + layers.
  const layerActive = cs.activeLayerId && cs.mainView === 'canvas';
  const wantScope = layerActive ? cs.activeLayerId! : 'global';
  if (_scopeSyncDidFirst && wantScope === _scopeSyncLastScope) return;

  const ws = useStore.getState();
  // Save current workflow + prompt layers back to whichever scope was
  // active. (Layer scope mirrors on every edit anyway, so saving here is
  // only meaningful for the global → layer transition.)
  if (_scopeSyncDidFirst) {
    if (_scopeSyncLastScope === 'global') {
      useStore.setState({
        _globalWorkflowBackup: ws.workflow,
        _globalLayersBackup: ws.layers,
      });
    }
  } else {
    // First sync ever — capture the current workflow + layers as the
    // global backup before potentially overwriting with a canvas-layer's.
    useStore.setState({
      _globalWorkflowBackup: ws.workflow,
      _globalLayersBackup: ws.layers,
    });
    _scopeSyncDidFirst = true;
  }

  // Load workflow + prompt layers for the new scope.
  if (wantScope === 'global') {
    const wfBackup = useStore.getState()._globalWorkflowBackup;
    const lsBackup = useStore.getState()._globalLayersBackup;
    const patch: Partial<{ workflow: WorkflowState; layers: Layer[] }> = {};
    if (wfBackup) patch.workflow = wfBackup;
    if (lsBackup) patch.layers = lsBackup;
    if (Object.keys(patch).length) useStore.setState(patch);
  } else {
    const layer = cs.canvasLayers.find(l => l.id === wantScope);
    if (!layer) return; // unknown layer — don't update lastScope, re-evaluate next tick
    useStore.setState({ workflow: layer.workflow, layers: layer.layers });
  }
  _scopeSyncLastScope = wantScope;
};
useCanvasStore.subscribe(runScopeSync);


