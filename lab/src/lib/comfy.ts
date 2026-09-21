import type { Layer, WorkflowState, ServerInfo, HistoryEntry } from './types';
import { compileLayers } from './prompt';
import { FALLBACKS, uid } from './storage';
import { resizeDataUrlForUpload, scaleForLongestEdge } from '@/features/inputImage/imageOps';

/**
 * REST + WebSocket client for ComfyUI.
 *
 * Every call is host-scoped — there's no longer a single "active" server, so
 * the caller passes which server's host to talk to. Over HTTPS we MUST use
 * https/wss (the browser blocks plain-HTTP requests as mixed content), so the
 * user is expected to expose each ComfyUI server on an https-capable hostname.
 */
const isSecure = () => typeof window !== 'undefined' && window.location.protocol === 'https:';

/** HTTP base URL for a given ComfyUI host. */
export function comfyHttpFor(host: string) {
  return `${isSecure() ? 'https' : 'http'}://${host}`;
}
/** WebSocket base URL for a given ComfyUI host. */
export function comfyWsFor(host: string) {
  return `${isSecure() ? 'wss' : 'ws'}://${host}/ws`;
}

/** Build a ComfyUI `/view` URL for an image on a specific server. */
export function viewUrl(
  entry: { filename: string; subfolder?: string; type?: string },
  host: string,
) {
  return `${comfyHttpFor(host)}/view?` + new URLSearchParams({
    filename: entry.filename,
    subfolder: entry.subfolder || '',
    type: entry.type || 'output',
  });
}

/**
 * Stable per-browser client id. Persisted to localStorage so that after a
 * page refresh the same id is sent on the new WebSocket connection —
 * ComfyUI routes binary preview frames (and the SaveImageWebsocket node) by
 * `client_id`, so a fresh id every reload silently breaks live preview
 * reconnection for any in-flight job.
 */
const CLIENT_ID_KEY = 'imagelab.clientId.v1';
function loadOrCreateClientId(): string {
  try {
    const saved = localStorage.getItem(CLIENT_ID_KEY);
    if (saved) return saved;
  } catch { /* ignore */ }
  const fresh =
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto && crypto.randomUUID()) ||
    (Math.random().toString(36).slice(2) + Date.now().toString(36));
  try { localStorage.setItem(CLIENT_ID_KEY, fresh); } catch { /* ignore */ }
  return fresh;
}
export const clientId = loadOrCreateClientId();

/**
 * POST an image to ComfyUI's `input/` folder. Returns the filename the
 * server stored it under, ready to use as a `LoadImage` input. Uploads to
 * `input/imagelab/<name>` so we don't clobber the user's own uploads.
 */
export type UploadedImage = { name: string; subfolder: string; type: string };

export async function uploadImage(
  host: string,
  blob: Blob,
  filename: string,
): Promise<UploadedImage> {
  const fd = new FormData();
  fd.append('image', blob, filename);
  fd.append('subfolder', 'imagelab');
  fd.append('overwrite', 'true');
  const res = await fetch(`${comfyHttpFor(host)}/upload/image`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`upload HTTP ${res.status}`);
  const json = await res.json();
  return {
    name: json.name as string,
    subfolder: (json.subfolder as string) || '',
    type: (json.type as string) || 'input',
  };
}

/** `LoadImage` expects "<subfolder>/<name>" when a subfolder is used. */
export function loadImageRef(up: UploadedImage): string {
  return up.subfolder ? `${up.subfolder}/${up.name}` : up.name;
}

