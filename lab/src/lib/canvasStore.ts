/**
 * Canvas-layer store — split out of `lib/store.ts` so the canvas-as-compositor
 * domain (IDB-persisted, async-hydrated, future Pixi sprite + layers-panel
 * consumers) doesn't share space with the main prompt/workflow store
 * (localStorage-persisted, sync-hydrated, parameter-input consumers).
 *
 * Pure relocation of the slice introduced in 35f13d1 — no behaviour change.
 * Importing this module triggers `initCanvasLayers()` (fire-and-forget) so
 * boot-time hydration happens automatically wherever the store is referenced.
 */
import { create } from 'zustand';
import type { CanvasLayer, CanvasLayerType, CanvasLayerBackground } from './types';
import { canvasStorage } from './canvasStorageInstance';
import { makeDefaultLayer } from './defaultLayer';
import { defaultWorkflow } from './storage';
import { type CanvasToolId, DEFAULT_CANVAS_TOOL, findTool } from './canvasTools';

/** localStorage key — persists the active canvas-layer id synchronously so
 *  first paint after a reload doesn't flash an unselected state while the
 *  async IDB hydration is still in flight. */
const ACTIVE_CANVAS_LAYER_KEY = 'imagelab.activeLayerId.v1';
/** localStorage key — default bounds size applied to newly-added canvas
 *  layers from the +Add button. Replaces the old top-toolbar canvas-size
 *  dropdown, which became meaningless once per-layer bounds drove size. */
const DEFAULT_LAYER_SIZE_KEY = 'imagelab.defaultLayerSize.v1';
/** localStorage key — global grid config (step size + snap-enabled flag). */
const GRID_KEY = 'imagelab.canvasGrid.v1';
/** localStorage key — pin-to-global flag for the Parameters panel.
 *  When true, the left panel keeps showing the global workflow even while a
 *  canvas layer is active. */
/** localStorage key — which top-level view the app is showing. The sidebar
 *  is the only thing that switches it. Three values today:
 *    - `'generate'`   — generation app with the simplified centered-image canvas
 *    - `'canvas'`     — infinite-canvas Pixi compositor
 *    - `'collections'` — full-page Collections library
 *  Bumped to v3 when we renamed from canvasViewMode ('infinite' | 'stripped')
 *  to mainView; the loader migrates old v2 values on first read. */
const MAIN_VIEW_KEY = 'imagelab.mainView.v3';
const LEGACY_VIEW_MODE_KEY = 'imagelab.canvasViewMode.v2';
const ACTIVE_TOOL_KEY = 'imagelab.canvasActiveTool.v1';
const BRUSH_KEY = 'imagelab.brush.v1';
const MASKS_VISIBLE_KEY = 'imagelab.masksVisible.v1';
const GRID_INCREMENT = 64;

/** Brush + erase shared settings. Sizes are in WORLD units (canvas pixels
 *  at 1× zoom = the same units as layer bounds.w/h). Hardness is 0..1
 *  where 1 = razor-sharp edge, 0 = full gaussian-style falloff. */
export type BrushSettings = {
  size: number;        // diameter in world px (1..1024)
  hardness: number;    // 0..1
  opacity: number;     // 0..1 — per-stamp alpha multiplier
  spacing: number;     // 0.02..1, fraction of size between stamps
  color: string;       // CSS hex, ignored by erase
};

const BRUSH_DEFAULTS: BrushSettings = {
  size: 48,
  hardness: 0.75,
  opacity: 1,
  spacing: 0.15,
  color: '#000000',
};

