import type { Layer, Snippet, SnippetCategory, HistoryEntry, WorkflowState, Collection, ImportedImage } from './types';

// ---------------------------------------------------------------------------
// Storage keys
//
// Everything except the server list + routing is GLOBAL now — there's no
// per-server namespacing anymore. A "server" is just a ComfyUI endpoint; the
// workflow params, models, prompt layers, snippets and history are shared, and
// jobs are routed to servers by a separate mechanism (see `routing`).
//
// Versions were bumped for the un-namespacing migration below.
// ---------------------------------------------------------------------------

/** Prompt layers — already shared before the unification, key kept as-is. */
export const SHARED_PROMPT_KEY = 'imagelab.prompt.shared.v1';
// v3 — added `categoryId` and a richer default library; bumped so first-run
// users get the new defaults but anyone who saved snippets keeps theirs.
export const SNIPPETS_KEY = 'imagelab.snippets.v3';
export const SNIPPET_CATEGORIES_KEY = 'imagelab.snippetCategories.v1';
export const HISTORY_KEY = 'imagelab.history.v2';
// v4: un-namespaced — params are now global across all servers.
// v7: Hi-Res Fix + Auto-Tag Refine removed; replaced by a multi-pass `passes[]`
//     array. The v6→v7 reader migrates old hires* fields into a second Pass.
export const WORKFLOW_KEY = 'imagelab.workflow.v7';
const LEGACY_WORKFLOW_KEY_V6 = 'imagelab.workflow.v6';
/** Held separately from `WORKFLOW_KEY` because a dataURL is heavy — we don't
 *  want to re-serialize it on every unrelated workflow tweak. */
export const INPUT_IMAGE_KEY = 'imagelab.inputImage.v1';
export const SERVERS_KEY = 'imagelab.servers.v1';
export const ROUTING_KEY = 'imagelab.routing.v1';
export const COLLAPSE_KEY = 'imagelab.collapse.v1';
export const PANEL_TAB_KEY = 'imagelab.panelTab.v1';
export const SLIDESHOW_PLAYING_KEY = 'imagelab.slideshowPlaying.v1';
export const VENICE_KEY = 'imagelab.venice.v1';
export const CIVITAI_KEY = 'imagelab.civitai.v1';
export const PREVIEW_SOURCE_KEY = 'imagelab.previewSource.v1';
export const MODEL_PICKER_FILTER_KEY = 'imagelab.modelPickerFilter.v1';
export const MODEL_PICKER_SERVERS_KEY = 'imagelab.modelPickerServers.v1';
/** When true (default), a completed job jumps the canvas to the new image and
 *  fits it to view. Toggled from the floating top-nav button. */
export const AUTO_FRAME_KEY = 'imagelab.autoFrameOnComplete.v1';
/** Min thumbnail width (px) for the Collections grid. Adjustable via the
 *  slider in the Collections toolbar; persists across reloads. */
export const COLLECTIONS_TILE_SIZE_KEY = 'imagelab.collectionsTileSize.v1';
export const THEME_KEY = 'imagelab.theme.v1';
/** User-defined collections (name + icon + ordered itemIds). Blob payload
 *  for imports lives in IndexedDB; this key holds only the lists. */
export const COLLECTIONS_KEY = 'imagelab.collections.v1';
/** Metadata for every imported image. Blob bytes live in IndexedDB
 *  (`importedDb.ts`); this key keeps id/name/dimensions/AI cache so the
 *  Collections panel renders synchronously without awaiting IDB. */
export const IMPORTED_IMAGES_KEY = 'imagelab.imported.v1';
export const HISTORY_MAX = 60;

// Legacy keys, read once during migration from the per-workspace era.
const LEGACY_PROMPT_KEY = 'imagelab.prompt.v1';
const LEGACY_SNIPPETS_KEY = 'imagelab.snippets.v1';
const LEGACY_SNIPPETS_V2_KEY = 'imagelab.snippets.v2';
const LEGACY_HISTORY_KEY = 'imagelab.history.v1';
const LEGACY_WORKFLOW_KEY = 'imagelab.workflow.v3';
const LEGACY_WORKSPACES_KEY = 'imagelab.workspaces.v1';
const LEGACY_ACTIVE_WS_KEY = 'imagelab.activeWorkspace';

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export const FALLBACKS = {
  samplers: ['euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_3m_sde',
             'dpmpp_sde', 'heun', 'lms', 'ddim', 'uni_pc'],
  schedulers: ['normal', 'karras', 'exponential', 'sgm_uniform', 'simple', 'ddim_uniform'],
  models: [] as string[],
  vaes: [] as string[],
  loras: [] as string[],
  tagModels: [] as string[],
  upscaleModels: [] as string[],
  controlnets: [] as string[],
};

/** Width × height presets for the Output size dropdown (SDXL-friendly buckets). */
export const RESOLUTION_PRESETS: Array<[number, number]> = [
  [1024, 1024],
  [1152, 896],
  [896, 1152],
  [1216, 832],
  [832, 1216],
  [1344, 768],
  [768, 1344],
  [1536, 640],
  [640, 1536],
  [768, 768],
  [512, 512],
];

// Use the Traefik-fronted hostname so HTTPS pages can reach ComfyUI without
// triggering mixed content. See ~/Docker/infra/traefik/data/config.yml.
export const DEFAULT_COMFY_HOST = 'comfy.dev.blueoceanswim.com';

// ---------------------------------------------------------------------------
// Servers
//
// A "server" is one ComfyUI endpoint. Unlike the old "workspace", it carries
// no isolated state — just an id / name / host. Jobs are spread across servers
// by the routing mechanism (round-robin or pinned).
// ---------------------------------------------------------------------------

export type Server = {
  id: string;
  name: string;
  host: string;
  /** When false, the server is paused: no WS connection, no capability poll,
   *  excluded from round-robin routing and from the picker's pinned options.
   *  Defaults to true on every existing record so legacy rows just work. */
  enabled?: boolean;
};

/** The two ComfyUI boxes on the LAN, seeded into a fresh install. */
export const SEED_SERVERS: Array<Omit<Server, 'id'>> = [
  { name: 'Server 1', host: 'comfy.dev.blueoceanswim.com' },
  { name: 'Server 2', host: 'comfy2.dev.blueoceanswim.com' },
];