export async function fetchServerInfo(host: string): Promise<ServerInfo> {
  const res = await fetch(`${comfyHttpFor(host)}/object_info`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const info = await res.json();
  // Combo inputs come in two shapes ComfyUI uses interchangeably:
  //   legacy: [[...options], {config?}]
  //   newer:  ['COMBO', {options: [...], ...}]
  const list = (spec: unknown): string[] | null => {
    if (!Array.isArray(spec)) return null;
    if (Array.isArray(spec[0])) return spec[0] as string[];
    const cfg = spec[1] as { options?: unknown } | undefined;
    if (cfg && Array.isArray(cfg.options)) return cfg.options as string[];
    return null;
  };
  const get = (cls: string, key: string) =>
    list(info[cls]?.input?.required?.[key]);
  return {
    samplers:      get('KSampler', 'sampler_name')              ?? FALLBACKS.samplers,
    schedulers:    get('KSampler', 'scheduler')                 ?? FALLBACKS.schedulers,
    models:        get('CheckpointLoaderSimple', 'ckpt_name')   ?? FALLBACKS.models,
    vaes:          get('VAELoader', 'vae_name')                 ?? FALLBACKS.vaes,
    loras:         get('LoraLoader', 'lora_name')               ?? FALLBACKS.loras,
    tagModels:     get('WD14Tagger|pysssss', 'model')           ?? FALLBACKS.tagModels,
    upscaleModels: get('UpscaleModelLoader', 'model_name')      ?? FALLBACKS.upscaleModels,
    controlnets:   get('ControlNetLoader', 'control_net_name')  ?? FALLBACKS.controlnets,
  };
}

/**
 * One entry from the ImageLab custom node's model-hash cache.
 * `key` is the model's path relative to ComfyUI's models dir.
 */
export interface ModelHash {
  key: string;
  filename: string;
  hash: string;
  hashed_at: number;
}

export interface ModelHashes {
  version: string;
  models: ModelHash[];
}

/**
 * Fetch the model-hash cache from the ImageLab custom node
 * (`GET /imagelab/hashes`) on a ComfyUI server.
 *
 * Pass the previous response's `version` as `knownVersion` — the endpoint
 * answers `304` when nothing has changed, in which case this returns `null`.
 */
export async function fetchModelHashes(host: string, knownVersion?: string): Promise<ModelHashes | null> {
  const res = await fetch(`${comfyHttpFor(host)}/imagelab/hashes`, {
    headers: knownVersion ? { 'If-None-Match': `"${knownVersion}"` } : {},
  });
  if (res.status === 304) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * One CivitAI download tracked by the ImageLab custom node. Mirrors the
 * node's `DownloadProgress.to_dict()`.
 */
export interface Download {
  version_id: number;
  model_id: number;
  folder: string;           // ComfyUI folder, e.g. "checkpoints" — "?" until resolved
  filename: string;
  downloaded_bytes: number;
  total_bytes: number;
  percent: number;
  status: 'downloading' | 'completed' | 'failed' | 'cancelled';
  error: string | null;
  started_at: number;
  updated_at: number;
}

/** Every download a server's node is tracking (active + finished). */
export async function fetchDownloads(host: string): Promise<Download[]> {
  const res = await fetch(`${comfyHttpFor(host)}/imagelab/downloads`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return body.downloads ?? [];
}

/**
 * Start a CivitAI download on a server. `folder` is a ComfyUI folder name;
 * omit it to let the node derive it from CivitAI's model type. Resolves once
 * the download is *queued* — poll `fetchDownloads` for progress.
 */
export async function startDownload(
  host: string,
  versionId: number,
  folder?: string,
  filename?: string,
): Promise<void> {
  const res = await fetch(`${comfyHttpFor(host)}/imagelab/downloads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version_id: versionId, folder, filename }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
}

/** Cancel an in-flight download, or dismiss a finished/failed row. */
export async function cancelDownload(host: string, versionId: number): Promise<void> {
  const res = await fetch(`${comfyHttpFor(host)}/imagelab/downloads/${versionId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** Delete a local model file (and drop it from the node's hash index). */
export async function deleteModel(host: string, folder: string, filename: string): Promise<void> {
  const path = filename.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(
    `${comfyHttpFor(host)}/imagelab/models/${encodeURIComponent(folder)}/${path}`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
}

/**
 * Build the ComfyUI prompt graph.
 *
 * Returns the graph plus any per-pass clamp notes (e.g. "Pass 2 capped to
 * 2048 → effective ×1.60") so the queuer can surface them in the status pill.
 */
/** Inpaint-mode hookup for `buildGraph`. The input image is the captured
 *  canvas context (typically wider than the target region) and the mask
 *  scopes the change to the white area. We use `InpaintCropImproved` to
 *  auto-crop the context around the mask + resize to a target sampling
 *  resolution, then `InpaintStitchImproved` to seam-blend the inpainted
 *  crop back into the untouched original — this bypasses VAE encode/decode
 *  on the unmasked region entirely (fixes wash-out).
 *
 *  The variant decides how the masked area inside the crop is fed into the
 *  latent:
 *   - `destructive`  → `VAEEncodeForInpaint` (mid-grey fill in mask before
 *     encoding; denoise forced to 1.0). Use for "create from nothing".
 *   - `denoising`    → `VAEEncode` + `SetLatentNoiseMask` (encodes the actual
 *     pixels in the mask; KSampler denoises only inside). Use for "vary the
 *     underlying pixels at `inputDenoise`". */
export type InpaintConfig = {
  maskRef: string;
  variant: 'destructive' | 'denoising';
  /** Soft blend at the mask edge, in pixels (0..64). Maps to InpaintCrop's
   *  `mask_blend_pixels`; the stitch step uses this to seamlessly fade the
   *  inpainted crop into the original. */
  blendPx: number;
  /** Dilate the mask by N pixels before inpainting. Maps to
   *  InpaintCropImproved `mask_expand_pixels`. 0 = mask as-painted. */
  maskExpand: number;
  /** Optional ControlNet conditioning. When `model` is set + non-empty,
   *  the graph inserts ControlNetLoader → InpaintPreprocessor →
   *  ControlNetApplyAdvanced before KSampler so the sampler is biased by
   *  an inpaint CN (better seam coherence + outpainting). Requires the
   *  controlnet_aux custom node on the server. */
  controlnet: { model: string; strength: number } | null;
  /** How far to expand the crop region beyond the mask bbox. 1.0 = exactly
   *  the mask; 1.5 = 50% padding each side; etc. Larger gives the model
   *  more surrounding context to blend into, but eats into the effective
   *  inpaint resolution if `targetSize` is fixed. */
  contextExtend: number;
  /** Sampling resolution for the cropped+resized region.
   *   - `'auto'` → use the crop's natural pixel size, rounded up to a 32px
   *     multiple (latent-friendly). Lets the crop choose its own resolution.
   *   - explicit number → force a square `N×N` sampling. Cranking this above
   *     the natural crop size = inpaint at higher resolution than the
   *     captured context (the "add detail to a small region" use case). */
  targetSize: 'auto' | number;
  /** True when the captured mask was inverted (cuts out neighbour overlaps
   *  so only the non-overlap area gets inpainted). Used to crank the
   *  context_from_mask_extend_factor floor so the model sees enough of the
   *  preserved neighbour pixels to extend their style instead of generating
   *  unrelated fresh content. */
  invertMask: boolean;
};

export type BuildGraphResult = {
  graph: Record<string, unknown>;
  /** Human-readable lines for each pass whose scale was clamped down to
   *  honor `maxEdge`. Empty array when nothing was clamped. */
  clampNotes: string[];
};

export function buildGraph(
  workflow: WorkflowState,
  layers: Layer[],
  inputImageRef: string | null = null,
  inpaint: InpaintConfig | null = null,
): BuildGraphResult {
  // Seeds can be up to 0xFFFFFFFF (4.29e9), which overflows the signed 32-bit
  // range that `| 0` truncates to — ComfyUI then rejects the resulting negative
  // value. Use Math.trunc to keep the full unsigned range intact.
  const seed   = Math.trunc(Number(workflow.seed) || 0);
  const cfg    = Number(workflow.cfg);
  const baseW  = Number(workflow.width)  | 0;
  const baseH  = Number(workflow.height) | 0;

  const positive = compileLayers(layers, 'positive');
  const negative = compileLayers(layers, 'negative');

  const graph: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {
    "3": { class_type: "KSampler", inputs: {
      seed,
      steps: Number(workflow.steps) | 0,
      cfg,
      sampler_name: workflow.sampler,
      scheduler: workflow.scheduler,
      denoise: Number(workflow.denoise),
      model: ["4", 0],
      positive: ["6", 0],
      negative: ["7", 0],
      latent_image: ["5", 0],
    }},
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: workflow.checkpoints[0]?.name ?? '' }},
    "5": { class_type: "EmptyLatentImage", inputs: {
      width: baseW,
      height: baseH,
      batch_size: Number(workflow.batch) | 0,
    }},
    "6": { class_type: "CLIPTextEncode", inputs: { text: positive, clip: ["4", 1] }},
    "7": { class_type: "CLIPTextEncode", inputs: { text: negative, clip: ["4", 1] }},
  };

  // Checkpoint merge — checkpoints beyond the base (node "4") blend their UNet
  // into the base via ModelMergeSimple. CLIP + VAE always come from the base.
  let modelRef: [string, number] = ["4", 0];
  let clipRef: [string, number] = ["4", 1];
  workflow.checkpoints.slice(1).forEach((ckpt, i) => {
    if (!ckpt.name) return;
    graph[`m${i}`] = { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: ckpt.name }};
    graph[`mm${i}`] = { class_type: "ModelMergeSimple", inputs: {
      model1: modelRef,
      model2: [`m${i}`, 0],
      ratio: Number(ckpt.ratio),
    }};
    modelRef = [`mm${i}`, 0];
  });

  // LoRA chain — each enabled LoRA threads model + clip through a LoraLoader,
  // so the sampler and CLIP encoders read from the end of the chain instead of
  // straight off the checkpoint. Bypassed / unnamed LoRAs are skipped.
  (workflow.loras ?? []).forEach((lora, i) => {
    if (!lora.on || !lora.name) return;
    const id = `l${i}`;
    graph[id] = { class_type: "LoraLoader", inputs: {
      lora_name: lora.name,
      strength_model: Number(lora.strength),
      strength_clip: Number(lora.clipStrength),
      model: modelRef,
      clip: clipRef,
    }};
    modelRef = [id, 0];
    clipRef = [id, 1];
  });
  graph["3"].inputs.model = modelRef;
  graph["6"].inputs.clip = clipRef;
  graph["7"].inputs.clip = clipRef;

  // VAE: an explicit VAELoader when one is chosen, otherwise the checkpoint's
  // built-in VAE ([4, 2]).
  let vaeRef: [string, number] = ["4", 2];
  if (workflow.vae) {
    graph["4v"] = { class_type: "VAELoader", inputs: { vae_name: workflow.vae }};
    vaeRef = ["4v", 0];
  }

  // img2img / inpaint: when an uploaded input image is supplied, encode it
  // into a latent and feed that into the base sampler instead of the empty
  // latent.
  //
  //  - No mask (plain img2img): VAEEncode → KSampler at `inputDenoise`.
  //
  //  - With mask (from-canvas inpaint): InpaintCropImproved auto-crops the
  //    context around the mask, resizes to the target sampling resolution,
  //    and returns a `stitcher` opaque object that the matching
  //    InpaintStitchImproved uses to seam-blend the inpainted crop back
  //    into the *untouched* original. Crucially this means the unmasked
  //    region NEVER goes through VAE encode/decode — it stays pixel-perfect
  //    — which fixes the round-trip wash-out that plagued the previous
  //    implementation. Inside the crop, the variant decides how the masked
  //    pixels are primed for KSampler (mid-grey fill via VAEEncodeForInpaint
  //    for the "create from nothing" case, vs. actual pixels via
  //    SetLatentNoiseMask for the "vary the underlying pixels" case).
  if (inputImageRef) {
    graph["i0"] = { class_type: "LoadImage", inputs: { image: inputImageRef }};

    if (inpaint) {
      graph["iM"] = { class_type: "LoadImageMask", inputs: {
        image: inpaint.maskRef,
        channel: "red",
      }};

      // Server-side mask feather. The mask comes in as a hard binary; we
      // soften its alpha here so the SAME soft mask drives both the
      // KSampler latent noise scope and the InpaintStitch alpha blend.
      // Pipeline: mask → MaskToImage → ImageBlur → ImageToMask. Skipped
      // when feather is 0 — the hard mask wires straight into iCrop.
      // ComfyUI's built-in ImageBlur clamps blur_radius to 1..31 (it's the
      // gaussian kernel half-size) and sigma to 0.1..10.0. We clamp to the
      // node's range so the prompt validates — exceeding either fails
      // validation outright. The slider UI cap matches this.
      const featherPx = Math.max(0, Math.min(31, Math.round(inpaint.blendPx)));
      let maskRef: [string, number] = ["iM", 0];
      if (featherPx > 0) {
        graph["iMI"] = { class_type: "MaskToImage", inputs: { mask: ["iM", 0] }};
        graph["iMB"] = { class_type: "ImageBlur", inputs: {
          image: ["iMI", 0],
          blur_radius: featherPx,
          // Half the radius is a tasteful gaussian curve (≈ photoshop's
          // "feather selection"). Clamped to the node's 0.1..10.0 range.
          sigma: Math.max(0.1, Math.min(10.0, featherPx / 2)),
        }};
        graph["iM2"] = { class_type: "ImageToMask", inputs: {
          image: ["iMB", 0],
          channel: "red",
        }};
        maskRef = ["iM2", 0];
      }
      // 'auto' used to mean "let InpaintCropImproved pick its own size
      // (= the natural cropped resolution)". That's fine for huge masks
      // but disastrous for small ones — the sampler would run at, say,
      // 200×200 and produce noise. Always resize to a model-friendly
      // resolution. 1024² is the sweet spot for SDXL-class checkpoints
      // and still works well for SD1.5; users wanting finer control pick
      // an explicit number from the dropdown.
      const targetSize = inpaint.targetSize === 'auto'
        ? 1024
        : Math.max(64, Math.round(inpaint.targetSize as number));

      graph["iCrop"] = { class_type: "InpaintCropImproved", inputs: {
        image: ["i0", 0],
        mask: maskRef,
        downscale_algorithm: "bilinear",
        upscale_algorithm: "bicubic",
        preresize: false,
        preresize_mode: "ensure minimum resolution",
        preresize_min_width: 1024,
        preresize_min_height: 1024,
        preresize_max_width: 16384,
        preresize_max_height: 16384,
        // Hole-fill closes black islands inside white mask regions. That's
        // useful for free-hand masks where the user accidentally leaves
        // gaps, but it'd undo the neighbour cutouts our invert-mask path
        // adds — the preserved neighbour rect is exactly the kind of
        // "enclosed black region" hole-fill targets. Off when inverted.
        mask_fill_holes: !inpaint.invertMask,
        mask_expand_pixels: Math.max(0, Math.min(256, Math.round(inpaint.maskExpand))),
        mask_invert: false,
        // Stitch-side blend stays at 0 — the feather is already baked into
        // the mask alpha by the MaskToImage→ImageBlur→ImageToMask chain
        // above. Any non-zero value here would compound the blur and
        // over-smudge the edge.
        mask_blend_pixels: 0,
        // Hipass filter trims low-alpha noise from the mask. With our
        // client-side feathered masks (gaussian blur baked into the alpha)
        // this would threshold the soft edge back to hard, defeating the
        // feather. Both our painted-mask and bounds-mask paths produce
        // clean masks already, so we can safely disable it.
        mask_hipass_filter: 0,
        extend_for_outpainting: false,
        extend_up_factor: 1.0,
        extend_down_factor: 1.0,
        extend_left_factor: 1.0,
        extend_right_factor: 1.0,
        // When the user asked for invert-mask (extend-into-empty-area), the
        // mask is the new region and the only signal of the image's style /
        // colour the model sees is the surrounding crop — so we floor the
        // context expansion at 3.0 to make sure enough of the existing
        // neighbour pixels land inside the crop window. Without that floor,
        // a 1.5× crop around a half-bounds mask barely includes any of the
        // image being extended and the model just generates fresh content
        // from the prompt instead of matching style.
        context_from_mask_extend_factor: inpaint.invertMask
          ? Math.max(3.0, Number(inpaint.contextExtend) || 3.0)
          : Math.max(1.0, Number(inpaint.contextExtend) || 1.5),
        output_resize_to_target_size: true,
        output_target_width: targetSize,
        output_target_height: targetSize,
        // When letting the crop pick its own size, round to 32px (latent-friendly).
        output_padding: "32",
        device_mode: "gpu (much faster)",
      }};
      const croppedImage: [string, number] = ["iCrop", 1];
      const croppedMask:  [string, number] = ["iCrop", 2];

      // ControlNet inpaint bias — when configured, route positive/negative
      // through ControlNetApplyAdvanced fed by InpaintPreprocessor(image,
      // mask). The sampler then samples under the CN's structural
      // guidance, which typically tightens edge coherence and improves
      // outpainting. Requires the `controlnet_aux` custom node on the
      // server for InpaintPreprocessor. Falls back gracefully — if the
      // user toggles this on without picking a model, we skip the chain.
      if (inpaint.controlnet && inpaint.controlnet.model) {
        graph["cnL"] = { class_type: "ControlNetLoader", inputs: {
          control_net_name: inpaint.controlnet.model,
        }};
        // xinsir's ControlNet Union (and other multi-purpose CNs) ship a
        // single set of weights covering many control modes. Without an
        // explicit type, the model picks one heuristically — usually NOT
        // the one you want. Detect "union" / "promax" in the filename and
        // insert SetUnionControlNetType(inpaint) so the model knows what
        // it's being asked to do.
        let cnRef: [string, number] = ["cnL", 0];
        const fname = inpaint.controlnet.model.toLowerCase();
        if (fname.includes('union') || fname.includes('promax')) {
          graph["cnT"] = { class_type: "SetUnionControlNetType", inputs: {
            control_net: ["cnL", 0],
            // ControlNet Union calls its inpaint mode "repaint" in the
            // enum — not "inpaint". Anything else trips a validation
            // error like: "Value not in list: type".
            type: "repaint",
          }};
          cnRef = ["cnT", 0];
        }
        graph["cnP"] = { class_type: "InpaintPreprocessor", inputs: {
          image: croppedImage,
          mask: croppedMask,
        }};
        graph["cnA"] = { class_type: "ControlNetApplyAdvanced", inputs: {
          positive: ["6", 0],
          negative: ["7", 0],
          control_net: cnRef,
          image: ["cnP", 0],
          strength: Math.max(0, Math.min(2, inpaint.controlnet.strength)),
          start_percent: 0.0,
          end_percent: 1.0,
        }};
        graph["3"].inputs.positive = ["cnA", 0];
        graph["3"].inputs.negative = ["cnA", 1];
      }

      // ControlNet inpaint can't share a graph with VAEEncodeForInpaint —
      // the mid-grey fill + denoise=1.0 + CN conditioning destabilise the
      // sampler and it outputs pure noise on decode (the cyan-speckle
      // symptom). When CN is active we always route through the noise-
      // mask path with the user's `inputDenoise`, regardless of variant.
      const cnActive = !!(inpaint.controlnet && inpaint.controlnet.model);
      if (inpaint.variant === 'destructive' && !cnActive) {
        // Mid-grey fill in mask area before encoding → model creates from
        // nothing using cropped surroundings as context. Denoise forced to
        // 1.0 because this node only makes sense with full noise.
        graph["i1"] = { class_type: "VAEEncodeForInpaint", inputs: {
          pixels: croppedImage,
          vae: vaeRef,
          mask: croppedMask,
          grow_mask_by: 0,
        }};
        graph["3"].inputs.latent_image = ["i1", 0];
        graph["3"].inputs.denoise = 1.0;
      } else {
        // Encode the cropped image normally, attach the cropped mask as a
        // noise mask on the latent. KSampler only adds noise / denoises
        // inside the mask, varying the underlying pixels at `inputDenoise`.
        graph["i1"] = { class_type: "VAEEncode", inputs: { pixels: croppedImage, vae: vaeRef }};
        graph["iN"] = { class_type: "SetLatentNoiseMask", inputs: {
          samples: ["i1", 0],
          mask: croppedMask,
        }};
        graph["3"].inputs.latent_image = ["iN", 0];
        graph["3"].inputs.denoise = Number(workflow.inputDenoise);
      }
    } else {
      // Plain img2img — no mask, denoise the whole frame.
      graph["i1"] = { class_type: "VAEEncode", inputs: { pixels: ["i0", 0], vae: vaeRef }};
      graph["3"].inputs.latent_image = ["i1", 0];
      graph["3"].inputs.denoise = Number(workflow.inputDenoise);
    }

    // The empty latent is no longer wired up; drop it to keep the graph tidy.
    delete graph["5"];
  }

  // Multi-pass chain. Each entry in `workflow.passes` adds a
  // LatentUpscaleBy + KSampler on top of the previous pass's latent. The
  // first item in this chain reads from the base sampler ("3"); each
  // subsequent item reads from the previous pass's KSampler. Each pass's
  // `scale` is clamped down so the resulting long edge ≤ `maxEdge`.
  //
  // Best-effort starting dims (so we can compute the clamp client-side):
  //   - inpaint with explicit targetSize → that size, square
  //   - inpaint auto                    → workflow.width × .height (fallback)
  //   - img2img                         → input image scaled by scaleForLongestEdge
  //   - else                            → workflow.width × .height
  let curW = baseW;
  let curH = baseH;
  if (inpaint) {
    if (inpaint.targetSize !== 'auto') {
      const t = Math.max(64, Math.round(inpaint.targetSize as number));
      curW = t; curH = t;
    }
  } else if (inputImageRef && workflow.inputImage) {
    const { width, height } = workflow.inputImage;
    const s = scaleForLongestEdge(width, height, workflow.inputMaxSize, workflow.inputMinSize);
    curW = Math.max(8, Math.round(width * s));
    curH = Math.max(8, Math.round(height * s));
  }

  let finalSamples: [string, number] = ["3", 0];
  const clampNotes: string[] = [];
  workflow.passes.forEach((pass, idx) => {
    // Bypassed passes are skipped entirely; the next active pass reads from
    // whatever `finalSamples` points at (i.e. the previous active pass, or
    // the base sampler when no prior pass was active).
    if (pass.on === false) return;
    const requested = Math.max(0.1, Number(pass.scale) || 1);
    const cap = Math.max(64, Number(pass.maxEdge) || 2048);
    const longEdge = Math.max(curW, curH);
    const maxByCap = cap / longEdge;
    let effective = requested;
    if (effective > maxByCap) {
      effective = maxByCap;
      // Pass 1 here is workflow.passes[0] in user terms (the first EXTRA
      // pass is "Pass 2" since the base pass is implicit Pass 1).
      clampNotes.push(
        `Pass ${idx + 2} capped to ${cap}px → effective ×${effective.toFixed(2)}`,
      );
    }
    if (effective <= 1.001) return; // nothing to do — would just resample at same dims
    curW = Math.round(curW * effective);
    curH = Math.round(curH * effective);

    const upId = `pU${idx}`;
    const kId  = `pK${idx}`;
    graph[upId] = { class_type: "LatentUpscaleBy", inputs: {
      samples: finalSamples,
      upscale_method: "nearest-exact",
      scale_by: effective,
    }};
    const passSeed = pass.randomizeSeed
      ? Math.trunc(Math.random() * 0xFFFFFFFF)
      : Math.trunc(Number(pass.seed) || 0);
    graph[kId] = { class_type: "KSampler", inputs: {
      seed: passSeed,
      steps: Math.max(1, Number(pass.steps) | 0),
      cfg: Number(pass.cfg),
      sampler_name: pass.sampler || workflow.sampler,
      scheduler: pass.scheduler || workflow.scheduler,
      denoise: Number(pass.denoise),
      model: modelRef,
      positive: ["6", 0],
      negative: ["7", 0],
      latent_image: [upId, 0],
    }};
    finalSamples = [kId, 0];
  });

  graph["8"] = { class_type: "VAEDecode", inputs: { samples: finalSamples, vae: vaeRef }};

  // Post-processing chain: each step optionally inserts a node and threads its
  // output forward. The image is SAVED at its native resolution — the canvas
  // size is a non-destructive display setting applied in InfiniteCanvas at
  // render time, not baked into the graph.
  let img: [string, number] = ["8", 0];

  // Inpaint stitch: take the inpainted crop and seam-blend it back into the
  // untouched original via the stitcher object that InpaintCropImproved set
  // up. The output is the full-size original image with the inpainted region
  // pasted in — unmasked pixels stay pixel-perfect (no VAE round-trip), the
  // edge blends per InpaintCrop's `mask_blend_pixels`.
  //
  // Skipped when extra passes are configured: a later pass's latent is at a
  // different resolution than the crop the stitcher expects to receive.
  // Multi-pass + inpaint stitching is a follow-up — wire each pass's
  // LatentUpscaleBy / KSampler at the intermediate stage before
  // InpaintStitchImproved.
  if (inpaint && workflow.passes.length === 0) {
    graph["iStitch"] = { class_type: "InpaintStitchImproved", inputs: {
      stitcher: ["iCrop", 0],
      inpainted_image: img,
    }};
    img = ["iStitch", 0];
  }

  if (workflow.upscaleEnabled && workflow.upscaleModel) {
    graph["10a"] = { class_type: "UpscaleModelLoader", inputs: { model_name: workflow.upscaleModel }};
    graph["10"] = { class_type: "ImageUpscaleWithModel", inputs: {
      upscale_model: ["10a", 0],
      image: img,
    }};
    img = ["10", 0];
  }

  if (workflow.removeBg) {
    graph["11a"] = { class_type: "BRIA_RMBG_ModelLoader_Zho", inputs: {} };
    graph["11"] = { class_type: "BRIA_RMBG_Zho", inputs: {
      rmbgmodel: ["11a", 0],
      image: img,
    }};
    img = ["11", 0];
  }

  // PreviewImage drops the result into ComfyUI's `temp/` folder instead of
  // `output/`. ComfyUI wipes `temp/` on next startup, so unfavorited generations
  // self-clean. Explicit favorites are copied into the imagelab_favorites tree
  // by /imagelab/favorites and survive restarts. See `lib/favorites.ts`.
  graph["9"] = { class_type: "PreviewImage", inputs: { images: img }};
  return { graph, clampNotes };
}

export type QueueResult =
  | { ok: true; promptId: string; positive: string; negative: string; nodeCount: number; clampNotes: string[] }
  | { ok: false; error: string };

/**
 * Resize the workflow's input image client-side and upload it to a single
 * server's input/ folder. Returns the `LoadImage` ref the graph should use
 * for that server, or null when the workflow has no input image.
 *
 * Split out from `queuePrompt` so callers driving non-generation graphs
 * (the image-tool runner) can upload once and reuse the ref; under
 * round-robin generation `queuePrompt` still uploads per-server because
 * each ComfyUI box has its own input/ namespace.
 */
export async function uploadInputImage(host: string, workflow: WorkflowState): Promise<string | null> {
  if (!workflow.inputImage) return null;
  const blob = await resizeDataUrlForUpload(workflow.inputImage.dataUrl, workflow.inputMaxSize, workflow.inputMinSize);
  const up = await uploadImage(host, blob, workflow.inputImage.name);
  return loadImageRef(up);
}

/** Inpaint source supplied by the from-canvas capture path. The composite
 *  blob is the wider context image (replaces `workflow.inputImage` for this
 *  one queue) and the mask blob is the same-size mask the graph will use. */
export type InpaintSource = {
  composite: Blob;
  mask: Blob;
  variant: 'destructive' | 'denoising';
  /** See `InpaintConfig.blendPx`. */
  blendPx: number;
  /** See `InpaintConfig.maskExpand`. */
  maskExpand: number;
  /** See `InpaintConfig.controlnet`. */
  controlnet: { model: string; strength: number } | null;
  /** See `InpaintConfig.contextExtend`. */
  contextExtend: number;
  /** See `InpaintConfig.targetSize`. */
  targetSize: 'auto' | number;
  /** See `InpaintConfig.invertMask`. */
  invertMask: boolean;
  /** Filenames used when uploading to ComfyUI's input/ folder. */
  baseName: string;
};

export async function queuePrompt(
  host: string,
  workflow: WorkflowState,
  layers: Layer[],
  /** Pre-uploaded input-image ref from `uploadInputImage(host, workflow)`.
   *  When omitted, queuePrompt uploads itself (the common path). Pass it to
   *  skip a redundant re-encode/upload when you already have one. */
  preUploadedRef?: string | null,
  /** Inpaint source from the canvas capture. When set, both composite and
   *  mask are uploaded fresh per server and `workflow.inputImage` is
   *  ignored — the composite becomes the input image, the mask scopes the
   *  change to the target layer's area. */
  inpaintSource?: InpaintSource | null,
): Promise<QueueResult> {
  if (!workflow.checkpoints[0]?.name) return { ok: false, error: 'Pick a checkpoint first' };
  const positive = compileLayers(layers, 'positive');
  const negative = compileLayers(layers, 'negative');

  let inputImageRef: string | null = preUploadedRef ?? null;
  let inpaintConfig: InpaintConfig | null = null;

  if (inpaintSource) {
    // Inpaint path: upload composite + mask, ignore workflow.inputImage.
    try {
      const compUp = await uploadImage(host, inpaintSource.composite, `${inpaintSource.baseName}-ctx.png`);
      const maskUp = await uploadImage(host, inpaintSource.mask, `${inpaintSource.baseName}-mask.png`);
      inputImageRef = loadImageRef(compUp);
      inpaintConfig = {
        maskRef: loadImageRef(maskUp),
        variant: inpaintSource.variant,
        blendPx: inpaintSource.blendPx,
        maskExpand: inpaintSource.maskExpand,
        controlnet: inpaintSource.controlnet,
        contextExtend: inpaintSource.contextExtend,
        targetSize: inpaintSource.targetSize,
        invertMask: inpaintSource.invertMask,
      };
    } catch (err) {
      return { ok: false, error: `Inpaint upload failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  } else if (!inputImageRef && workflow.inputImage) {
    try {
      inputImageRef = await uploadInputImage(host, workflow);
    } catch (err) {
      return { ok: false, error: `Input image upload failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  try {
    const built = buildGraph(workflow, layers, inputImageRef, inpaintConfig);
    const { graph, clampNotes } = built;
    const res = await fetch(`${comfyHttpFor(host)}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: graph, client_id: clientId }),
    });
    const json = await res.json();
    if (json.error) {
      return { ok: false, error: json.error.message || JSON.stringify(json.error) };
    }
    if (json.prompt_id) {
      return { ok: true, promptId: json.prompt_id, positive, negative, nodeCount: Object.keys(graph).length, clampNotes };
    }
    return { ok: false, error: 'Queue rejected' };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchPromptResult(
  host: string,
  promptId: string,
  meta: {
    positive: string;
    negative: string;
    seed: number;
    model: string;
    /** Optional snapshots — when present they ride along into the history entry. */
    workflow?: WorkflowState;
    layers?: Layer[];
  },
): Promise<{ url: string; entry: HistoryEntry } | { error: string }> {
  try {
    const res = await fetch(`${comfyHttpFor(host)}/history/${promptId}`);
    const hist = await res.json();
    const entry = hist[promptId];
    if (!entry) return { error: 'No history for prompt' };
    for (const out of Object.values(entry.outputs || {}) as Array<{ images?: Array<{ filename: string; subfolder?: string; type?: string }> }>) {
      if (out.images && out.images.length) {
        const img = out.images[0];
        const url = viewUrl(img, host);
        const historyEntry: HistoryEntry = {
          id: uid(),
          serverId: '', // stamped by the caller with the job's server id
          filename: img.filename,
          subfolder: img.subfolder || '',
          type: img.type || 'output',
          promptId,
          positive: meta.positive,
          negative: meta.negative,
          seed: meta.seed,
          model: meta.model,
          createdAt: Date.now(),
          workflow: meta.workflow,
          layers: meta.layers,
        };
        return { url, entry: historyEntry };
      }
    }
    return { error: 'No image in output' };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Snapshot of a ComfyUI server's live queue — the prompt ids currently running
 * and those still pending. Used to reconcile persisted jobs after a refresh.
 */
export async function fetchQueue(host: string): Promise<{ running: string[]; pending: string[] }> {
  const res = await fetch(`${comfyHttpFor(host)}/queue`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  // Each queue item is shaped [number, prompt_id, graph, extra, ...].
  const ids = (arr: unknown): string[] =>
    Array.isArray(arr)
      ? arr.map(e => (Array.isArray(e) ? String(e[1] ?? '') : '')).filter(Boolean)
      : [];
  return { running: ids(json.queue_running), pending: ids(json.queue_pending) };
}

/** Interrupt whatever prompt is currently executing on a ComfyUI server. */
export async function interruptPrompt(host: string): Promise<void> {
  await fetch(`${comfyHttpFor(host)}/interrupt`, { method: 'POST' });
}

/** Remove a still-pending prompt from a ComfyUI server's queue by id. */
export async function deleteQueuedPrompt(host: string, promptId: string): Promise<void> {
  await fetch(`${comfyHttpFor(host)}/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delete: [promptId] }),
  });
}

/**
 * Pull the most recently *run* workflow back out of a ComfyUI server.
 * ComfyUI's `/history` stores each run as `prompt: [number, prompt_id, graph,
 * extra, ...]` where `graph` is the API-format prompt graph.
 */
export async function fetchLastWorkflow(host: string): Promise<
  | { ok: true; json: string; promptId: string }
  | { ok: false; error: string }
> {
  try {
    const res = await fetch(`${comfyHttpFor(host)}/history?max_items=1`);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const hist = await res.json() as Record<string, { prompt?: unknown[] }>;
    const ids = Object.keys(hist);
    if (!ids.length) {
      return { ok: false, error: 'No runs in this ComfyUI history yet — queue a workflow there first.' };
    }
    const entry = hist[ids[ids.length - 1]];
    const graph = entry?.prompt?.[2];
    if (!graph || typeof graph !== 'object') {
      return { ok: false, error: 'Latest history entry has no prompt graph.' };
    }
    return { ok: true, json: JSON.stringify(graph, null, 2), promptId: ids[ids.length - 1] };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type WsEvent =
  | { type: 'binary'; mime: string; bytes: Uint8Array }
  | { type: 'progress'; value: number; max: number }
  | { type: 'executing'; promptId: string; node: string | null }
  | { type: 'execution_error'; message: string };

/**
 * Connect to a ComfyUI server's websocket. Auto-reconnects every 2s on close.
 * `onOpen`/`onClose` fire on connection state changes; `onEvent` for messages.
 * Returns a cleanup function that closes the socket and stops reconnecting.
 */
export function connectComfyWs(host: string, handlers: {
  onOpen?: () => void;
  onClose?: () => void;
  onEvent: (ev: WsEvent) => void;
}): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    if (stopped) return;
    ws = new WebSocket(`${comfyWsFor(host)}?clientId=${clientId}`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => handlers.onOpen?.();
    ws.onclose = () => {
      handlers.onClose?.();
      if (!stopped) reconnectTimer = setTimeout(open, 2000);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        let msg: { type?: string; data?: Record<string, unknown> };
        try { msg = JSON.parse(ev.data); } catch { return; }
        const { type, data } = msg;
        if (!type || !data) return;
        if (type === 'progress') {
          handlers.onEvent({ type: 'progress', value: Number(data.value) | 0, max: Number(data.max) | 0 });
        } else if (type === 'executing') {
          handlers.onEvent({ type: 'executing', promptId: String(data.prompt_id || ''), node: data.node === null ? null : String(data.node ?? '') });
        } else if (type === 'execution_error') {
          handlers.onEvent({ type: 'execution_error', message: String(data.exception_message || 'execution_error') });
        }
      } else if (ev.data instanceof ArrayBuffer) {
        const buf = ev.data;
        if (buf.byteLength < 8) return;
        const view = new DataView(buf);
        const eventType = view.getUint32(0, false);
        if (eventType !== 1) return;
        const fmt = view.getUint32(4, false);
        const mime = fmt === 2 ? 'image/png' : 'image/jpeg';
        handlers.onEvent({ type: 'binary', mime, bytes: new Uint8Array(buf, 8) });
      }
    };
  };

  open();

  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  };
}

// ─── Studio: saved workflows and raw-graph submission ───────────────────────
//
// The generate view builds one fixed graph out of WorkflowState. Studio does the opposite: it
// takes whatever workflow the person built in ComfyUI and submits that. These are the two ends
// of that path, kept here so every fetch to a ComfyUI host still goes through one module.

/** One saved workflow as ComfyUI's userdata API lists it. */
export interface SavedWorkflow {
  /** Path under the workflows dir, e.g. `portrait.json` or `wip/portrait.json`. */
  path: string;
  /** Leaf name without the extension — what the ComfyUI tab is called. */
  name: string;
  /** Epoch ms of the last save, when the server reports it. Drives change detection. */
  modified: number;
}

/**
 * List the workflows saved in ComfyUI on this host.
 *
 * ComfyUI writes every saved workflow under its `userdata` store, which is the only place the
 * running editor's work is readable from outside the browser tab. Polling this is what makes
 * "build it in ComfyUI and it shows up here" true without ComfyUI having to tell us anything.
 *
 * An empty list is a normal answer: the endpoint 404s with "Directory not found" until the person
 * saves for the first time, so that case is not an error.
 */
export async function listSavedWorkflows(host: string): Promise<SavedWorkflow[]> {
  const url = `${comfyHttpFor(host)}/api/userdata?dir=workflows&recurse=true&full_info=true`;
  const res = await fetch(url);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r: unknown) => {
      // full_info=true gives objects; without it the API returns bare strings. Accept both so a
      // slightly older ComfyUI still lists.
      const path = typeof r === 'string' ? r : String((r as { path?: string }).path ?? '');
      const modified = typeof r === 'string' ? 0 : Number((r as { modified?: number }).modified ?? 0);
      return { path, name: path.replace(/^.*\//, '').replace(/\.json$/i, ''), modified };
    })
    .filter(w => w.path.toLowerCase().endsWith('.json'))
    .sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
}

/** Fetch one saved workflow's editor JSON. `path` is as `listSavedWorkflows` reported it. */
export async function loadSavedWorkflow(host: string, path: string): Promise<unknown> {
  // The userdata file API takes the whole path as ONE encoded segment — the slash inside it must
  // stay escaped or the server reads it as a directory boundary and 404s.
  const id = encodeURIComponent(`workflows/${path}`);
  const res = await fetch(`${comfyHttpFor(host)}/api/userdata/${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Submit an already-built API graph. The generate view's `queuePrompt` owns compiling prompts and
 * uploading images; Studio has a graph already and needs none of that, so this is the thin path.
 * It reuses `clientId` so the existing websocket sees progress for these jobs too.
 */
export async function queueGraph(
  host: string,
  graph: Record<string, unknown>,
): Promise<{ ok: true; promptId: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${comfyHttpFor(host)}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: graph, client_id: clientId }),
    });
    const json = await res.json();
    if (json.error) {
      // ComfyUI reports a bad graph as {error, node_errors}. The node errors say which widget is
      // wrong, which is exactly what a person tuning exposed params needs to see.
      const detail = json.node_errors && Object.keys(json.node_errors).length
        ? ` (${Object.entries(json.node_errors as Record<string, { errors?: { message?: string }[] }>)
            .map(([id, e]) => `node ${id}: ${e.errors?.[0]?.message ?? 'invalid'}`).join('; ')})`
        : '';
      return { ok: false, error: (json.error.message || JSON.stringify(json.error)) + detail };
    }
    if (json.prompt_id) return { ok: true, promptId: json.prompt_id };
    return { ok: false, error: 'Queue rejected' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
