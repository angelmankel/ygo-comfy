export type LayerKind = 'positive' | 'negative';

export type Layer = {
  id: string;
  on: boolean;
  kind: LayerKind;
  tag: string;
  text: string;
  weight: number;
  /** Snippet this layer was inserted from. Lets the Snippet Library toggle
   *  removal of the matching layer without name-string heuristics. */
  originSnippetId?: string;
};

export type Snippet = {
  id: string;
  name: string;
  tag: string;
  text: string;
  weight: number;
  kind: LayerKind;
  /** Category id (see SnippetCategory). Defaults to 'uncategorized' for legacy. */
  categoryId: string;
};

/** Snippet library category — organizational only; users can add/rename/delete. */
export type SnippetCategory = {
  id: string;
  name: string;
  /** Emoji or short text shown next to the name. Optional flair, no semantics. */
  icon?: string;
};

export type HistoryEntry = {
  id: string;
  /** Which server this image was generated on — metadata, used by the
   *  History panel's per-server filter tabs. */
  serverId: string;
  filename: string;
  subfolder: string;
  type: string;
  promptId: string;
  positive: string;
  negative: string;
  seed: number;
  model: string;
  createdAt: number;
  liked?: boolean;
  /** Server-side favorite handle, set when the user stars this entry and the
   *  ComfyUI custom node copies the image into the persistent favorites tree.
   *  Format: `MM-DD-YYYY/filename` — same id the favorites endpoint returns. */
  favoriteId?: string;
  /** Full workflow snapshot captured at queue time — powers "recall". */
  workflow?: WorkflowState;
  /** Prompt layers snapshot captured at queue time — powers "recall". */
  layers?: Layer[];
  /** Canvas-layer this generation targeted (if any). Untargeted gens omit
   *  this. Used by the Layers panel + per-layer history filters to attribute
   *  the entry back to its originating layer. */
  layerId?: string;
  /** Venice-generated tag list — set by the Collections panel's tagger.
   *  Persisted so re-tagging is opt-in, not implicit on every open. */
  tags?: string[];
  /** Venice-generated natural-language description. */
  description?: string;
  /** Venice image-to-prompt result, ready to paste into the Layer system. */
  aiPrompt?: string;
};

/**
 * A user-imported image — uploaded, drag-dropped, or pasted into the
 * Collections panel. The image blob lives in IndexedDB (see `importedDb.ts`)
 * so binary data stays out of localStorage's ~5 MB ceiling; this metadata
 * record is small enough to keep alongside everything else in localStorage so
 * the panel can render thumbnails synchronously on first paint.
 */
export type ImportedImage = {
  id: string;
  /** Original file name — purely for display. */
  name: string;
  /** MIME type from the upload — drives the object-URL's content type. */
  mime: string;
  width: number;
  height: number;
  /** Blob size in bytes. */
  bytes: number;
  createdAt: number;
  liked?: boolean;
  /** Venice-generated tag list. */
  tags?: string[];
  /** Venice-generated natural-language description. */
  description?: string;
  /** Venice image-to-prompt result. */
  aiPrompt?: string;
};

/**
 * A user-defined image collection — a named, ordered group of items by id.
 * Items can be either HistoryEntry ids or ImportedImage ids (both come from
 * the same `uid()` namespace, so collisions don't matter in practice).
 */
export type Collection = {
  id: string;
  name: string;
  /** Emoji or short flair, like SnippetCategory.icon. Optional. */
  icon?: string;
  /** Optional accent color, hex (`#aabbcc`) — used for the rail chip. */
  color?: string;
  /** Ordered list of item ids in this collection. */
  itemIds: string[];
  createdAt: number;
};

export type JobStatus = 'queued' | 'running' | 'error';

/**
 * One queued/running generation. Persisted to IndexedDB so in-flight work
 * survives a page refresh; carries a full workflow + layers snapshot so the
 * result can be recalled even after a reload. Completed jobs are deleted — the
 * finished image lives in history instead.
 */
