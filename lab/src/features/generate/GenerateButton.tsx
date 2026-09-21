import { useShortcut, ShortcutPriority } from '@/hooks/useShortcut';
import { useStore } from '@/lib/store';
import { useCanvasStore } from '@/lib/canvasStore';
import { getCanvasController } from '@/lib/canvasContext';
import { canvasStorage } from '@/lib/canvasStorageInstance';
import { queuePrompt, uploadImage, loadImageRef } from '@/lib/comfy';
import type { InpaintSource } from '@/lib/comfy';
import type { CanvasLayer } from '@/lib/types';
import { missingResources } from '@/lib/routing';
import type { Job, WorkflowState } from '@/lib/types';
import { cn } from '@/lib/cn';

/** Denoise threshold at which `'auto'` variant flips to destructive (uses
 *  `VAEEncodeForInpaint` and forces denoise to 1.0). Below it, auto picks
 *  denoising (`SetLatentNoiseMask`). 0.99 rather than 1.0 keeps slider
 *  rounding noise from accidentally flipping the variant. */
const DESTRUCTIVE_DENOISE_THRESHOLD = 0.99;

/** Resolve a canvas layer's currently-selected image to a Blob, or null if
 *  no history entry is selected / the blob is missing. The selected entry
 *  is the unified "current pixels" of the layer in the new model — used as
 *  the source for both inpaint capture and img2img upload. */
async function resolveLayerSourceBlob(layer: CanvasLayer): Promise<Blob | null> {
  if (!layer.selectedHistoryId) return null;
  try {
    const history = await canvasStorage.listLayerHistory(layer.id);
    const entry = history.find(e => e.id === layer.selectedHistoryId);
    if (!entry) return null;
    return (await canvasStorage.getBlob(entry.blobId)) ?? null;
  } catch {
    return null;
  }
}

import {
  GenerateIcon, KeyboardCommandIcon, KeyboardEnterIcon,
} from '@/components/ui/icons';
import { RoutingPicker } from './RoutingPicker';

/**
 * Queue a job. Resolves the routing target, blocks if any model the workflow
 * needs isn't on that server, then queues + records the job. The round-robin
 * cursor only advances on a *successful* queue, so a blocked attempt doesn't
 * silently skip a server.
 */