const loadBrush = (): BrushSettings => {
  try {
    const raw = localStorage.getItem(BRUSH_KEY);
    if (!raw) return BRUSH_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<BrushSettings>;
    return {
      size: clamp(Number(parsed.size) || BRUSH_DEFAULTS.size, 1, 1024),
      hardness: clamp(Number(parsed.hardness ?? BRUSH_DEFAULTS.hardness), 0, 1),
      opacity: clamp(Number(parsed.opacity ?? BRUSH_DEFAULTS.opacity), 0, 1),
      spacing: clamp(Number(parsed.spacing ?? BRUSH_DEFAULTS.spacing), 0.02, 1),
      color: typeof parsed.color === 'string' ? parsed.color : BRUSH_DEFAULTS.color,
    };
  } catch {
    return BRUSH_DEFAULTS;
  }
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const GRID_MIN = 64;
const GRID_MAX = 1024;

type GridConfig = { step: number; snapEnabled: boolean };
const loadGrid = (): GridConfig => {
  try {
    const raw = localStorage.getItem(GRID_KEY);
    if (!raw) return { step: 64, snapEnabled: true };
    const parsed = JSON.parse(raw);
    const step = typeof parsed.step === 'number' ? parsed.step : 64;
    const snapEnabled = parsed.snapEnabled !== false;
    return {
      step: Math.max(GRID_MIN, Math.min(GRID_MAX, Math.round(step / GRID_INCREMENT) * GRID_INCREMENT)),
      snapEnabled,
    };
  } catch {
    return { step: 64, snapEnabled: true };
  }
};
const persistGrid = (cfg: GridConfig) => {
  try { localStorage.setItem(GRID_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
};

type DefaultLayerSize = { w: number; h: number };
const loadDefaultLayerSize = (): DefaultLayerSize => {
  try {
    const raw = localStorage.getItem(DEFAULT_LAYER_SIZE_KEY);
    if (!raw) return { w: 1024, h: 1024 };
    const parsed = JSON.parse(raw);
    const w = Math.max(64, Math.round(Number(parsed.w) || 1024));
    const h = Math.max(64, Math.round(Number(parsed.h) || 1024));
    return { w, h };
  } catch {
    return { w: 1024, h: 1024 };
  }
};
const persistDefaultLayerSize = (s: DefaultLayerSize) => {
  try { localStorage.setItem(DEFAULT_LAYER_SIZE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
};

export type MainView = 'generate' | 'canvas' | 'collections' | 'browser' | 'comfy';
const loadMainView = (): MainView => {
  try {
    const v = localStorage.getItem(MAIN_VIEW_KEY);
    if (v === 'generate' || v === 'canvas' || v === 'collections' || v === 'browser' || v === 'comfy') return v;
    // Migrate from the old canvasViewMode key (infinite|stripped).
    const legacy = localStorage.getItem(LEGACY_VIEW_MODE_KEY);
    if (legacy === 'infinite') return 'canvas';
    if (legacy === 'stripped') return 'generate';
    return 'generate';
  } catch {
    return 'generate';
  }
};
const persistMainView = (m: MainView) => {
  try { localStorage.setItem(MAIN_VIEW_KEY, m); } catch { /* ignore */ }
};

type CanvasStore = {
  // Canvas layers — the future infinite-canvas-as-compositor's per-tile state.
  // Persisted via `canvasStorage` (IndexedDB, `imagelab-canvas` DB). The list
  // is kept sorted ascending by zIndex (lowest = rendered first = bottom of
  // the Photoshop-style panel stack, so the top of the stack is the LAST item).
  canvasLayers: CanvasLayer[];
  activeLayerId: string | null;
  /** Most-recently-active layer id, kept across deselects. Read by
   *  addCanvasLayer to clone params from a sensible source when the user
   *  creates a fresh layer. Null until the user has activated at least one
   *  layer in this session. */
  lastActiveLayerId: string | null;
  /** False until the async IDB read resolves. UI can render a placeholder. */
  canvasLayersHydrated: boolean;

  /** Read the persisted layer list from IDB and reconcile it into the store.
   *  Idempotent — safe to call repeatedly (the exercise re-invokes it). */
  initCanvasLayers: () => Promise<void>;
  /** Spec wording: `addLayer(input)`. Renamed to `addCanvasLayer` to avoid
   *  colliding with the existing prompt-layer `addLayer` action on the main
   *  store; callers in the canvas epic should use this name throughout. */
  addCanvasLayer: (input: {
    /** @deprecated Layer types collapsed in #38; ignored. */
    type?: CanvasLayerType;
    bounds?: Partial<{ x: number; y: number; w: number; h: number }>;
    name?: string;
  }) => string;
  /** Create a new layer copying workflow + prompt layers from `sourceId`. The
   *  source's bounds/visibility/locked/selectedHistoryId are NOT copied (it's
   *  a parameter-clone, not a layer-clone). Returns the new layer id, or null
   *  if the source can't be found. */
  addCanvasLayerFromSource: (sourceId: string) => string | null;
  /** Create a new folder/group layer (no canvas geometry). */
  addCanvasFolder: (name?: string) => string;
  /** Move a layer into a folder (or out, with parentId = null). */
  setLayerParent: (id: string, parentId: string | null) => void;
  /** Toggle a folder's collapsed-in-panel flag. No-op on non-folders. */
  toggleFolderCollapsed: (id: string) => void;
  /** Drop a layer (cascades through `canvasStorage.deleteLayer` to clean
   *  per-layer history rows + their blobs). */
  removeCanvasLayer: (id: string) => void;
  /** Wipe every canvas layer (folders + leaves) and clear the active
   *  selection. Mirrors removeCanvasLayer's persistence semantics — each
   *  row is deleted through canvasStorage so per-layer history + blobs go
   *  with it. Destructive; callers should confirm first. */
  clearAllCanvasLayers: () => void;
  /** Patch a layer in place + persist the merged record. No-op if id absent. */
  updateCanvasLayer: (id: string, patch: Partial<CanvasLayer>) => void;
  /** Deep-copy the source layer's `workflow` into the destination layer's
   *  `workflow`, preserving the destination's bounds / zIndex / id / name.
   *  Used by the layer-row "copy params from..." affordance so the user
   *  can iterate on a layer with a variant of another layer's params
   *  instead of re-entering everything (#41). No-op if either id is missing
   *  or fromId === toId. */
  duplicateLayerParams: (fromId: string, toId: string) => void;
  /** Move a layer in the panel-ordered list and rewrite zIndex for every
   *  affected layer so panel order matches z-order. Persists only the layers
   *  whose zIndex actually changed. */
  reorderCanvasLayers: (fromIdx: number, toIdx: number) => void;
  setActiveLayer: (id: string | null) => void;
  setLayerBackground: (id: string, bg: CanvasLayerBackground) => void;

  /** Global grid config — drives the visual grid behind layers and the
   *  snap-to-grid math when dragging bounds. Increments of 64 (SDXL native). */
  gridStep: number;
  snapEnabled: boolean;
  /** Adjust the grid step by ±64 (or any multiple of GRID_INCREMENT). Clamped. */
  adjustGridStep: (delta: number) => void;
  setGridStep: (step: number) => void;
  setSnapEnabled: (enabled: boolean) => void;

  /** Default bounds size for newly-added canvas layers. The +Add layer
   *  button reads this — replaces the top-toolbar canvas-size dropdown. */
  defaultLayerSize: DefaultLayerSize;
  setDefaultLayerSize: (size: DefaultLayerSize) => void;

  /** Active top-level view — switched from the sidebar. `generate` is the
   *  default generation app (centered-image canvas), `canvas` is the Pixi
   *  compositor, `collections` is the full-page library, `comfy` embeds a
   *  ComfyUI iframe for the server in `comfyServerId`. */
  mainView: MainView;
  setMainView: (m: MainView) => void;

  /** Which server's ComfyUI to show when `mainView === 'comfy'`. Set by the
   *  sidebar ComfyUI buttons. Not persisted — fresh each session. */
  comfyServerId: string | null;
  setComfyServerId: (id: string | null) => void;

  /** Active infinite-canvas tool (#42). Drives the pointer-handler dispatch
   *  in canvasController and the highlight in CanvasToolbar. Persists across
   *  reloads. */
  activeTool: CanvasToolId;
  setActiveTool: (id: CanvasToolId) => void;

  /** Brush + erase tools share this settings block (erase ignores `color`
   *  and uses `'destination-out'` blend at engine level). Persisted across
   *  reloads via localStorage so the user's brush preferences stick. */
  brush: BrushSettings;
  setBrush: (patch: Partial<BrushSettings>) => void;

  /** Show per-layer painted masks as a red overlay on the canvas. Persisted
   *  across reloads so the user's preference survives. Off by default. */
  masksVisible: boolean;
  setMasksVisible: (v: boolean) => void;

  /** Active rectangular selection — used by the Select tool to scope the
   *  next generation to a sub-rect of the layer. World coords. Cleared on
   *  layer switch, tool change to non-select, or explicit Esc. Not
   *  persisted — fresh each session. */
  activeSelection: { layerId: string; x: number; y: number; w: number; h: number } | null;
  setActiveSelection: (s: CanvasStore['activeSelection']) => void;
  clearActiveSelection: () => void;

  /** Per-server WS preview-frame blob URLs. Updated as binary events arrive
   *  on each server's websocket; old URLs are revoked when replaced. Cleared
   *  for a server when its generation completes or errors. Consumed by
   *  Stripped canvas mode — when more than one server is streaming
   *  simultaneously they're laid out in a grid rather than flickering
   *  through a single slot. Not persisted. */
  livePreviews: Record<string, string>;
  /** Replace a server's live preview URL, revoking the old one. Pass null to clear. */
  setLivePreview: (serverId: string, url: string | null) => void;

};

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  // Canvas layers — hydrated asynchronously from IDB by `initCanvasLayers()`,
  // which the module-tail invocation below kicks off at import time.
  // The activeLayerId is read synchronously from localStorage so first paint
  // after a reload doesn't flash an unselected state.
  canvasLayers: [],
  activeLayerId: (() => {
    try { return localStorage.getItem(ACTIVE_CANVAS_LAYER_KEY); } catch { return null; }
  })(),
  // Seed lastActive from the persisted active so a brand-new layer added
  // right after reload still picks up the most-recent context.
  lastActiveLayerId: (() => {
    try { return localStorage.getItem(ACTIVE_CANVAS_LAYER_KEY); } catch { return null; }
  })(),
  canvasLayersHydrated: false,

  initCanvasLayers: async () => {
    try {
      const rows = await canvasStorage.listLayers();
      // Backfill any workflow fields added since this layer was persisted —
      // merging defaults under the saved values means new params get
      // sensible values on load instead of being undefined and crashing
      // readers.
      //
      // One-time migration from the attached/candidate model: layers
      // persisted with `attachedBlobId` (legacy field, now removed from the
      // type) but no `selectedHistoryId` get their newest matching history
      // entry promoted to the selection. Both legacy fields are then
      // dropped from the in-memory row and the row is re-persisted without
      // them. The model now reads ONLY from `selectedHistoryId`.
      // Snapshot of the current global prompt layers — backfilled below
      // into any pre-#43 canvas layer that's missing its own `layers`. Deep
      // clone so future per-layer edits don't bleed across.
      const cloneLayers = (xs: import('./types').Layer[]): import('./types').Layer[] =>
        xs.map(l => ({ ...l }));
      // Lazy import to dodge the store cycle at module load.
      const globalLayersSnapshot = (() => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          return cloneLayers(require('./store').useStore.getState().layers as import('./types').Layer[]);
        } catch {
          return [] as import('./types').Layer[];
        }
      })();

      const migrated: CanvasLayer[] = [];
      for (const row of rows) {
        row.workflow = { ...defaultWorkflow(), ...row.workflow };
        let touched = false;
        if (row.layers === undefined) {
          row.layers = cloneLayers(globalLayersSnapshot);
          touched = true;
        }
        // Legacy attached/candidate cleanup. We type-erase the row to peek
        // at fields that no longer exist on CanvasLayer.
        const legacy = row as unknown as {
          attachedBlobId?: string | null;
          candidateBlobId?: string | null;
        };
        if (legacy.attachedBlobId !== undefined || legacy.candidateBlobId !== undefined) {
          if (!row.selectedHistoryId && legacy.attachedBlobId) {
            try {
              const history = await canvasStorage.listLayerHistory(row.id);
              const match = history.find(e => e.blobId === legacy.attachedBlobId)
                ?? history.sort((a, b) => b.at - a.at)[0];
              if (match) row.selectedHistoryId = match.id;
            } catch { /* leave selection unset; sprite stays blank */ }
          }
          delete legacy.attachedBlobId;
          delete legacy.candidateBlobId;
          touched = true;
        }
        if (touched) migrated.push(row);
      }
      // Persist the backfill in the background — read path is already
      // correct from the in-memory mutation above, so we don't block on it.
      for (const row of migrated) {
        canvasStorage.saveLayer(row).catch(err => {
          console.warn('[canvasStore] migration persist failed', err);
        });
      }
      rows.sort((a, b) => a.zIndex - b.zIndex);
      const persistedActive = get().activeLayerId;
      let activeLayerId: string | null = null;
      if (persistedActive && rows.some(l => l.id === persistedActive)) {
        activeLayerId = persistedActive;
      } else if (rows.length) {
        activeLayerId = rows[rows.length - 1].id; // top of stack
      }
      // Sync localStorage if the resolved active differs from what was on disk.
      if (activeLayerId !== persistedActive) {
        try {
          if (activeLayerId == null) localStorage.removeItem(ACTIVE_CANVAS_LAYER_KEY);
          else localStorage.setItem(ACTIVE_CANVAS_LAYER_KEY, activeLayerId);
        } catch { /* ignore */ }
      }
      set({ canvasLayers: rows, activeLayerId, canvasLayersHydrated: true });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[canvasStore] initCanvasLayers failed', err);
      set({ canvasLayers: [], canvasLayersHydrated: true });
    }
  },

  addCanvasLayer: (input) => {
    const existing = get().canvasLayers;
    const maxZ = existing.length ? Math.max(...existing.map(l => l.zIndex)) : -1;
    // Defaults for unspecified bounds dimensions come from the user's
    // defaultLayerSize setting (configured in the Layers panel header).
    const def = get().defaultLayerSize;
    // Default position: top-left corner of the union bounds of every visible
    // existing layer (the dashed frame around the whole canvas). Drops fresh
    // layers next to the existing work instead of stacking them at world
    // origin where they can land far off-screen. Callers that need a
    // specific position still win — explicit bounds.x / .y override this.
    let defaultX = 0;
    let defaultY = 0;
    const visible = existing.filter(l => l.visible);
    if (visible.length) {
      defaultX = Math.min(...visible.map(l => l.bounds.x));
      defaultY = Math.min(...visible.map(l => l.bounds.y));
    }
    const bounds = {
      x: input.bounds?.x ?? defaultX,
      y: input.bounds?.y ?? defaultY,
      w: input.bounds?.w ?? def.w,
      h: input.bounds?.h ?? def.h,
    };
    const layer = makeDefaultLayer({
      type: input.type,
      bounds,
      name: input.name,
      layerCount: existing.length,
      zIndex: maxZ + 1,
    });
    // Param inheritance (#41): clone the most-recently-active layer's
    // workflow + prompt layers as the new layer's starting params so
    // iterating on a similar gen doesn't force the user to re-enter
    // everything. Falls back to defaultLayer's defaults when no prior
    // layer exists.
    const lastId = get().lastActiveLayerId;
    const source = lastId ? existing.find(l => l.id === lastId) : null;
    if (source) {
      // Deep clone — layer workflows + prompt layers are mutated
      // independently. Lift the arrays so future edits on one layer don't
      // bleed into the inheriting sibling.
      layer.workflow = {
        ...source.workflow,
        checkpoints: source.workflow.checkpoints.map(c => ({ ...c })),
        loras: source.workflow.loras.map(l => ({ ...l })),
      };
      layer.layers = source.layers.map(l => ({ ...l }));
    }
    const next = [...existing, layer]; // already sorted: new layer has the largest zIndex
    // Fire-and-forget persist — failures are logged but never block the UI.
    canvasStorage.saveLayer(layer).catch(err => {
      // eslint-disable-next-line no-console
      console.error('[canvasStore] addCanvasLayer persist failed', err);
    });
    try { localStorage.setItem(ACTIVE_CANVAS_LAYER_KEY, layer.id); } catch { /* ignore */ }
    set({ canvasLayers: next, activeLayerId: layer.id });
    return layer.id;
  },

  addCanvasLayerFromSource: (sourceId) => {
    const existing = get().canvasLayers;
    const src = existing.find(l => l.id === sourceId);
    if (!src) return null;
    const maxZ = existing.length ? Math.max(...existing.map(l => l.zIndex)) : -1;
    const def = get().defaultLayerSize;
    let defaultX = 0;
    let defaultY = 0;
    const visible = existing.filter(l => l.visible);
    if (visible.length) {
      defaultX = Math.min(...visible.map(l => l.bounds.x));
      defaultY = Math.min(...visible.map(l => l.bounds.y));
    }
    const layer = makeDefaultLayer({
      bounds: { x: defaultX, y: defaultY, w: def.w, h: def.h },
      layerCount: existing.length,
      zIndex: maxZ + 1,
    });
    layer.workflow = {
      ...src.workflow,
      checkpoints: src.workflow.checkpoints.map(c => ({ ...c })),
      loras: src.workflow.loras.map(l => ({ ...l })),
    };
    layer.layers = src.layers.map(l => ({ ...l }));
    const next = [...existing, layer];
    canvasStorage.saveLayer(layer).catch(err => {
      console.error('[canvasStore] addCanvasLayerFromSource persist failed', err);
    });
    try { localStorage.setItem(ACTIVE_CANVAS_LAYER_KEY, layer.id); } catch { /* ignore */ }
    set({ canvasLayers: next, activeLayerId: layer.id });
    return layer.id;
  },

  addCanvasFolder: (name) => {
    const existing = get().canvasLayers;
    const maxZ = existing.length ? Math.max(...existing.map(l => l.zIndex)) : -1;
    const folder = makeDefaultLayer({
      bounds: { x: 0, y: 0, w: 0, h: 0 },
      name: name ?? `Group ${existing.filter(l => l.isFolder).length + 1}`,
      layerCount: existing.length,
      zIndex: maxZ + 1,
    });
    folder.isFolder = true;
    folder.folderCollapsed = false;
    const next = [...existing, folder];
    canvasStorage.saveLayer(folder).catch(err => {
      console.error('[canvasStore] addCanvasFolder persist failed', err);
    });
    set({ canvasLayers: next });
    return folder.id;
  },

  setLayerParent: (id, parentId) => {
    const existing = get().canvasLayers;
    const layer = existing.find(l => l.id === id);
    if (!layer) return;
    if (layer.isFolder) return; // folders don't nest
    // Reject if parent doesn't exist or isn't a folder.
    let nextParent: string | undefined;
    if (parentId == null) {
      nextParent = undefined;
    } else {
      const target = existing.find(l => l.id === parentId);
      if (!target || !target.isFolder) return;
      nextParent = parentId;
    }
    if (layer.parentId === nextParent) return;
    const merged = { ...layer, parentId: nextParent };
    const next = existing.map(l => (l.id === id ? merged : l));
    canvasStorage.saveLayer(merged).catch(err => {
      console.error('[canvasStore] setLayerParent persist failed', err);
    });
    set({ canvasLayers: next });
  },

  toggleFolderCollapsed: (id) => {
    const existing = get().canvasLayers;
    const folder = existing.find(l => l.id === id);
    if (!folder || !folder.isFolder) return;
    const merged = { ...folder, folderCollapsed: !folder.folderCollapsed };
    const next = existing.map(l => (l.id === id ? merged : l));
    canvasStorage.saveLayer(merged).catch(err => {
      console.error('[canvasStore] toggleFolderCollapsed persist failed', err);
    });
    set({ canvasLayers: next });
  },

  removeCanvasLayer: (id) => {
    const existing = get().canvasLayers;
    if (!existing.some(l => l.id === id)) return;
    // Deleting a folder un-parents its children (does NOT cascade-delete them).
    const target = existing.find(l => l.id === id);
    let next = existing.filter(l => l.id !== id);
    if (target?.isFolder) {
      next = next.map(l => (l.parentId === id ? { ...l, parentId: undefined } : l));
      // Persist re-parented children
      for (const l of next) {
        if (existing.find(o => o.id === l.id)?.parentId === id) {
          canvasStorage.saveLayer(l).catch(() => { /* logged below */ });
        }
      }
    }
    canvasStorage.deleteLayer(id).catch(err => {
      // eslint-disable-next-line no-console
      console.error('[canvasStore] removeCanvasLayer persist failed', err);
    });
    let activeLayerId = get().activeLayerId;
    if (activeLayerId === id) {
      // Pick the next-highest-zIndex visible layer, else any remaining, else null.
      const fallback = [...next]
        .filter(l => l.visible)
        .sort((a, b) => b.zIndex - a.zIndex)[0]
        ?? [...next].sort((a, b) => b.zIndex - a.zIndex)[0]
        ?? null;
      activeLayerId = fallback ? fallback.id : null;
      try {
        if (activeLayerId == null) localStorage.removeItem(ACTIVE_CANVAS_LAYER_KEY);
        else localStorage.setItem(ACTIVE_CANVAS_LAYER_KEY, activeLayerId);
      } catch { /* ignore */ }
    }
    set({ canvasLayers: next, activeLayerId });
  },

  clearAllCanvasLayers: () => {
    const existing = get().canvasLayers;
    if (existing.length === 0) {
      if (get().activeLayerId != null) {
        try { localStorage.removeItem(ACTIVE_CANVAS_LAYER_KEY); } catch { /* ignore */ }
        set({ activeLayerId: null });
      }
      return;
    }
    // Best-effort persistence cleanup; storage errors don't block the in-
    // memory wipe so the UI doesn't get stuck showing stale layers.
    for (const l of existing) {
      canvasStorage.deleteLayer(l.id).catch(err => {
        // eslint-disable-next-line no-console
        console.error('[canvasStore] clearAllCanvasLayers persist failed', err);
      });
    }
    try { localStorage.removeItem(ACTIVE_CANVAS_LAYER_KEY); } catch { /* ignore */ }
    set({ canvasLayers: [], activeLayerId: null });
  },

  updateCanvasLayer: (id, patch) => {
    const existing = get().canvasLayers;
    const idx = existing.findIndex(l => l.id === id);
    if (idx < 0) {
      // eslint-disable-next-line no-console
      console.warn(`[canvasStore] updateCanvasLayer: unknown id ${id}`);
      return;
    }
    const prev = existing[idx];
    const merged: CanvasLayer = { ...prev, ...patch, id: prev.id };
    const next = existing.slice();
    next[idx] = merged;
    // Maintain ascending-zIndex invariant in case the patch touched zIndex.
    if (patch.zIndex !== undefined) {
      next.sort((a, b) => a.zIndex - b.zIndex);
    }
    canvasStorage.saveLayer(merged).catch(err => {
      // eslint-disable-next-line no-console
      console.error('[canvasStore] updateCanvasLayer persist failed', err);
    });
    set({ canvasLayers: next });
  },

  duplicateLayerParams: (fromId, toId) => {
    if (fromId === toId) return;
    const canvasLayers = get().canvasLayers;
    const src = canvasLayers.find(l => l.id === fromId);
    const dst = canvasLayers.find(l => l.id === toId);
    if (!src || !dst) return;
    // Deep-clone the workflow arrays + prompt layers so future edits on
    // either layer don't bleed across.
    const workflow = {
      ...src.workflow,
      checkpoints: src.workflow.checkpoints.map(c => ({ ...c })),
      loras: src.workflow.loras.map(l => ({ ...l })),
    };
    const promptLayers = src.layers.map(l => ({ ...l }));
    get().updateCanvasLayer(toId, { workflow, layers: promptLayers });
    // If the destination is currently active, the scope-sync subscriber
    // won't re-fire (the scope key didn't change), so we mirror both
    // workflow and prompt layers into useStore manually to refresh the
    // panel.
    if (get().activeLayerId === toId) {
      // Lazy import to avoid the store-circular at module load.
      void import('./store').then(({ useStore }) => {
        useStore.setState({ workflow, layers: promptLayers });
      });
    }
  },


  reorderCanvasLayers: (fromIdx, toIdx) => {
    const existing = get().canvasLayers;
    if (
      fromIdx === toIdx ||
      fromIdx < 0 || fromIdx >= existing.length ||
      toIdx < 0 || toIdx >= existing.length
    ) return;
    const reordered = existing.slice();
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    // Rewrite zIndex so panel order = z-order. Only persist the ones whose
    // zIndex actually changed.
    const touched: CanvasLayer[] = [];
    const next: CanvasLayer[] = reordered.map((l, i) => {
      if (l.zIndex === i) return l;
      const upd = { ...l, zIndex: i };
      touched.push(upd);
      return upd;
    });
    for (const l of touched) {
      canvasStorage.saveLayer(l).catch(err => {
        // eslint-disable-next-line no-console
        console.error('[canvasStore] reorderCanvasLayers persist failed', err);
      });
    }
    set({ canvasLayers: next });
  },

  setActiveLayer: (id) => {
    try {
      if (id == null) localStorage.removeItem(ACTIVE_CANVAS_LAYER_KEY);
      else localStorage.setItem(ACTIVE_CANVAS_LAYER_KEY, id);
    } catch { /* ignore */ }
    // Remember the most-recently-active layer across deselects (#41) — used
    // by addCanvasLayer as the params source for fresh layers. Only updated
    // on selection, not on clear, so a "Generate without selecting" round-
    // trip still preserves the prior context.
    // Switching layers invalidates any in-flight selection rect (it was
    // sized + positioned against the previous layer's bounds).
    const sel = get().activeSelection;
    if (sel && sel.layerId !== id) set({ activeSelection: null });
    if (id != null) set({ activeLayerId: id, lastActiveLayerId: id });
    else set({ activeLayerId: id });
  },

  setLayerBackground: (id, bg) => {
    get().updateCanvasLayer(id, { background: bg });
  },

  // Grid config — synchronously hydrated from localStorage.
  ...(() => {
    const cfg = loadGrid();
    return { gridStep: cfg.step, snapEnabled: cfg.snapEnabled };
  })(),
  adjustGridStep: (delta) => {
    const cur = get().gridStep;
    const next = Math.max(GRID_MIN, Math.min(GRID_MAX, cur + Math.round(delta / GRID_INCREMENT) * GRID_INCREMENT));
    if (next === cur) return;
    persistGrid({ step: next, snapEnabled: get().snapEnabled });
    set({ gridStep: next });
  },
  setGridStep: (step) => {
    const clamped = Math.max(GRID_MIN, Math.min(GRID_MAX, Math.round(step / GRID_INCREMENT) * GRID_INCREMENT));
    if (clamped === get().gridStep) return;
    persistGrid({ step: clamped, snapEnabled: get().snapEnabled });
    set({ gridStep: clamped });
  },
  setSnapEnabled: (enabled) => {
    if (enabled === get().snapEnabled) return;
    persistGrid({ step: get().gridStep, snapEnabled: enabled });
    set({ snapEnabled: enabled });
  },

  // Default layer size — synchronously hydrated from localStorage.
  defaultLayerSize: loadDefaultLayerSize(),
  setDefaultLayerSize: (size) => {
    const w = Math.max(64, Math.round(size.w));
    const h = Math.max(64, Math.round(size.h));
    if (w === get().defaultLayerSize.w && h === get().defaultLayerSize.h) return;
    persistDefaultLayerSize({ w, h });
    set({ defaultLayerSize: { w, h } });
  },

  // Canvas view mode — synchronously hydrated from localStorage.
  activeTool: (() => {
    try {
      const v = localStorage.getItem(ACTIVE_TOOL_KEY) as CanvasToolId | null;
      if (v && findTool(v)) return v;
    } catch { /* ignore */ }
    return DEFAULT_CANVAS_TOOL;
  })(),
  setActiveTool: (id) => {
    if (id === get().activeTool) return;
    if (!findTool(id)) return; // unknown tool id — ignore (registry was probably stale)
    try { localStorage.setItem(ACTIVE_TOOL_KEY, id); } catch { /* ignore */ }
    set({ activeTool: id });
  },

  brush: loadBrush(),
  setBrush: (patch) => {
    const next = { ...get().brush, ...patch };
    try { localStorage.setItem(BRUSH_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    set({ brush: next });
  },

  masksVisible: (() => {
    try { return localStorage.getItem(MASKS_VISIBLE_KEY) === '1'; } catch { return false; }
  })(),
  setMasksVisible: (v) => {
    if (v === get().masksVisible) return;
    try { localStorage.setItem(MASKS_VISIBLE_KEY, v ? '1' : '0'); } catch { /* ignore */ }
    set({ masksVisible: v });
  },

  activeSelection: null,
  setActiveSelection: (s) => set({ activeSelection: s }),
  clearActiveSelection: () => set({ activeSelection: null }),

  comfyServerId: null,
  setComfyServerId: (id) => set({ comfyServerId: id }),

  mainView: loadMainView(),
  setMainView: (m) => {
    if (m === get().mainView) return;
    persistMainView(m);
    // Leaving the infinite canvas deselects any active canvas layer (#41) —
    // the params panel then shows the global workflow instead of a layer-
    // scoped one. The scope-sync subscriber notices and swaps
    // useStore.workflow back to the global backup.
    if (m !== 'canvas' && get().activeLayerId) {
      get().setActiveLayer(null);
    }
    set({ mainView: m });
  },

  livePreviews: {},
  setLivePreview: (serverId, url) => {
    const map = get().livePreviews;
    const prev = map[serverId];
    if (prev && prev !== url && prev.startsWith('blob:')) {
      URL.revokeObjectURL(prev);
    }
    if (url) {
      set({ livePreviews: { ...map, [serverId]: url } });
    } else if (serverId in map) {
      const { [serverId]: _, ...rest } = map;
      set({ livePreviews: rest });
    }
  },

}));

// Kick off the async canvas-layer hydration. The store renders with an empty
// `canvasLayers: []` + `canvasLayersHydrated: false` until this resolves;
// the activeLayerId was already read synchronously from localStorage above.
// Fire-and-forget — `initCanvasLayers` swallows + logs any failure so the
// UI never hangs waiting on IDB.
useCanvasStore.getState().initCanvasLayers();

// Devtools convenience: expose the store on window so it can be poked from
// the console (e.g. for inspecting grid config, layer state, dispatching
// actions). Harmless in prod; no behavior change.
if (typeof window !== 'undefined') {
  (window as unknown as { __canvasStore?: typeof useCanvasStore }).__canvasStore = useCanvasStore;
}
