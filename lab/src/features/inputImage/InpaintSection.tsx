import { useState } from 'react';
import { useStore } from '@/lib/store';
import { useCanvasStore } from '@/lib/canvasStore';
import { useCollapsed } from '@/hooks/useCollapsed';
import { MaskPainter } from './MaskPainter';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Field } from '@/components/ui/Field';
import { Slider } from '@/components/ui/Slider';
import { Select } from '@/components/ui/Select';
import { DenoiseField } from '@/features/controls/DenoiseField';
import { ChevronDownIcon, ChevronRightIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

const VARIANTS: Array<{
  value: 'auto' | 'destructive' | 'denoising';
  label: string;
  hint: string;
}> = [
  { value: 'auto', label: 'Auto', hint: 'Picks by denoise: ≥0.99 destructive, else denoising' },
  { value: 'destructive', label: 'Destructive', hint: 'VAEEncodeForInpaint — model creates from scratch in the mask, denoise forced to 1.0' },
  { value: 'denoising', label: 'Denoising', hint: 'SetLatentNoiseMask — model varies the underlying pixels at the current denoise' },
];

const RESOLUTION_OPTIONS = ['Auto', '512', '768', '1024', '1536', '2048'];

/**
 * Preset bundles for the most common inpaint flavours. Each writes a full
 * combo of variant + context + feather + denoise + invertMask so the user
 * doesn't have to reason about how those knobs interact. "Custom" is the
 * fall-through when no preset matches the current values.
 */
type InpaintPreset = {
  id: 'inpaint' | 'replace' | 'extend' | 'refine';
  label: string;
  blurb: string;
  patch: {
    inpaintVariant: 'auto' | 'destructive' | 'denoising';
    inpaintContextExtend: number;
    inpaintFeather: number;
    inpaintMaskExpand: number;
    inpaintInvertMask: boolean;
    inputDenoise: number;
    inpaintTargetSize: 'auto' | number;
  };
};

const PRESETS: InpaintPreset[] = [
  {
    id: 'inpaint',
    label: 'Inpaint area',
    blurb: 'Vary an area, keep its overall look (denoise ≈ 0.6)',
    patch: {
      inpaintVariant: 'denoising',
      inpaintContextExtend: 1.5,
      inpaintFeather: 8,
      inpaintInvertMask: false,
      inputDenoise: 0.6,
      inpaintTargetSize: 1024,
      inpaintMaskExpand: 0,
    },
  },
  {
    id: 'replace',
    label: 'Replace area',
    blurb: 'Generate the masked area from scratch (full denoise)',
    patch: {
      inpaintVariant: 'destructive',
      inpaintContextExtend: 2.0,
      inpaintFeather: 16,
      inpaintInvertMask: false,
      inputDenoise: 1.0,
      inpaintTargetSize: 1024,
      inpaintMaskExpand: 0,
    },
  },
  {
    id: 'extend',
    label: 'Extend image',
    blurb: 'Outpaint — fill only the empty area next to existing content',
    patch: {
      inpaintVariant: 'destructive',
      inpaintContextExtend: 2.5,
      inpaintFeather: 24,
      inpaintInvertMask: true,
      inputDenoise: 1.0,
      inpaintTargetSize: 1024,
      inpaintMaskExpand: 0,
    },
  },
  {
    id: 'refine',
    label: 'Refine details',
    blurb: 'Gentle pass — clean up details without changing composition',
    patch: {
      inpaintVariant: 'denoising',
      inpaintContextExtend: 1.2,
      inpaintFeather: 6,
      inpaintInvertMask: false,
      inputDenoise: 0.35,
      inpaintTargetSize: 1024,
      inpaintMaskExpand: 0,
    },
  },
];

function presetMatches(p: InpaintPreset, current: {
  inpaintVariant: 'auto' | 'destructive' | 'denoising';
  inpaintContextExtend: number;
  inpaintFeather: number;
  inpaintMaskExpand: number;
  inpaintInvertMask: boolean;
  inputDenoise: number;
  inpaintTargetSize: 'auto' | number;
}) {
  return (
    p.patch.inpaintVariant === current.inpaintVariant &&
    Math.abs(p.patch.inpaintContextExtend - current.inpaintContextExtend) < 0.05 &&
    p.patch.inpaintFeather === current.inpaintFeather &&
    p.patch.inpaintMaskExpand === current.inpaintMaskExpand &&
    p.patch.inpaintInvertMask === current.inpaintInvertMask &&
    Math.abs(p.patch.inputDenoise - current.inputDenoise) < 0.02 &&
    p.patch.inpaintTargetSize === current.inpaintTargetSize
  );
}

/**
 * Inpaint controls for any active canvas layer (#38 collapsed the per-type
 * gating). All layer-targeted gens run through the inpaint pipeline now,
 * so this section is visible whenever a layer is active.
 *
 * The inpaint pipeline uses InpaintCropImproved → KSampler →
 * InpaintStitchImproved on the server. The controls map directly to crop
 * node params:
 *   - Variant     → which KSampler-priming node we use inside the crop
 *   - Context     → context_from_mask_extend_factor (crop padding around mask)
 *   - Resolution  → output_resize_to_target_size + output_target_w/h
 *   - Edge blend  → mask_blend_pixels (stitch seam softness)
 */
export function InpaintSection() {
  const hasActiveLayer = useCanvasStore(s => s.activeLayerId !== null);
  const activeLayerId = useCanvasStore(s => s.activeLayerId);
  const activeLayer = useCanvasStore(s =>
    s.activeLayerId ? s.canvasLayers.find(l => l.id === s.activeLayerId) ?? null : null);
  const updateCanvasLayer = useCanvasStore(s => s.updateCanvasLayer);
  const [maskOpen, setMaskOpen] = useState(false);
  const inpaintFeather = useStore(s => s.workflow.inpaintFeather);
  const inpaintMaskExpand = useStore(s => s.workflow.inpaintMaskExpand);
  const inpaintVariant = useStore(s => s.workflow.inpaintVariant);
  const inpaintContextExtend = useStore(s => s.workflow.inpaintContextExtend);
  const inpaintTargetSize = useStore(s => s.workflow.inpaintTargetSize);
  const inpaintInvertMask = useStore(s => s.workflow.inpaintInvertMask);
  const inputDenoise = useStore(s => s.workflow.inputDenoise);
  const inpaintUseControlnet = useStore(s => s.workflow.inpaintUseControlnet);
  const inpaintControlnet = useStore(s => s.workflow.inpaintControlnet);
  const inpaintControlnetStrength = useStore(s => s.workflow.inpaintControlnetStrength);
  const controlnets = useStore(s => s.server.controlnets);
  const setWorkflow = useStore(s => s.setWorkflow);
  // Persist the Advanced disclosure across reloads — without this users who
  // tweak knobs every session have to re-open it every time.
  const [advancedCollapsed, , setAdvancedCollapsed] = useCollapsed('inpaint.advanced', true);
  const advancedOpen = !advancedCollapsed;
  const setAdvancedOpen = (v: boolean) => setAdvancedCollapsed(!v);

  if (!hasActiveLayer) return null;

  const targetSelectValue = inpaintTargetSize === 'auto' ? 'Auto' : String(inpaintTargetSize);
  // Destructive variant forces denoise to 1.0 inside the graph (see
  // buildGraph), so the denoise slider has no effect there — hide it
  // instead of letting the user fiddle with a no-op control.
  const denoiseApplies = inpaintVariant !== 'destructive';

  const current = { inpaintVariant, inpaintContextExtend, inpaintFeather, inpaintMaskExpand, inpaintInvertMask, inputDenoise, inpaintTargetSize };
  const activePreset = PRESETS.find(p => presetMatches(p, current))?.id ?? null;
  const applyPreset = (p: InpaintPreset) => {
    setWorkflow(p.patch);
  };

  return (
    <section className="flex flex-col gap-2">
      <SectionHeader label="INPAINT" />

      {/* Mask painter trigger — opens the brush-paint mask editor for the
          active layer. When a painted mask is set, the inpaint queue path
          uses it in place of the default full-bounds mask. */}
      <div className="flex items-center gap-2 rounded-md border border-border-default bg-bg-input px-2 py-1.5">
        <span className="flex-1 text-[11px] text-fg-tertiary">
          {activeLayer?.paintedMaskBlobId
            ? 'Custom mask active'
            : 'Mask: full bounds'}
        </span>
        {activeLayer?.paintedMaskBlobId && (
          <button
            type="button"
            onClick={() => activeLayerId && updateCanvasLayer(activeLayerId, { paintedMaskBlobId: undefined })}
            className="rounded border border-border-subtle px-2 py-1 text-[10.5px] text-fg-muted transition-colors hover:border-border-strong hover:text-fg-secondary"
          >
            Clear
          </button>
        )}
        <button
          type="button"
          onClick={() => setMaskOpen(true)}
          className="rounded border border-accent bg-accent px-2 py-1 text-[10.5px] font-semibold text-white transition-colors hover:bg-accent-hover"
        >
          {activeLayer?.paintedMaskBlobId ? 'Edit mask' : 'Paint mask'}
        </button>
      </div>
      {activeLayerId && (
        <MaskPainter open={maskOpen} onClose={() => setMaskOpen(false)} layerId={activeLayerId} />
      )}

      {/* Mask shape + expand + feather sit next to the Paint mask button so
          the whole "mask" toolkit reads as one cluster. They drive both the
          inpaint pipeline and the live preview overlay on the canvas. */}
      <Field label="Mask shape">
        <button
          type="button"
          onClick={() => setWorkflow({ inpaintInvertMask: !inpaintInvertMask })}
          aria-pressed={inpaintInvertMask}
          title={inpaintInvertMask
            ? 'Mask covers only the parts of the layer that aren\'t covered by another visible layer. Useful for extending past existing content.'
            : 'Mask covers the entire layer bounds (default). Click to invert — preserve overlapping layer content and inpaint only the new empty area.'}
          className={cn(
            'flex flex-1 items-center justify-between rounded-md border px-2 py-1.5 text-[11px] font-medium transition-colors',
            inpaintInvertMask
              ? 'border-accent bg-accent text-white'
              : 'border-border-default bg-bg-input text-fg-muted hover:text-fg-secondary',
          )}
        >
          <span>{inpaintInvertMask ? 'Non-overlap only' : 'Full bounds'}</span>
          <span className="text-[9px] uppercase tracking-section opacity-70">
            {inpaintInvertMask ? 'invert' : 'default'}
          </span>
        </button>
      </Field>

      <Field label="Mask expand">
        <Slider
          value={inpaintMaskExpand}
          onValueChange={(v) => setWorkflow({ inpaintMaskExpand: Math.round(v) })}
          min={0}
          max={256}
          step={1}
          ariaLabel="Dilate the mask outward by N pixels before inpainting"
        />
        <span className="w-12 shrink-0 text-right text-[12px] font-medium tabular-nums text-fg-secondary">
          {inpaintMaskExpand}px
        </span>
      </Field>

      <Field label="Mask feather">
        <Slider
          value={inpaintFeather}
          onValueChange={(v) => setWorkflow({ inpaintFeather: Math.round(v) })}
          min={0}
          max={31}
          step={1}
          ariaLabel="Mask edge feather in pixels"
        />
        <span className="w-12 shrink-0 text-right text-[12px] font-medium tabular-nums text-fg-secondary">
          {inpaintFeather}px
        </span>
      </Field>

      {/* ControlNet inpaint bias — alternate mode. Adds a ControlNet
          conditioning step around the sampler so edits tend to seam better
          and outpainting matches surrounding style. Requires the
          `controlnet_aux` custom node (for InpaintPreprocessor) and an
          SDXL-class inpaint CN in `ComfyUI/models/controlnet/`. */}
      {/* Always render so the user can see whether ControlNet wiring is
          available, and what to install if it isn't. */}
      <div className="flex items-center gap-2 rounded-md border border-border-default bg-bg-input px-2 py-1.5">
        <span className="flex-1 text-[11px] text-fg-tertiary">
          ControlNet inpaint
        </span>
        <button
          type="button"
          onClick={() => setWorkflow({ inpaintUseControlnet: !inpaintUseControlnet })}
          aria-pressed={inpaintUseControlnet}
          disabled={controlnets.length === 0}
          title={controlnets.length === 0
            ? 'No ControlNet models found. Drop one into ComfyUI/models/controlnet/ and restart the server.'
            : ''}
          className={cn(
            'rounded border px-2 py-1 text-[10.5px] font-semibold transition-colors',
            controlnets.length === 0
              ? 'cursor-not-allowed border-border-subtle text-fg-dim opacity-50'
              : inpaintUseControlnet
                ? 'border-accent bg-accent text-white'
                : 'border-border-subtle text-fg-muted hover:border-border-strong hover:text-fg-secondary',
          )}
        >
          {inpaintUseControlnet ? 'On' : 'Off'}
        </button>
      </div>
      {controlnets.length === 0 && (
        <div className="rounded-md border border-border-subtle bg-bg-base/40 px-2 py-1.5 text-[10.5px] leading-snug text-fg-dim">
          No ControlNet models detected on the active server(s). Drop an SDXL inpaint CN
          into <code className="text-fg-tertiary">ComfyUI/models/controlnet/</code> and
          restart ComfyUI.
        </div>
      )}
      {inpaintUseControlnet && controlnets.length > 0 && (
        <>
          <Field label="CN model">
            <Select
              value={inpaintControlnet || ''}
              onValueChange={(v) => setWorkflow({ inpaintControlnet: v })}
              options={['', ...controlnets]}
              placeholder="Pick an inpaint CN"
              ariaLabel="ControlNet model"
            />
          </Field>
          <Field label="CN strength">
            <Slider
              value={inpaintControlnetStrength}
              onValueChange={(v) => setWorkflow({ inpaintControlnetStrength: Math.round(v * 100) / 100 })}
              min={0}
              max={2}
              step={0.05}
              ariaLabel="ControlNet strength"
            />
            <span className="w-12 shrink-0 text-right text-[12px] font-medium tabular-nums text-fg-secondary">
              {inpaintControlnetStrength.toFixed(2)}
            </span>
          </Field>
        </>
      )}

      {/* Top-level preset picker — picks a sensible bundle for the most
          common flavours of inpainting. The advanced knobs below fine-tune. */}
      <div className="grid grid-cols-2 gap-1.5">
        {PRESETS.map(p => {
          const isActive = activePreset === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p)}
              title={p.blurb}
              aria-pressed={isActive}
              className={cn(
                'flex flex-col gap-0.5 rounded-md border px-2 py-1.5 text-left transition-colors',
                isActive
                  ? 'border-accent bg-accent-soft/40 text-fg-secondary'
                  : 'border-border-default bg-bg-input text-fg-muted hover:border-border-strong hover:text-fg-secondary',
              )}
            >
              <span className="text-[11.5px] font-medium">{p.label}</span>
              <span className="text-[10px] leading-tight text-fg-tertiary">{p.blurb}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setAdvancedOpen(!advancedOpen)}
        className="mt-1 flex items-center gap-1 self-start rounded px-1 py-0.5 text-[10.5px] font-medium uppercase tracking-section text-fg-dim transition-colors hover:text-fg-secondary"
      >
        {advancedOpen ? <ChevronDownIcon size={10} /> : <ChevronRightIcon size={10} />}
        <span>Advanced {activePreset ? '' : '· custom'}</span>
      </button>

      {advancedOpen && <>

      {denoiseApplies && <DenoiseField />}

      <Field label="Variant">
        <div className="flex flex-1 rounded-md border border-border-default bg-bg-input p-0.5">
          {VARIANTS.map(v => (
            <button
              key={v.value}
              type="button"
              onClick={() => setWorkflow({ inpaintVariant: v.value })}
              title={v.hint}
              aria-pressed={inpaintVariant === v.value}
              className={cn(
                'flex-1 rounded px-2 py-1.5 text-[11px] font-medium transition-colors',
                inpaintVariant === v.value
                  ? 'bg-accent text-white shadow-sm'
                  : 'text-fg-muted hover:text-fg-secondary',
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Resolution">
        <Select
          value={targetSelectValue}
          onValueChange={(v) => setWorkflow({ inpaintTargetSize: v === 'Auto' ? 'auto' : Number(v) })}
          options={RESOLUTION_OPTIONS}
          ariaLabel="Inpaint sampling resolution"
        />
        <span className="shrink-0 text-[10px] text-fg-dim">
          {inpaintTargetSize === 'auto' ? 'from crop' : `${inpaintTargetSize}²`}
        </span>
      </Field>

      <Field label="Context">
        <Slider
          value={inpaintContextExtend}
          onValueChange={(v) => setWorkflow({ inpaintContextExtend: Math.round(v * 10) / 10 })}
          min={1.0}
          max={3.0}
          step={0.1}
          ariaLabel="Context expansion factor around the mask"
        />
        <span className="w-12 shrink-0 text-right text-[12px] font-medium tabular-nums text-fg-secondary">
          {inpaintContextExtend.toFixed(1)}×
        </span>
      </Field>

      </>}
    </section>
  );
}