function normalizeServers(raw: unknown): Server[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Partial<Server> => !!s && typeof s.id === 'string')
    .map((s): Server => ({
      id: s.id as string,
      name: String(s.name || 'Server'),
      host: String(s.host || DEFAULT_COMFY_HOST),
      enabled: s.enabled !== false,
    }));
}

/**
 * Bootstrap the server list. Handles three cases:
 *  1. Already migrated — `SERVERS_KEY` is present.
 *  2. Upgrading from the per-workspace era — read `LEGACY_WORKSPACES_KEY` and
 *     migrate that workspace's params/snippets/history into the new global keys.
 *  3. Fresh install — seed the two known LAN servers.
 */
function initServers(): Server[] {
  // 1. Already on the new scheme.
  try {
    const existing = normalizeServers(JSON.parse(localStorage.getItem(SERVERS_KEY) || 'null'));
    if (existing.length) return existing;
  } catch { /* fall through */ }

  // 2. Migrate from the legacy per-workspace scheme, if present.
  let legacy: Server[] = [];
  try {
    legacy = normalizeServers(JSON.parse(localStorage.getItem(LEGACY_WORKSPACES_KEY) || 'null'));
  } catch { /* ignore */ }

  if (legacy.length) {
    migrateLegacyData(legacy);
    persistServers(legacy);
    return legacy;
  }

  // 3. Fresh install.
  const seeded = SEED_SERVERS.map(s => ({ id: uid(), ...s }));
  persistServers(seeded);
  return seeded;
}

/**
 * Promote the legacy per-workspace data to the new global keys (run once):
 *  - params + snippets come from whichever workspace was active
 *  - history is *merged* across every workspace, each entry stamped with the
 *    server (workspace) it ran on
 */
function migrateLegacyData(servers: Server[]) {
  const activeId = localStorage.getItem(LEGACY_ACTIVE_WS_KEY) || servers[0]?.id || '';

  const copy = (from: string, to: string) => {
    try {
      const v = localStorage.getItem(from);
      if (v != null && localStorage.getItem(to) == null) localStorage.setItem(to, v);
    } catch { /* ignore */ }
  };
  copy(`${LEGACY_WORKFLOW_KEY}::${activeId}`, WORKFLOW_KEY);
  copy(`${LEGACY_SNIPPETS_KEY}::${activeId}`, SNIPPETS_KEY);

  // Merge every workspace's history into one server-tagged list.
  if (localStorage.getItem(HISTORY_KEY) == null) {
    const merged: HistoryEntry[] = [];
    for (const s of servers) {
      try {
        const arr = JSON.parse(localStorage.getItem(`${LEGACY_HISTORY_KEY}::${s.id}`) || '[]');
        if (Array.isArray(arr)) {
          for (const e of arr) merged.push({ ...e, serverId: e?.serverId || e?.workspaceId || s.id });
        }
      } catch { /* ignore */ }
    }
    merged.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
    if (merged.length > HISTORY_MAX) merged.length = HISTORY_MAX;
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(merged)); } catch { /* ignore */ }
  }
}