export async function fireFromStore() {
  const st = useStore.getState();
  const { layers, setStatus } = st;

  // Resolve the generation context. If a canvas layer is active, the gen is
  // "layer-targeted": uses the layer's workflow (cloned-on-create from default)
  // with its bounds.w/h overriding width/height, and the result will stamp
  // into the layer + populate its per-layer history at completion. Otherwise
  // the gen is "untargeted" and uses the global workflow as before.
  const cs = useCanvasStore.getState();
  // Layer routing only applies on the canvas view — `activeLayerId` is
  // persisted state, so when the user switches to the Generate view (no
  // <InfiniteCanvas> mounted) a stale selection would still drive the
  // inpaint path and immediately fail at getCanvasController().
  const activeLayer = cs.mainView === 'canvas' && cs.activeLayerId
    ? cs.canvasLayers.find(l => l.id === cs.activeLayerId)
    : null;
  const targetLayerId = activeLayer ? activeLayer.id : undefined;

  // Pre-roll a fresh seed when auto-randomize is on so it's reflected in the
  // UI, the queued ComfyUI graph, and the job/history record that gets saved.
  // We currently source ALL workflow params (incl. seed) from the global
  // store regardless of active layer — the per-layer workflow field on
  // CanvasLayer is reserved for the future panel-set UI (ticket #35), which
  // will give each layer an editable parameter view. Until then, layers
  // contribute only bounds (size + position) + the targetLayerId routing
  // hint; editing params in the left panel applies to whichever gen fires
  // next, layer-targeted or not.
  if (st.workflow.randomizeSeed) {
    st.setWorkflow({ seed: Math.floor(Math.random() * 0xFFFFFFFF) });
  }

  // Build the workflow we'll queue. For layer-targeted gens, override
  // width/height from the layer's bounds — bounds are the source of truth for
  // generation size in the compositor model.
  const liveLayer = targetLayerId
    ? useCanvasStore.getState().canvasLayers.find(l => l.id === targetLayerId)
    : null;
  const baseWorkflow = useStore.getState().workflow;
  let workflow: WorkflowState = liveLayer
    ? { ...baseWorkflow, width: liveLayer.bounds.w, height: liveLayer.bounds.h }
    : baseWorkflow;

  // Layer-targeted gens always go through the inpaint pipeline now (#38
  // collapsed the three layer types into one). The capture pulls in the
  // wider canvas context for blending; the mask scopes the change to the
  // layer's bounds; attached pixels (if any) are the model's img2img
  // source — without attached, the source is whatever's *under* the layer
  // (the original "from-canvas" behavior) or pure noise at denoise=1.0
  // (the original "empty" behavior).
  let inpaintSource: InpaintSource | null = null;
  let resultCrop: { fx: number; fy: number; fw: number; fh: number } | undefined;
  // Layer source resolved once and reused across the three layer fill-mode
  // branches. For inpaint it's rendered into the composite; for img2img
  // it's uploaded per-server as the input image.
  let layerSourceBlob: Blob | null = null;
  const fillMode = liveLayer?.fillMode ?? 'inpaint';
  if (liveLayer && fillMode !== 'txt2img') {
    layerSourceBlob = await resolveLayerSourceBlob(liveLayer);
    if (!layerSourceBlob && fillMode === 'img2img') {
      setStatus('Img2img needs a layer image — select one in the layer’s history strip, or switch to Txt2img.', 'error');
      return;
    }
  }

  if (liveLayer && fillMode === 'inpaint') {
    const ctl = getCanvasController();
    if (!ctl) { setStatus('Canvas not ready for composite capture', 'error'); return; }
    setStatus('Capturing canvas composite…', 'busy');
    // Render the layer's selected-history pixels into the captured
    // composite at the bounds — they're the source for the masked region.
    // If the layer has no selected entry, the inpaint runs with whatever
    // sits under the bounds (transparent area becomes pure-noise fill).
    const sourceUrl = layerSourceBlob ? URL.createObjectURL(layerSourceBlob) : null;
    // Larger capture floor so InpaintCropImproved has headroom to expand the
    // context around the mask without running into the captured image's
    // edge. The crop happens server-side based on
    // `inpaintContextExtend` — what we send is just the outer bound.
    const cap = await ctl.captureContextAndMask(liveLayer.id, 256, sourceUrl, {
      invertMask: !!workflow.inpaintInvertMask,
    });
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    if (!cap) {
      setStatus('Composite capture failed', 'error');
      return;
    }
    // Debug helper — stash the last capture on `window` so it's inspectable
    // from the devtools console. `window.imagelab.dumpLastCapture()` saves
    // both blobs as PNGs so you can verify the mask & composite that were
    // sent to ComfyUI match what you expected.
    if (typeof window !== 'undefined') {
      const w = window as unknown as {
        imagelab?: {
          lastCapture?: typeof cap & { invertMask: boolean; layerId: string };
          dumpLastCapture?: () => void;
        };
      };
      w.imagelab = w.imagelab ?? {};
      w.imagelab.lastCapture = { ...cap, invertMask: !!workflow.inpaintInvertMask, layerId: liveLayer.id };
      w.imagelab.dumpLastCapture = () => {
        const c = w.imagelab?.lastCapture;
        if (!c) { console.warn('No capture stashed yet'); return; }
        for (const [name, blob] of [['composite', c.composite], ['mask', c.mask]] as const) {
          const u = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = u;
          a.download = `imagelab-${name}-${Date.now()}.png`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(u), 1000);
        }
        console.log('[imagelab] capture meta:', {
          invertMask: c.invertMask,
          layerId: c.layerId,
          contextBounds: c.contextBounds,
        });
      };
    }
    const denoise = Number(workflow.inputDenoise);
    // Outpainting detection: the masked region of the composite is mostly
    // empty (no attached image at all, or an attached image that doesn't
    // fill the bounds — i.e. user extended the bounds beyond the existing
    // pixels). In that case the composite's masked area is transparent →
    // serialised as black RGB, and the 'denoising' variant (default below
    // the auto threshold) feeds those black pixels into VAEEncode +
    // SetLatentNoiseMask. With anything less than denoise=1.0 the model
    // can't escape that black starting point, so the outpainted area
    // stays dark. The 'destructive' variant routes through
    // VAEEncodeForInpaint which fills the mask region with mid-grey
    // before encoding and runs the sampler at denoise=1.0 — proper
    // outpainting behaviour regardless of the user's denoise slider.
    let isOutpainting = !layerSourceBlob;
    if (layerSourceBlob) {
      try {
        const bmp = await createImageBitmap(layerSourceBlob);
        // 5% slack on each axis so a near-match (e.g. 1024×1023 image in a
        // 1024×1024 layer) doesn't get pushed onto the destructive path.
        isOutpainting = bmp.width < liveLayer.bounds.w * 0.95
                     || bmp.height < liveLayer.bounds.h * 0.95;
        bmp.close();
      } catch {
        // Decode failure: assume outpainting so the user gets a usable
        // result rather than a dark frame.
        isOutpainting = true;
      }
    }
    const variant: 'destructive' | 'denoising' = workflow.inpaintVariant === 'auto'
      ? (isOutpainting || denoise >= DESTRUCTIVE_DENOISE_THRESHOLD ? 'destructive' : 'denoising')
      : workflow.inpaintVariant;
    // Painted-mask override: if the layer has a `paintedMaskBlobId`, build a
    // context-sized mask by drawing the painted mask at the layer's offset
    // inside the context bounds. White = inpaint, black = keep.
    let activeMaskBlob = cap.mask;
    if (liveLayer.paintedMaskBlobId) {
      try {
        const paintedBlob = await canvasStorage.getBlob(liveLayer.paintedMaskBlobId);
        if (paintedBlob) {
          const paintedImg = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image();
            const u = URL.createObjectURL(paintedBlob);
            el.onload = () => { URL.revokeObjectURL(u); resolve(el); };
            el.onerror = () => { URL.revokeObjectURL(u); reject(new Error('mask decode failed')); };
            el.src = u;
          });
          // Mask canvas must match the context image's pixel size. We don't
          // know that here without decoding cap.mask — use cap.contextBounds
          // (world px) since captureContextAndMask renders the context at
          // 1 world-px = 1 image-px.
          const cw = Math.max(1, Math.round(cap.contextBounds.w));
          const ch = Math.max(1, Math.round(cap.contextBounds.h));
          const out = document.createElement('canvas');
          out.width = cw;
          out.height = ch;
          const octx = out.getContext('2d');
          if (octx) {
            octx.fillStyle = '#000';
            octx.fillRect(0, 0, cw, ch);
            const offX = Math.round(liveLayer.bounds.x - cap.contextBounds.x);
            const offY = Math.round(liveLayer.bounds.y - cap.contextBounds.y);
            const dw = Math.round(liveLayer.bounds.w);
            const dh = Math.round(liveLayer.bounds.h);
            octx.drawImage(paintedImg, offX, offY, dw, dh);
            const composed = await new Promise<Blob | null>(r => out.toBlob(b => r(b), 'image/png'));
            if (composed) activeMaskBlob = composed;
          }
        }
      } catch (err) {
        console.warn('[GenerateButton] painted mask compose failed; falling back to bounds mask', err);
      }
    }
    inpaintSource = {
      composite: cap.composite,
      mask: activeMaskBlob,
      variant,
      blendPx: Number(workflow.inpaintFeather) || 0,
      maskExpand: Number(workflow.inpaintMaskExpand) || 0,
      controlnet: workflow.inpaintUseControlnet && workflow.inpaintControlnet
        ? { model: workflow.inpaintControlnet, strength: Number(workflow.inpaintControlnetStrength) || 1.0 }
        : null,
      contextExtend: Number(workflow.inpaintContextExtend) || 1.5,
      targetSize: workflow.inpaintTargetSize,
      invertMask: !!workflow.inpaintInvertMask,
      baseName: `from-canvas-${liveLayer.id.slice(0, 6)}`,
    };
    // Crop the result back to just the layer's region. Fractions of the
    // result's natural size (the inpaint may downscale, but the relative
    // position of the masked region within the context is invariant).
    resultCrop = {
      fx: (liveLayer.bounds.x - cap.contextBounds.x) / cap.contextBounds.w,
      fy: (liveLayer.bounds.y - cap.contextBounds.y) / cap.contextBounds.h,
      fw: liveLayer.bounds.w / cap.contextBounds.w,
      fh: liveLayer.bounds.h / cap.contextBounds.h,
    };
    // Drop any lingering workflow.inputImage so it doesn't shadow the
    // inpaint source path in queuePrompt.
    workflow = { ...workflow, inputImage: null };
  } else if (liveLayer && fillMode === 'img2img') {
    // Img2img: the queueing layer below will upload `layerSourceBlob` to the
    // resolved target server and pass it as `preUploadedRef`. Drop any
    // lingering workflow.inputImage so queuePrompt's auto-upload path
    // doesn't fire on top of ours.
    workflow = { ...workflow, inputImage: null };
  } else if (liveLayer && fillMode === 'txt2img') {
    // Txt2img-on-layer: the user-facing Denoise slider in the parameters
    // panel writes to `inputDenoise` (so the same control surfaces in
    // inpaint mode too). Mirror it onto `workflow.denoise` here so it
    // actually drives the base sampler for the txt2img path.
    workflow = { ...workflow, denoise: workflow.inputDenoise };
  }

  // Round-robin: skip any server that's online but can't run this workflow,
  // so a missing checkpoint/LoRA never gets the user stuck spamming Generate.
  // Pinned: peekNextServer returns the pinned server even if offline/incapable
  // so the per-server error below stays informative.
  const target = st.peekNextServer({ workflow });
  if (!target) {
    // Distinguish "no online servers" from "no capable server" so the user
    // can act on the right thing.
    const online = st.servers.filter(sv => st.serverInfo[sv.id]);
    if (!online.length) { setStatus('No online servers to queue on', 'error'); return; }
    // Some are online but none can run this workflow — show the first one's
    // missing pieces as the canonical breakdown.
    const missing = missingResources(workflow, st.serverInfo[online[0].id]);
    setStatus(`No server can run this workflow — missing ${missing.join(', ')}`, 'error');
    return;
  }

  const info = st.serverInfo[target.id];
  if (!info) { setStatus(`${target.name} is offline — can't queue`, 'error'); return; }

  // Belt-and-suspenders: round-robin already filtered for capability, but
  // pinned mode skips that filter, so re-check before queueing.
  const missing = missingResources(workflow, info);
  if (missing.length) {
    setStatus(`Can't run on ${target.name}: missing ${missing.join(', ')}`, 'error');
    return;
  }

  // Img2img: upload the layer's source pixels to the chosen target server
  // and hand the ref to queuePrompt. Round-robin can route the next gen to
  // a different server, so each attempt uploads to its own target.
  let preUploadedRef: string | null = null;
  if (fillMode === 'img2img' && liveLayer && layerSourceBlob) {
    try {
      setStatus(`Uploading source image to ${target.name}…`, 'busy');
      const up = await uploadImage(target.host, layerSourceBlob, `layer-${liveLayer.id.slice(0, 6)}.png`);
      preUploadedRef = loadImageRef(up);
    } catch (err) {
      setStatus(`Img2img upload failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
      return;
    }
  }

  setStatus(`Queueing on ${target.name}…`, 'busy');
  const res = await queuePrompt(target.host, workflow, layers, preUploadedRef, inpaintSource);
  if (!res.ok) {
    console.error('[queuePrompt] failed on', target.name, '→', res.error);
    setStatus(res.error, 'error');
    return;
  }

  // Success — now it's safe to advance the round-robin cursor, against the
  // same eligibility filter peek used.
  useStore.getState().advanceRoundRobin({ workflow });

  const job: Job = {
    id: res.promptId,
    serverId: target.id,
    positive: res.positive,
    negative: res.negative,
    seed: workflow.seed,
    model: workflow.checkpoints[0]?.name ?? '',
    workflow,
    layers,
    targetLayerId,
    ...(resultCrop ? { resultCrop } : {}),
    status: 'queued',
    totalNodes: res.nodeCount,
    executedNodes: 0,
    createdAt: Date.now(),
  };
  useStore.getState().addJob(job);
  const targetLabel = liveLayer ? `Layer "${liveLayer.name}"` : target.name;
  const clampSuffix = res.clampNotes.length ? ` · ${res.clampNotes.join(' · ')}` : '';
  setStatus(`Queued on ${target.name} → ${targetLabel} (#${res.promptId.slice(0, 6)})${clampSuffix}`, 'busy');
}

export function GenerateButton() {
  // ⌘↵ / ctrl+enter — explicitly does NOT skip typing targets so the user
  // can fire generate from inside a layer textarea. Disabled-state check
  // happens inside fireFromStore via the same `disabled` derivation below.
  useShortcut('cmd+Enter', (e) => {
    e.preventDefault();
    const cs = useCanvasStore.getState();
    if (cs.mainView === 'canvas' && !cs.activeLayerId) return;
    fireFromStore();
  }, { priority: ShortcutPriority.Global, skipTyping: false });

  // Show where the result will land so users aren't surprised that a
  // layer-targeted gen ends up stamping into the layer instead of going to
  // the global canvas image slot.
  const activeLayer = useCanvasStore(s =>
    s.activeLayerId ? s.canvasLayers.find(l => l.id === s.activeLayerId) ?? null : null);
  const mainView = useCanvasStore(s => s.mainView);
  // In infinite canvas mode every gen targets a layer (#41). Without a
  // selected layer, there's nothing to stamp into — disable Generate to
  // make that obvious rather than silently routing to the global preview.
  const disabled = mainView === 'canvas' && !activeLayer;

  return (
    <div className="btn-glow flex w-full overflow-hidden rounded-xl">
      <button
        type="button"
        onClick={fireFromStore}
        disabled={disabled}
        title={disabled ? 'Select a canvas layer to generate' : undefined}
        className={cn(
          'flex flex-1 items-center justify-between gap-2 px-4 py-3.5 font-semibold text-white transition-colors',
          disabled
            ? 'cursor-not-allowed bg-bg-elev text-fg-dim'
            : 'bg-accent hover:bg-accent-hover',
        )}
      >
        <span className="flex items-center gap-2">
          <GenerateIcon size={15} />
          <span className="text-[13px]">Generate</span>
          {activeLayer && !disabled && (
            <span
              className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-medium"
              title={`Generation will stamp into "${activeLayer.name}" — its bounds drive the output size.`}
            >
              → {activeLayer.name}
            </span>
          )}
        </span>
        {!disabled && (
          <span className="flex items-center gap-1 rounded bg-white/15 px-1.5 py-0.5">
            <KeyboardCommandIcon size={12} />
            <KeyboardEnterIcon size={12} />
          </span>
        )}
      </button>
      <RoutingPicker variant="lg" align="end" />
    </div>
  );
}