export type Job = {
  /** ComfyUI prompt id. */
  id: string;
  /** The server this job was queued on. */
  serverId: string;
  positive: string;
  negative: string;
  seed: number;
  model: string;
  workflow: WorkflowState;
  layers: Layer[];
  /** Canvas-layer this job targets. Set when generation was launched from a
   *  layer context; the completion handler stamps the result into this layer
   *  + writes a per-layer history entry. Untargeted jobs leave this unset. */
  targetLayerId?: string;
  /** Inpaint crop in result-image-relative pixel coords. When set, the
   *  completion handler crops the result image to this rect before stamping
   *  it onto the target layer — used by the from-canvas inpaint path where
   *  the result image is the wider context and only the masked region
   *  belongs on the layer. Coords are fractions [0..1] of result size so
   *  they survive the inpaint-resolution downscale that ComfyUI may apply. */
  resultCrop?: { fx: number; fy: number; fw: number; fh: number };
  /** Selection-tool scoped generation: result is composited into a
   *  layer-bounds-sized transparent canvas at the (offsetX, offsetY) before
   *  stamping into per-layer history. Coords are layer-local (i.e. relative
   *  to the target layer's bounds.x/.y). `w`/`h` match the generated image
   *  size — same as `workflow.width`/`workflow.height` for this job. */
  selectionRect?: { x: number; y: number; w: number; h: number; layerBoundsW: number; layerBoundsH: number };
  status: JobStatus;
  /** Sampler progress for the currently-running job. */
  progress?: { value: number; max: number };
  /** Label of the node currently executing. */
  node?: string;
  /** Total node count in the queued graph — captured at queue time so we can
   *  show "node 4 / 12" progress while the graph runs. */
  totalNodes?: number;
  /** Distinct nodes ComfyUI has reported as executing so far for this job. */
  executedNodes?: number;
  error?: string;
  createdAt: number;
};

/**
 * One checkpoint in the workflow. The first entry in `WorkflowState.checkpoints`
 * is the base — it provides the CLIP and VAE; any further entries blend their
 * UNet into the base via ModelMergeSimple, using `ratio`.
 */
export type WorkflowCheckpoint = {
  id: string;
  name: string;
  /** Merge blend ratio, 0..1. Ignored for the first (base) checkpoint. */
  ratio: number;
};

/** One LoRA applied on top of the checkpoint, in chain order. */
export type WorkflowLora = {
  id: string;
  /** LoRA file name as it appears in ComfyUI's models/loras folder. */
  name: string;
  strength: number;
  clipStrength: number;
  /** Bypassed LoRAs stay in the list but are skipped when building the graph. */
  on: boolean;
};

/**
 * An image dropped/pasted into the input-image slot. Stored on the client as
 * a data URL so we can re-upload it to any target server on demand. The
 * `width`/`height` reflect whatever the current edited state is — every edit
 * tool (crop, rotate, filters, Remove BG) replaces the dataUrl + dimensions
 * in place.
 */
export type InputImageState = {
  dataUrl: string;
  name: string;
  width: number;
  height: number;
};

/**
 * One additional sampling pass, chained after the base (Pass 1 = the
 * WorkflowState's top-level sampler/scheduler/steps/cfg/seed/denoise). Each
 * extra pass LatentUpscales the previous pass's samples by `scale` (clamped
 * so the result's long edge ≤ `maxEdge`) and resamples with its own params.
 * Replaces the old Hi-Res Fix; `WorkflowState.passes` is empty by default
 * (single-pass behaves exactly like before).
 */
export type Pass = {
  id: string;
  sampler: string;
  scheduler: string;
  steps: number;
  cfg: number;
  seed: number;
  /** Reroll this pass's seed at queue time. */
  randomizeSeed: boolean;
  denoise: number;
  /** Multiplier on the previous pass's latent dimensions. Clamped down so
   *  the resulting long edge ≤ maxEdge. */
  scale: number;
  /** Hard cap on this pass's output long edge in pixels. */
  maxEdge: number;
  /** When false, this pass is bypassed — buildGraph skips it as if it weren't
   *  in the list, and downstream passes flow from the previous active pass.
   *  Undefined = on (back-compat with passes persisted before the toggle). */
  on?: boolean;
};