function persistServers(list: Server[]) {
  try { localStorage.setItem(SERVERS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

let _servers: Server[] = initServers();

export function getServers(): Server[] {
  return _servers.map(s => ({ ...s }));
}

/** Persist the full server list (after add / rename / edit host / remove). */
export function saveServers(list: Server[]) {
  _servers = list.map(s => ({ ...s }));
  persistServers(_servers);
}

/**
 * Prompt layers used to live under a per-workspace key, then a shared one.
 * Seed the shared key once from the legacy data so nobody loses their prompt.
 */
function initSharedPrompt() {
  if (localStorage.getItem(SHARED_PROMPT_KEY) != null) return;
  const activeId = localStorage.getItem(LEGACY_ACTIVE_WS_KEY) || '';
  const candidates = [
    activeId ? `${LEGACY_PROMPT_KEY}::${activeId}` : '',
    LEGACY_PROMPT_KEY,
  ].filter(Boolean);
  for (const key of candidates) {
    const v = localStorage.getItem(key);
    if (v != null) {
      try { localStorage.setItem(SHARED_PROMPT_KEY, v); } catch { /* ignore */ }
      return;
    }
  }
}

initSharedPrompt();

// ---------------------------------------------------------------------------
// Routing — how queued jobs are spread across servers.
// `mode` is 'round-robin' or a specific server id; `rrIndex` is the rotating
// cursor for round-robin.
// ---------------------------------------------------------------------------

export const ROUND_ROBIN = 'round-robin';
export type Routing = { mode: string; rrIndex: number };

export function loadRouting(): Routing {
  try {
    const raw = JSON.parse(localStorage.getItem(ROUTING_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      return {
        mode: typeof raw.mode === 'string' && raw.mode ? raw.mode : ROUND_ROBIN,
        rrIndex: Number.isFinite(raw.rrIndex) ? (raw.rrIndex as number) : 0,
      };
    }
  } catch { /* fall through */ }
  return { mode: ROUND_ROBIN, rrIndex: 0 };
}

export function saveRouting(r: Routing) {
  try { localStorage.setItem(ROUTING_KEY, JSON.stringify(r)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export function defaultWorkflow(): WorkflowState {
  return {
    inputImage: null,
    inputDenoise: 0.75,
    inputMaxSize: 1024,
    inputMinSize: 512,
    inpaintFeather: 16,
    inpaintMaskExpand: 0,
    inpaintVariant: 'auto',
    inpaintContextExtend: 1.5,
    inpaintTargetSize: 'auto',
    inpaintInvertMask: false,
    inpaintUseControlnet: false,
    inpaintControlnet: '',
    inpaintControlnetStrength: 1.0,
    seed: 0,
    randomizeSeed: false,
    steps: 12,
    cfg: 8.6,
    sampler: 'euler_ancestral',
    scheduler: 'normal',
    denoise: 1.0,
    width: 1024,
    height: 1024,
    batch: 1,
    checkpoints: [{ id: uid(), name: 'pleasurechest_v1.safetensors', ratio: 0.5 }],
    vae: 'sdxl_vae-fp16fix-blessed.safetensors',
    loras: [],
    passes: [],
    upscaleEnabled: false,
    upscaleModel: '',
    removeBg: false,
  };
}

export function defaultLayers(): Layer[] {
  return [
    { id: uid(), on: true, kind: 'positive', tag: 'Subject', text: 'a cat in a window', weight: 1.0 },
    { id: uid(), on: true, kind: 'positive', tag: 'Light',   text: 'soft light',         weight: 0.8 },
    { id: uid(), on: true, kind: 'negative', tag: 'Common',  text: 'blurry, low quality', weight: 1.0 },
  ];
}

// ---------------------------------------------------------------------------
// Snippet library — categories + default base set
//
// Categories use stable string ids so a rename in `defaultSnippetCategories()`
// doesn't strand snippets. Snippets reference categoryId. The default library
// is overwritten with the user's own once they save anything — first-run only.
// ---------------------------------------------------------------------------

export const DEFAULT_CATEGORY_ID = 'uncategorized';
/** Stable id for the Civit.ai-sourced snippets category. Created on demand
 *  the first time the user saves a prompt from the model-metadata modal. */
export const CIVITAI_CATEGORY_ID = 'civitai';

export function defaultSnippetCategories(): SnippetCategory[] {
  return [
    { id: 'subject',      name: 'Subject',      icon: '🧍' },
    { id: 'lighting',     name: 'Lighting',     icon: '💡' },
    { id: 'color',        name: 'Color',        icon: '🎨' },
    { id: 'style',        name: 'Style',        icon: '✨' },
    { id: 'camera',       name: 'Camera',       icon: '📷' },
    { id: 'composition',  name: 'Composition',  icon: '🖼️' },
    { id: 'mood',         name: 'Mood',         icon: '🌙' },
    { id: 'quality',      name: 'Quality',      icon: '⭐' },
    { id: 'neg-common',   name: 'Negative · Common',  icon: '🚫' },
    { id: 'neg-anatomy',  name: 'Negative · Anatomy', icon: '🦴' },
    { id: 'neg-style',    name: 'Negative · Style',   icon: '⛔' },
    { id: DEFAULT_CATEGORY_ID, name: 'Uncategorized', icon: '📁' },
  ];
}

/** Solid starter library — keep small but covers the common iteration loops. */
export function defaultSnippets(): Snippet[] {
  type Seed = Omit<Snippet, 'id'>;
  const seeds: Seed[] = [
    // — Lighting (positive)
    { name: 'Cinematic light',  tag: 'Light', text: 'cinematic lighting, dramatic shadows, volumetric light', weight: 0.95, kind: 'positive', categoryId: 'lighting' },
    { name: 'Golden hour',      tag: 'Light', text: 'golden hour, warm sunlight, long shadows',               weight: 0.9,  kind: 'positive', categoryId: 'lighting' },
    { name: 'Soft studio',      tag: 'Light', text: 'soft diffused studio lighting, softbox, even fill',      weight: 0.85, kind: 'positive', categoryId: 'lighting' },
    { name: 'Rim light',        tag: 'Light', text: 'rim lighting, back-lit, glowing edges',                  weight: 0.9,  kind: 'positive', categoryId: 'lighting' },
    { name: 'Neon noir',        tag: 'Light', text: 'neon lights, cyberpunk glow, magenta and cyan rim light',weight: 0.95, kind: 'positive', categoryId: 'lighting' },
    { name: 'Moonlit',          tag: 'Light', text: 'moonlight, cool blue tones, soft ambient',               weight: 0.85, kind: 'positive', categoryId: 'lighting' },

    // — Color
    { name: 'Vibrant palette',  tag: 'Color', text: 'vibrant saturated colors, bold contrast',                weight: 0.9,  kind: 'positive', categoryId: 'color' },
    { name: 'Muted earth',      tag: 'Color', text: 'muted earth tones, ochre, sepia, desaturated',           weight: 0.9,  kind: 'positive', categoryId: 'color' },
    { name: 'Monochrome',       tag: 'Color', text: 'black and white, monochrome, high contrast',             weight: 1.0,  kind: 'positive', categoryId: 'color' },
    { name: 'Teal & orange',    tag: 'Color', text: 'teal and orange color grade, complementary palette',     weight: 0.9,  kind: 'positive', categoryId: 'color' },
    { name: 'Pastel',           tag: 'Color', text: 'pastel palette, soft hues, low saturation',              weight: 0.85, kind: 'positive', categoryId: 'color' },

    // — Style
    { name: 'Photorealistic',   tag: 'Style', text: 'photorealistic, hyper detailed, sharp focus',            weight: 1.0,  kind: 'positive', categoryId: 'style' },
    { name: 'Anime',            tag: 'Style', text: 'anime style, cel shaded, line art, vibrant',             weight: 1.0,  kind: 'positive', categoryId: 'style' },
    { name: 'Watercolor',       tag: 'Style', text: 'watercolor painting, soft edges, paper texture',         weight: 0.95, kind: 'positive', categoryId: 'style' },
    { name: 'Oil painting',     tag: 'Style', text: 'oil painting, thick brush strokes, painterly',           weight: 0.95, kind: 'positive', categoryId: 'style' },
    { name: 'Concept art',      tag: 'Style', text: 'digital concept art, matte painting, trending on artstation', weight: 0.9, kind: 'positive', categoryId: 'style' },
    { name: '3D render',        tag: 'Style', text: 'octane render, unreal engine, ray traced, 3d render',    weight: 0.95, kind: 'positive', categoryId: 'style' },
    { name: 'Pixel art',        tag: 'Style', text: 'pixel art, 16-bit, retro game sprite, dithering',        weight: 1.0,  kind: 'positive', categoryId: 'style' },

    // — Camera
    { name: 'Kodak Portra 400', tag: 'Cam',   text: 'kodak portra 400, 35mm, shallow depth of field, film grain', weight: 0.9, kind: 'positive', categoryId: 'camera' },
    { name: '85mm portrait',    tag: 'Cam',   text: '85mm lens, portrait, bokeh, shallow depth of field',     weight: 0.85, kind: 'positive', categoryId: 'camera' },
    { name: 'Wide angle',       tag: 'Cam',   text: '24mm wide angle, deep depth of field, expansive view',   weight: 0.85, kind: 'positive', categoryId: 'camera' },
    { name: 'Macro',            tag: 'Cam',   text: 'macro photography, extreme close-up, high detail',       weight: 0.9,  kind: 'positive', categoryId: 'camera' },
    { name: 'Drone shot',       tag: 'Cam',   text: 'aerial drone shot, top-down view',                       weight: 0.9,  kind: 'positive', categoryId: 'camera' },

    // — Composition
    { name: 'Rule of thirds',   tag: 'Comp',  text: 'rule of thirds composition, dynamic framing',            weight: 0.8,  kind: 'positive', categoryId: 'composition' },
    { name: 'Symmetry',         tag: 'Comp',  text: 'symmetrical composition, centered, balanced',            weight: 0.85, kind: 'positive', categoryId: 'composition' },
    { name: 'Low angle',        tag: 'Comp',  text: 'low angle shot, looking up, heroic perspective',         weight: 0.9,  kind: 'positive', categoryId: 'composition' },
    { name: 'Negative space',   tag: 'Comp',  text: 'lots of negative space, minimalist, isolated subject',   weight: 0.85, kind: 'positive', categoryId: 'composition' },

    // — Mood
    { name: 'Moody / dramatic', tag: 'Mood',  text: 'moody, dramatic, brooding atmosphere',                   weight: 0.9,  kind: 'positive', categoryId: 'mood' },
    { name: 'Dreamy',           tag: 'Mood',  text: 'dreamy, ethereal, soft focus, hazy',                     weight: 0.85, kind: 'positive', categoryId: 'mood' },
    { name: 'Surreal',          tag: 'Mood',  text: 'surreal, dreamlike, impossible geometry',                weight: 0.9,  kind: 'positive', categoryId: 'mood' },
    { name: 'Cozy',             tag: 'Mood',  text: 'cozy, warm, inviting, comfortable',                      weight: 0.85, kind: 'positive', categoryId: 'mood' },

    // — Quality boosters
    { name: 'Masterpiece',      tag: 'Q',     text: 'masterpiece, best quality, highly detailed',             weight: 1.1,  kind: 'positive', categoryId: 'quality' },
    { name: 'Ultra sharp',      tag: 'Q',     text: 'ultra sharp, intricate detail, 8k, crisp',               weight: 1.0,  kind: 'positive', categoryId: 'quality' },
    { name: 'Award-winning',    tag: 'Q',     text: 'award-winning photograph, professional',                 weight: 0.9,  kind: 'positive', categoryId: 'quality' },

    // — Negative · Common
    { name: 'Common bad',       tag: 'Bad',   text: 'blurry, low quality, jpeg artifacts, watermark, text',   weight: 1.0,  kind: 'negative', categoryId: 'neg-common' },
    { name: 'Low-res',          tag: 'Bad',   text: 'low resolution, pixelated, compression artifacts',       weight: 1.0,  kind: 'negative', categoryId: 'neg-common' },
    { name: 'Oversaturated',    tag: 'Bad',   text: 'oversaturated, blown out colors, over-processed',        weight: 0.9,  kind: 'negative', categoryId: 'neg-common' },

    // — Negative · Anatomy
    { name: 'Bad anatomy',      tag: 'Body',  text: 'bad anatomy, deformed, disfigured, mutated',             weight: 1.1,  kind: 'negative', categoryId: 'neg-anatomy' },
    { name: 'Bad hands',        tag: 'Body',  text: 'bad hands, extra fingers, missing fingers, fused fingers', weight: 1.2, kind: 'negative', categoryId: 'neg-anatomy' },
    { name: 'Bad face',         tag: 'Face',  text: 'bad face, asymmetric eyes, distorted features',          weight: 1.0,  kind: 'negative', categoryId: 'neg-anatomy' },

    // — Negative · Style
    { name: 'No cartoon',       tag: 'Style', text: 'cartoon, anime, illustration, 3d render',                weight: 0.9,  kind: 'negative', categoryId: 'neg-style' },
    { name: 'No painting',      tag: 'Style', text: 'painting, drawing, sketch',                              weight: 0.9,  kind: 'negative', categoryId: 'neg-style' },
  ];
  return seeds.map(s => ({ ...s, id: uid() }));
}

function normalizeCategory(c: Partial<SnippetCategory>): SnippetCategory {
  return {
    id: String(c.id || uid()),
    name: String(c.name || 'Untitled'),
    icon: typeof c.icon === 'string' ? c.icon : undefined,
  };
}

export function loadSnippetCategories(): SnippetCategory[] {
  try {
    const arr = JSON.parse(localStorage.getItem(SNIPPET_CATEGORIES_KEY) || 'null');
    if (Array.isArray(arr) && arr.length) return arr.map(normalizeCategory);
  } catch { /* fall through */ }
  return defaultSnippetCategories();
}

export function saveSnippetCategories(arr: SnippetCategory[]) {
  try { localStorage.setItem(SNIPPET_CATEGORIES_KEY, JSON.stringify(arr)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Collapsed-section persistence — `imagelab.collapse.v1`: {[key]: boolean}.
// True = collapsed/hidden. Loaders accept the missing-key case and use the
// caller's `defaultOpen`.
// ---------------------------------------------------------------------------

let _collapseCache: Record<string, boolean> | null = null;
function readCollapseCache(): Record<string, boolean> {
  if (_collapseCache) return _collapseCache;
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}');
    _collapseCache = (raw && typeof raw === 'object') ? raw as Record<string, boolean> : {};
  } catch { _collapseCache = {}; }
  return _collapseCache;
}

export function loadCollapsed(key: string, defaultCollapsed: boolean): boolean {
  const cache = readCollapseCache();
  return key in cache ? !!cache[key] : defaultCollapsed;
}

export function saveCollapsed(key: string, collapsed: boolean) {
  const cache = readCollapseCache();
  cache[key] = collapsed;
  try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(cache)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Left-panel tab persistence — which of {prompt, parameters, post} is open.
// ---------------------------------------------------------------------------

export type PanelTab = 'prompt' | 'parameters' | 'post';
const PANEL_TABS: readonly PanelTab[] = ['prompt', 'parameters', 'post'];

export function loadPanelTab(fallback: PanelTab = 'prompt'): PanelTab {
  try {
    const raw = localStorage.getItem(PANEL_TAB_KEY);
    if (raw && (PANEL_TABS as readonly string[]).includes(raw)) return raw as PanelTab;
  } catch { /* ignore */ }
  return fallback;
}

export function savePanelTab(tab: PanelTab) {
  try { localStorage.setItem(PANEL_TAB_KEY, tab); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Slideshow play/pause — a single global preference (NOT keyed per model or
// per viewer). Used by the model-metadata modal's gallery slideshow and the
// fullscreen image viewer.
// ---------------------------------------------------------------------------

export function loadSlideshowPlaying(fallback = true): boolean {
  try {
    const raw = localStorage.getItem(SLIDESHOW_PLAYING_KEY);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  } catch { /* ignore */ }
  return fallback;
}

export function saveSlideshowPlaying(playing: boolean) {
  try { localStorage.setItem(SLIDESHOW_PLAYING_KEY, String(playing)); } catch { /* ignore */ }
}

// ── NSFW filter for the metadata modal's gallery. Persisted globally so the
//    user's choice ("show NSFW", "SFW only", "all") survives across modal
//    opens and reloads — there's no reason to reset it on every open. ──
export const NSFW_FILTER_KEY = 'imagelab.nsfwFilter.v1';

export function loadNsfwFilter(): 'all' | 'sfw' | 'nsfw' {
  try {
    const raw = localStorage.getItem(NSFW_FILTER_KEY);
    if (raw === 'all' || raw === 'sfw' || raw === 'nsfw') return raw;
  } catch { /* ignore */ }
  return 'all';
}

export function saveNsfwFilter(v: 'all' | 'sfw' | 'nsfw') {
  try { localStorage.setItem(NSFW_FILTER_KEY, v); } catch { /* ignore */ }
}

/**
 * Transition effect used between slideshow slides. Only takes effect while
 * the slideshow is playing — manual prev/next stays instant so the user
 * navigating quickly isn't slowed down by a 600 ms fade.
 */
export type SlideshowTransition = 'none' | 'fade' | 'slide' | 'zoom' | 'ken-burns';
export const SLIDESHOW_TRANSITION_KEY = 'imagelab.slideshowTransition.v1';
const TRANSITIONS = new Set<SlideshowTransition>(['none', 'fade', 'slide', 'zoom', 'ken-burns']);

export function loadSlideshowTransition(): SlideshowTransition {
  try {
    const raw = localStorage.getItem(SLIDESHOW_TRANSITION_KEY) as SlideshowTransition | null;
    if (raw && TRANSITIONS.has(raw)) return raw;
  } catch { /* ignore */ }
  return 'fade';
}

export function saveSlideshowTransition(v: SlideshowTransition) {
  try { localStorage.setItem(SLIDESHOW_TRANSITION_KEY, v); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Venice AI — uncensored chat-completion API used by the Prompt Studio's
// "expand / improve / brainstorm" actions. Stored locally; never sent to the
// ComfyUI server or anywhere else.
// ---------------------------------------------------------------------------

/** Which prompt-style ruleset the AI helpers should target. `sdxl` is the
 *  generic comma-separated natural-language SDXL style; `illustrious` follows
 *  Arctenox's Illustrious / Danbooru guide (underscored tags, masterpiece +
 *  best quality opener, escaped parens, salient-first ordering). */
export type PromptStyle = 'sdxl' | 'illustrious';

export type VeniceSettings = {
  apiKey: string;
  /** Chat model id — see https://docs.venice.ai/. */
  model: string;
  /** Override the default base URL. Empty string = default. */
  baseUrl: string;
  /** Prompt-style ruleset applied to every AI helper. Defaults to `sdxl`. */
  promptStyle: PromptStyle;
};

export const VENICE_DEFAULT_MODEL = 'venice-uncensored';
export const VENICE_DEFAULT_BASE_URL = 'https://api.venice.ai/api/v1';

export function defaultVeniceSettings(): VeniceSettings {
  return { apiKey: '', model: VENICE_DEFAULT_MODEL, baseUrl: '', promptStyle: 'sdxl' };
}

export function loadVeniceSettings(): VeniceSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(VENICE_KEY) || 'null');
    if (raw && typeof raw === 'object') return { ...defaultVeniceSettings(), ...raw };
  } catch { /* ignore */ }
  return defaultVeniceSettings();
}

export function saveVeniceSettings(s: VeniceSettings) {
  try { localStorage.setItem(VENICE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// CivitAI browser-side credentials. The ImageLab extension's CIVITAI_TOKEN
// env var only authenticates downloads server-side; this token authenticates
// the browser's direct calls to civitai.com / civitai.red (catalog search,
// by-hash, by-id, /images). Required to see the top-tier adult catalog on
// civitai.red — unauthed requests get a filtered subset.
// ---------------------------------------------------------------------------

export type CivitaiSettings = {
  apiKey: string;
};

export function defaultCivitaiSettings(): CivitaiSettings {
  return { apiKey: '' };
}

export function loadCivitaiSettings(): CivitaiSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(CIVITAI_KEY) || 'null');
    if (raw && typeof raw === 'object') return { ...defaultCivitaiSettings(), ...raw };
  } catch { /* ignore */ }
  return defaultCivitaiSettings();
}

export function saveCivitaiSettings(s: CivitaiSettings) {
  try { localStorage.setItem(CIVITAI_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Persistence — all global keys now.
// ---------------------------------------------------------------------------

function normalizeLayer(l: Partial<Layer>): Layer {
  return {
    id: l.id || uid(),
    on: l.on !== false,
    kind: l.kind === 'negative' ? 'negative' : 'positive',
    tag: typeof l.tag === 'string' ? l.tag : '',
    text: typeof l.text === 'string' ? l.text : '',
    weight: Number.isFinite(l.weight) ? (l.weight as number) : 1.0,
    originSnippetId: typeof l.originSnippetId === 'string' ? l.originSnippetId : undefined,
  };
}

export function loadLayers(): Layer[] {
  try {
    const data = JSON.parse(localStorage.getItem(SHARED_PROMPT_KEY) || '{}');
    if (Array.isArray(data.layers) && data.layers.length) return data.layers.map(normalizeLayer);
  } catch { /* fall through */ }
  return defaultLayers();
}

export function saveLayers(layers: Layer[]) {
  try { localStorage.setItem(SHARED_PROMPT_KEY, JSON.stringify({ layers })); } catch { /* ignore */ }
}

function normalizeSnippet(s: Partial<Snippet>): Snippet {
  return {
    id: s.id || uid(),
    name: String(s.name || 'Untitled'),
    tag: String(s.tag || ''),
    text: String(s.text || ''),
    weight: Number.isFinite(s.weight) ? (s.weight as number) : 1.0,
    kind: s.kind === 'negative' ? 'negative' : 'positive',
    categoryId: typeof s.categoryId === 'string' && s.categoryId ? s.categoryId : DEFAULT_CATEGORY_ID,
  };
}

export function loadSnippets(): Snippet[] {
  // New (v3) key first.
  try {
    const arr = JSON.parse(localStorage.getItem(SNIPPETS_KEY) || 'null');
    if (Array.isArray(arr)) return arr.map(normalizeSnippet);
  } catch { /* fall through */ }

  // Migrate a v2 list once (drop into Uncategorized so nothing is lost).
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_SNIPPETS_V2_KEY) || 'null');
    if (Array.isArray(legacy) && legacy.length) {
      const migrated = legacy.map(normalizeSnippet);
      try { localStorage.setItem(SNIPPETS_KEY, JSON.stringify(migrated)); } catch { /* ignore */ }
      return migrated;
    }
  } catch { /* fall through */ }

  return defaultSnippets();
}

export function saveSnippets(arr: Snippet[]) {
  try { localStorage.setItem(SNIPPETS_KEY, JSON.stringify(arr)); } catch { /* ignore */ }
}

export function loadHistory(): HistoryEntry[] {
  try {
    const arr = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    if (!Array.isArray(arr)) return [];
    return arr.map((e: Partial<HistoryEntry> & { workspaceId?: string }): HistoryEntry => ({
      id: e.id || uid(),
      // Accept the legacy `workspaceId` field for entries written before the
      // rename so old history keeps its server attribution.
      serverId: typeof e.serverId === 'string' && e.serverId ? e.serverId
        : typeof e.workspaceId === 'string' ? e.workspaceId : '',
      filename: String(e.filename || ''),
      subfolder: String(e.subfolder || ''),
      type: String(e.type || 'output'),
      promptId: String(e.promptId || ''),
      positive: String(e.positive || ''),
      negative: String(e.negative || ''),
      seed: Math.trunc(Number(e.seed) || 0),
      model: String(e.model || ''),
      createdAt: Number(e.createdAt) || Date.now(),
      liked: Boolean(e.liked),
      // Optional snapshots — kept as-is so "recall" works on persisted entries.
      workflow: e.workflow && typeof e.workflow === 'object' ? (e.workflow as WorkflowState) : undefined,
      layers: Array.isArray(e.layers) ? (e.layers as Layer[]) : undefined,
      // Venice-generated AI metadata cache. Optional everywhere — only set
      // by user action in the Collections panel.
      tags: Array.isArray(e.tags) ? e.tags.map(String) : undefined,
      description: typeof e.description === 'string' ? e.description : undefined,
      aiPrompt: typeof e.aiPrompt === 'string' ? e.aiPrompt : undefined,
    }));
  } catch {
    return [];
  }
}

export function saveHistory(arr: HistoryEntry[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(arr)); } catch { /* ignore */ }
}

export function loadWorkflow(): WorkflowState {
  try {
    let raw = JSON.parse(localStorage.getItem(WORKFLOW_KEY) || 'null');
    // v6 → v7: Hi-Res Fix + Auto-Tag Refine fields removed, replaced by
    // passes[]. If no v7 entry exists, read the v6 row, build a Pass from
    // its hires* config (when enabled), and migrate over. The v6 key is
    // left in place — harmless cruft, doesn't disturb anything.
    if (!raw) {
      const legacy = JSON.parse(localStorage.getItem(LEGACY_WORKFLOW_KEY_V6) || 'null');
      if (legacy && typeof legacy === 'object') {
        const passes: WorkflowState['passes'] = [];
        if (legacy.hiresEnabled && Number(legacy.hiresScale) > 1) {
          passes.push({
            id: uid(),
            sampler: String(legacy.sampler || 'euler_ancestral'),
            scheduler: String(legacy.scheduler || 'normal'),
            steps: Number(legacy.hiresSteps) || 8,
            cfg: Number(legacy.cfg) || 8.6,
            seed: Number(legacy.seed) || 0,
            randomizeSeed: false,
            denoise: Number(legacy.hiresDenoise) || 0.5,
            scale: Number(legacy.hiresScale) || 1.5,
            maxEdge: 2048,
          });
        }
        // Drop hires*/tag* fields; everything else carries over.
        const {
          hiresEnabled: _h1, hiresScale: _h2, hiresDenoise: _h3, hiresSteps: _h4,
          autoTag: _t1, tagModel: _t2, tagThreshold: _t3, tagCharThreshold: _t4,
          tagReplaceUnderscore: _t5, tagTrailingComma: _t6, tagExcludeTags: _t7,
          ...rest
        } = legacy;
        void _h1; void _h2; void _h3; void _h4;
        void _t1; void _t2; void _t3; void _t4; void _t5; void _t6; void _t7;
        raw = { ...rest, passes };
      }
    }
    if (raw && typeof raw === 'object') {
      // Migrate the pre-merge single `model` string → a `checkpoints` list.
      if (typeof raw.model === 'string' && !Array.isArray(raw.checkpoints)) {
        raw.checkpoints = raw.model ? [{ id: uid(), name: raw.model, ratio: 0.5 }] : [];
        delete raw.model;
      }
      const merged: WorkflowState = { ...defaultWorkflow(), ...raw };
      if (!Array.isArray(merged.passes)) merged.passes = [];
      // Input image lives in its own localStorage key (heavy dataURL).
      merged.inputImage = loadInputImage();
      return merged;
    }
  } catch { /* fall through */ }
  return defaultWorkflow();
}

export function saveWorkflow(w: WorkflowState) {
  // Strip the heavy input-image dataURL out — persist it under its own key
  // (so unrelated workflow tweaks don't repeatedly re-serialize MBs).
  const { inputImage, ...rest } = w;
  try { localStorage.setItem(WORKFLOW_KEY, JSON.stringify(rest)); } catch { /* ignore */ }
  saveInputImage(inputImage);
}

function loadInputImage(): WorkflowState['inputImage'] {
  try {
    const raw = JSON.parse(localStorage.getItem(INPUT_IMAGE_KEY) || 'null');
    if (raw && typeof raw === 'object' && typeof raw.dataUrl === 'string') {
      return {
        dataUrl: raw.dataUrl,
        name: String(raw.name || 'input.png'),
        width: Number(raw.width) || 0,
        height: Number(raw.height) || 0,
      };
    }
  } catch { /* ignore */ }
  return null;
}

/** Reference-identity cache so unrelated workflow saves don't re-stringify
 *  multi-MB dataURLs. `saveWorkflow` runs on every workflow mutation. */
let _lastSavedInputImage: WorkflowState['inputImage'] | undefined;

function saveInputImage(img: WorkflowState['inputImage']) {
  if (img === _lastSavedInputImage) return;
  _lastSavedInputImage = img;
  try {
    if (img) localStorage.setItem(INPUT_IMAGE_KEY, JSON.stringify(img));
    else localStorage.removeItem(INPUT_IMAGE_KEY);
  } catch { /* ignore — typically a QuotaExceededError, just don't persist */ }
}

// ---------------------------------------------------------------------------
// Model-preview source — controls the order images are shown in the model
// picker's hover slideshow, and which one shows first.
//   - 'first'   : keep CivitAI's curated order (default).
//   - 'popular' : same as 'first' for now (per-image stats aren't returned by
//                 the by-hash endpoint we use), but kept distinct so the
//                 setting survives a future upgrade that does fetch them.
//   - 'random'  : shuffle on every hover.
//   - 'history' : seed the slideshow with the most recent local generation
//                 that used this model, if any, then play the CivitAI images.
// ---------------------------------------------------------------------------

export type ModelPreviewSource = 'first' | 'popular' | 'random' | 'history';

export const PREVIEW_SOURCES: Array<{ value: ModelPreviewSource; label: string; description: string }> = [
  { value: 'first',   label: 'First',        description: "CivitAI's curated order — same every time." },
  { value: 'popular', label: 'Most popular', description: 'Same as First today; reserved for when per-image stats arrive.' },
  { value: 'random',  label: 'Random',       description: 'Shuffle on every hover — a different image each time.' },
  { value: 'history', label: 'Local history',description: 'Show a local generation that used this model first, then CivitAI.' },
];

export function loadModelPreviewSource(): ModelPreviewSource {
  try {
    const v = localStorage.getItem(PREVIEW_SOURCE_KEY);
    if (v === 'first' || v === 'popular' || v === 'random' || v === 'history') return v;
  } catch { /* ignore */ }
  return 'first';
}

export function saveModelPreviewSource(src: ModelPreviewSource) {
  try { localStorage.setItem(PREVIEW_SOURCE_KEY, src); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Model-picker filter — the base-model bucket the user last selected, persisted
// per kind so the popover comes back the same way they left it. Stored as a
// flat `{ checkpoint, lora, vae }` map.
// ---------------------------------------------------------------------------

export type ModelPickerFilters = Record<string, string>;

export function loadModelPickerFilters(): ModelPickerFilters {
  try {
    const raw = JSON.parse(localStorage.getItem(MODEL_PICKER_FILTER_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      const out: ModelPickerFilters = {};
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'string' && v) out[k] = v;
      }
      return out;
    }
  } catch { /* ignore */ }
  return {};
}

export function saveModelPickerFilters(f: ModelPickerFilters) {
  try { localStorage.setItem(MODEL_PICKER_FILTER_KEY, JSON.stringify(f)); } catch { /* ignore */ }
}

/** Per-kind list of server IDs the user has narrowed the picker to. Empty
 *  array (or missing kind) = no server filter (show models from any server). */
export type ServerPickerFilters = Record<string, string[]>;

export function loadServerPickerFilters(): ServerPickerFilters {
  try {
    const raw = JSON.parse(localStorage.getItem(MODEL_PICKER_SERVERS_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      const out: ServerPickerFilters = {};
      for (const [k, v] of Object.entries(raw)) {
        if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === 'string');
      }
      return out;
    }
  } catch { /* ignore */ }
  return {};
}

export function saveServerPickerFilters(f: ServerPickerFilters) {
  try { localStorage.setItem(MODEL_PICKER_SERVERS_KEY, JSON.stringify(f)); } catch { /* ignore */ }
}

// ── Model browser filters — persist the in-app browser's filter chips. ──
export const BROWSER_FILTERS_KEY = 'imagelab.browserFilters.v1';

/** Loaded as an opaque JSON object — the browser store validates shape on
 *  read and falls back to its DEFAULT_FILTERS for any missing field. We
 *  intentionally don't pin a TS type here; the browser owns its schema. */
export function loadBrowserFilters<T = unknown>(): T | null {
  try {
    const raw = JSON.parse(localStorage.getItem(BROWSER_FILTERS_KEY) || 'null');
    return raw && typeof raw === 'object' ? (raw as T) : null;
  } catch { return null; }
}

export function saveBrowserFilters(f: unknown) {
  try { localStorage.setItem(BROWSER_FILTERS_KEY, JSON.stringify(f)); } catch { /* ignore */ }
}

/**
 * Auto-frame-on-complete. Defaults to true on a fresh install — the user has
 * to explicitly opt out for the canvas to leave a finished job's image alone.
 */
export function loadAutoFrameOnComplete(): boolean {
  try {
    const v = localStorage.getItem(AUTO_FRAME_KEY);
    if (v === 'false') return false;
    if (v === 'true') return true;
  } catch { /* ignore */ }
  return true;
}

export function saveAutoFrameOnComplete(on: boolean) {
  try { localStorage.setItem(AUTO_FRAME_KEY, on ? 'true' : 'false'); } catch { /* ignore */ }
}

/** Collections grid tile size — min px width per thumbnail. Clamped on read
 *  so a corrupted value doesn't make the grid render absurdly. */
export const COLLECTIONS_TILE_MIN = 120;
export const COLLECTIONS_TILE_MAX = 360;
export const COLLECTIONS_TILE_DEFAULT = 200;

export function loadCollectionsTileSize(): number {
  try {
    const v = Number(localStorage.getItem(COLLECTIONS_TILE_SIZE_KEY));
    if (Number.isFinite(v) && v >= COLLECTIONS_TILE_MIN && v <= COLLECTIONS_TILE_MAX) return v;
  } catch { /* ignore */ }
  return COLLECTIONS_TILE_DEFAULT;
}

export function saveCollectionsTileSize(px: number) {
  const clamped = Math.max(COLLECTIONS_TILE_MIN, Math.min(COLLECTIONS_TILE_MAX, Math.round(px)));
  try { localStorage.setItem(COLLECTIONS_TILE_SIZE_KEY, String(clamped)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Theme — palette + font + icon weight. Persists the user's active selection
// and any forked/custom themes they've authored.
// ---------------------------------------------------------------------------

import type { Theme } from './themes';
import { BUILT_IN_THEMES, DEFAULT_THEME_ID, ICON_STYLES } from './themes';

export type ThemeState = {
  activeId: string;
  customThemes: Theme[];
};

function isIconStyle(v: unknown): v is Theme['iconStyle'] {
  return typeof v === 'string' && ICON_STYLES.some(s => s.value === v);
}

function normalizeCustomTheme(raw: unknown): Theme | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Partial<Theme>;
  if (typeof t.id !== 'string' || !t.id) return null;
  if (typeof t.name !== 'string' || !t.name) return null;
  // Seed missing fields from the first built-in so an old/partial custom theme
  // still applies cleanly.
  const seed = BUILT_IN_THEMES[0];
  return {
    id: t.id,
    name: t.name,
    blurb: typeof t.blurb === 'string' ? t.blurb : 'Custom theme',
    builtIn: false,
    font: typeof t.font === 'string' && t.font ? t.font : seed.font,
    fontWeights: Array.isArray(t.fontWeights) && t.fontWeights.length
      ? t.fontWeights.filter((n): n is number => typeof n === 'number')
      : seed.fontWeights,
    fontGeneric:
      t.fontGeneric === 'serif' || t.fontGeneric === 'monospace' || t.fontGeneric === 'sans-serif'
        ? t.fontGeneric
        : seed.fontGeneric,
    iconStyle: isIconStyle(t.iconStyle) ? t.iconStyle : seed.iconStyle,
    colors: { ...seed.colors, ...(t.colors as Theme['colors'] | undefined) },
  };
}

export function loadThemeState(): ThemeState {
  try {
    const raw = JSON.parse(localStorage.getItem(THEME_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      const activeId = typeof raw.activeId === 'string' ? raw.activeId : DEFAULT_THEME_ID;
      const customThemes = Array.isArray(raw.customThemes)
        ? raw.customThemes.map(normalizeCustomTheme).filter((t: Theme | null): t is Theme => !!t)
        : [];
      return { activeId, customThemes };
    }
  } catch { /* ignore */ }
  return { activeId: DEFAULT_THEME_ID, customThemes: [] };
}

export function saveThemeState(s: ThemeState) {
  try { localStorage.setItem(THEME_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Collections — user-defined image groupings. Items inside a collection are
// referenced by id (HistoryEntry.id OR ImportedImage.id — same `uid()` space).
// Persisted lazily in their own key so the panel can mutate them without
// touching history/workflow serialization paths.
// ---------------------------------------------------------------------------

function normalizeCollection(c: Partial<Collection>): Collection {
  return {
    id: String(c.id || uid()),
    name: String(c.name || 'Untitled'),
    icon: typeof c.icon === 'string' && c.icon ? c.icon : undefined,
    color: typeof c.color === 'string' && c.color ? c.color : undefined,
    itemIds: Array.isArray(c.itemIds) ? c.itemIds.filter((v): v is string => typeof v === 'string') : [],
    createdAt: Number(c.createdAt) || Date.now(),
  };
}

export function loadCollections(): Collection[] {
  try {
    const arr = JSON.parse(localStorage.getItem(COLLECTIONS_KEY) || 'null');
    if (Array.isArray(arr)) return arr.map(normalizeCollection);
  } catch { /* ignore */ }
  return [];
}

export function saveCollections(arr: Collection[]) {
  try { localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(arr)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Imported image metadata — pairs with `importedDb.ts` (which holds the blob
// bytes in IndexedDB). Splitting the two means the panel can render its tile
// grid synchronously from this list, then resolve blob URLs on demand.
// ---------------------------------------------------------------------------

function normalizeImported(raw: Partial<ImportedImage>): ImportedImage {
  return {
    id: String(raw.id || uid()),
    name: String(raw.name || 'image'),
    mime: typeof raw.mime === 'string' && raw.mime ? raw.mime : 'image/png',
    width: Math.max(0, Math.trunc(Number(raw.width) || 0)),
    height: Math.max(0, Math.trunc(Number(raw.height) || 0)),
    bytes: Math.max(0, Math.trunc(Number(raw.bytes) || 0)),
    createdAt: Number(raw.createdAt) || Date.now(),
    liked: Boolean(raw.liked),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : undefined,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    aiPrompt: typeof raw.aiPrompt === 'string' ? raw.aiPrompt : undefined,
  };
}

export function loadImportedImages(): ImportedImage[] {
  try {
    const arr = JSON.parse(localStorage.getItem(IMPORTED_IMAGES_KEY) || 'null');
    if (Array.isArray(arr)) return arr.map(normalizeImported);
  } catch { /* ignore */ }
  return [];
}

export function saveImportedImages(arr: ImportedImage[]) {
  try { localStorage.setItem(IMPORTED_IMAGES_KEY, JSON.stringify(arr)); } catch { /* ignore */ }
}