export type WorkflowState = {
  /** Optional input image — when set, generation runs img2img instead of
   *  txt2img: LoadImage → VAEEncode → KSampler at `inputDenoise`. */
  inputImage: InputImageState | null;
  /** KSampler denoise applied when `inputImage` is set (0..1). The "raw"
   *  `denoise` field is preserved for txt2img runs. */
  inputDenoise: number;
  /** Longest-edge cap applied client-side before upload. Bounds the bytes we
   *  push over the wire and the latent size on the server. */
  inputMaxSize: number;
  /** Longest-edge floor applied client-side before upload. Tiny inputs get
   *  upscaled up to this so the latent has enough resolution to work with. */
  inputMinSize: number;
  /** Soft mask edge for from-canvas inpaint (pixels, 0..64). Maps to the
   *  InpaintCropImproved `mask_blend_pixels` — the stitch step uses this to
   *  fade the inpainted crop into the surrounding original. Higher = softer
   *  seam, more bleed into context. */
  inpaintFeather: number;
  /** Expand (dilate) the mask by N pixels before inpainting. 0 = use the
   *  mask as-painted. Higher values grow the masked region outward so the
   *  model has more room to blend at the edges. Maps to InpaintCropImproved
   *  `mask_expand_pixels`. Range 0..256. */
  inpaintMaskExpand: number;
  /** Which inpaint graph variant to build for from-canvas layers:
   *   - `auto` — pick by denoise (≥0.99 → destructive, else denoising)
   *   - `destructive` — `VAEEncodeForInpaint` (model creates from nothing in
   *     the masked area; denoise forced to 1.0)
   *   - `denoising` — `VAEEncode` + `SetLatentNoiseMask` (model varies the
   *     underlying pixels at `inputDenoise`) */
  inpaintVariant: 'auto' | 'destructive' | 'denoising';
  /** How far the inpaint crop expands beyond the mask, as a multiplier.
   *  1.0 = exactly the mask; 1.5 = 50% padding each side. Larger gives the
   *  model more surrounding context for blending, but if `inpaintTargetSize`
   *  is fixed, eats into the effective per-pixel resolution of the inpaint
   *  itself. Maps to InpaintCropImproved `context_from_mask_extend_factor`. */
  inpaintContextExtend: number;
  /** Sampling resolution for the cropped + resized region in pixels.
   *   - `'auto'` — use the crop's natural pixel size, rounded to 32px
   *     (latent-friendly). Good default; matches the captured context.
   *   - explicit number (e.g. 1024) — force a square N×N sampling.
   *     Cranking above the natural crop size = inpaint at higher
   *     resolution than the captured context (the "add detail to a
   *     small region" use case). */
  inpaintTargetSize: 'auto' | number;
  /** When true, the mask only covers the parts of the layer's bounds that
   *  AREN'T already covered by another visible layer. Useful when the layer
   *  is sitting on top of (and extending past) existing layers and the user
   *  wants the model to fill the new empty area while leaving the existing
   *  pixels alone. Default false (entire bounds inpainted). */
  inpaintInvertMask: boolean;
  /** When true, the inpaint graph adds a ControlNet conditioning step
   *  before KSampler. Biases the model toward the surrounding context for
   *  more coherent edits / outpainting. Off by default. */
  inpaintUseControlnet: boolean;
  /** ControlNet model filename (must be an inpaint CN compatible with the
   *  active checkpoint family). Picked from the server's
   *  `ServerInfo.controlnets` list. Empty string = none selected. */
  inpaintControlnet: string;
  /** Strength of the ControlNet conditioning (0..2). 1.0 is neutral. */
  inpaintControlnetStrength: number;
  seed: number;
  /** If true, the seed is replaced with a fresh random value just before each generation. */
  randomizeSeed: boolean;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  denoise: number;
  width: number;
  height: number;
  batch: number;
  /** Checkpoints — [0] is the base; entries 2+ are merged in via ModelMergeSimple. */
  checkpoints: WorkflowCheckpoint[];
  /** Explicit VAE file. '' = use the checkpoint's built-in VAE. */
  vae: string;
  /** LoRAs applied between the checkpoint and the sampler, in order. */
  loras: WorkflowLora[];
  /**
   * Extra sampling passes chained after the base pass. Empty array = single-
   * pass (legacy behavior). Each entry latent-upscales the previous output
   * and resamples with its own full parameter set. Replaces Hi-Res Fix.
   */
  passes: Pass[];
  upscaleEnabled: boolean;
  upscaleModel: string;
  removeBg: boolean;
};

export type ServerInfo = {
  samplers: string[];
  schedulers: string[];
  models: string[];
  vaes: string[];
  loras: string[];
  tagModels: string[];
  upscaleModels: string[];
  controlnets: string[];
};

export type StatusKind = '' | 'ok' | 'error' | 'busy';

export type Status = {
  text: string;
  kind: StatusKind;
};

// ── Canvas layer system (epic #18) ─────────────────────────────────────────
// Foundational types for the upcoming Pixi-based layered compositor canvas.
// These are persisted via `CanvasStorage` (see `canvasStorage.ts`); they're
// intentionally independent of `HistoryEntry` so deletes on either side don't
// cascade-corrupt the other.

/**
 * @deprecated Kept for backwards-compat reads of pre-#38 IDB rows. The
 * three-type model collapsed into one unified layer; new code should not
 * branch on this field. Hydration migration maps each value to the
 * appropriate attached/candidate state.
 */
export type CanvasLayerType = 'empty' | 'from-canvas' | 'from-image';

export type CanvasLayerBackground =
  | { kind: 'transparent' }
  | { kind: 'solid'; color: string }
  | { kind: 'image'; blobId: string };

export type CanvasLayer = {
  id: string;
  /**
   * @deprecated See {@link CanvasLayerType}. Hydration backfills this to
   * `'from-canvas'` for any row that lacks it, but readers should ignore
   * it — the type distinction is gone (#38).
   */
  type: CanvasLayerType;
  name: string;
  /** Bounds in world coordinates. */
  bounds: { x: number; y: number; w: number; h: number };
  zIndex: number;
  visible: boolean;
  locked: boolean;
  /** Cloned-on-create from the current default workflow. */
  workflow: WorkflowState;
  /** Per-canvas-layer prompt layers (#41/#43). Mirrors `useStore.layers`
   *  when this canvas layer is active; the scope-sync subscriber swaps
   *  them on activation. Persisted with the layer's IDB record so each
   *  canvas layer keeps its own positive/negative prompt across reloads. */
  layers: Layer[];
  selectedHistoryId?: string;
  background: CanvasLayerBackground;
  /**
   * How a generation targeted at this layer is executed.
   *   - `'inpaint'` (default) — capture the canvas composite + bounds mask
   *     and run through the inpaint pipeline. The source for the masked
   *     region is the layer's currently-selected history entry; context
   *     comes from other layers under the bounds. Result is cropped back
   *     to the layer bounds.
   *   - `'img2img'` — use the layer's currently-selected history entry as
   *     the img2img source. No mask, plain VAEEncode → KSampler at
   *     `inputDenoise`. The full result replaces the layer's pixels (a new
   *     history entry, advanced to selected).
   *   - `'txt2img'` — skip canvas capture entirely; queue a plain txt2img
   *     at the layer's bounds size.
   * Undefined → treat as `'inpaint'` for back-compat with layers persisted
   * before this field existed.
   */
  fillMode?: 'inpaint' | 'img2img' | 'txt2img';
  /** Parent folder id (a CanvasLayer with `isFolder: true`). Undefined =
   *  top-level. Folders nest only one level today — children of a folder
   *  must have a non-folder parent or no parent. */
  parentId?: string;
  /** Folder/group rows have no canvas geometry — they're rendered only in
   *  the layers panel and act as drop targets to organise siblings. */
  isFolder?: boolean;
  /** When true (folders only), the folder's children are hidden in the
   *  panel until the user clicks the disclosure. Default open. */
  folderCollapsed?: boolean;
  /** Optional brush-painted mask blob (per-layer). When present, inpaint
   *  flows use this in place of the default full-bounds mask. */
  paintedMaskBlobId?: string;
  createdAt: number;
};

export type LayerHistoryEntry = {
  id: string;
  layerId: string;
  /** Points at a blob stored via `CanvasStorage.putBlob`. */
  blobId: string;
  positive: string;
  negative: string;
  seed: number;
  model?: string;
  serverId: string;
  width: number;
  height: number;
  at: number;
};
