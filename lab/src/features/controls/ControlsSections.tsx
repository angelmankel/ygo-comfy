import { useStore } from '@/lib/store';
import { Field } from '@/components/ui/Field';
import { NumberInput } from '@/components/ui/NumberInput';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { RESOLUTION_PRESETS, uid } from '@/lib/storage';
import { scaleForLongestEdge } from '@/features/inputImage/imageOps';
import { useResourceAvailability, availabilityHint } from '@/hooks/useResourceAvailability';
import { cn } from '@/lib/cn';
import { ResetIcon, DiceIcon, CloseIcon } from '@/components/ui/icons';
import type { Pass } from '@/lib/types';
import { ControlSection } from './ControlSection';
import { ParamRow } from './ParamRow';
import { useControlFilter } from './ControlFilter';

/**
 * Defaults a reset goes back to. These are the app's own starting values, not the model's — the
 * point of the reset arrow is "put it back how it was before I started fiddling".
 */
const DEFAULTS = { steps: 20, cfg: 8, denoise: 1, batch: 1, passScale: 1.5, passSteps: 12, passCfg: 8, passDenoise: 0.5 };


function SliderRow({ label, value, onChange, min, max, step = 1, format, defaultValue, hint, disabled }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  defaultValue?: number;
  hint?: React.ReactNode;
  disabled?: boolean;
}) {
  // Kept as the name every section already calls, now drawn by ParamRow: stacked, typeable,
  // nudgeable, resettable. Changing the primitive rather than each call site is what stops the
  // panel drifting into two styles of row.
  return (
    <ParamRow
      label={label} value={value} onChange={onChange}
      min={min} max={max} step={step} format={format}
      defaultValue={defaultValue} hint={hint} disabled={disabled}
    />
  );
}

/**
 * Sampler + scheduler. Checkpoint and VAE selection moved to the model kit
 * (`features/models` — <ModelStack>), which is backed by the same `workflow`
 * state; this section keeps the sampling-algorithm choices.
 */
export function SamplingSection() {
  const workflow = useStore(s => s.workflow);
  const server = useStore(s => s.server);
  const setWorkflow = useStore(s => s.setWorkflow);
  const samplerAvail = useResourceAvailability('sampler');
  const schedulerAvail = useResourceAvailability('scheduler');
  // Keep the current value selectable even if no online server reports it.
  const samplerOpts = server.samplers.includes(workflow.sampler)
    ? server.samplers : [workflow.sampler, ...server.samplers];
  const schedulerOpts = server.schedulers.includes(workflow.scheduler)
    ? server.schedulers : [workflow.scheduler, ...server.schedulers];
  const f = useControlFilter();
  const show = f.matches('sampling', 'sampler', 'scheduler', workflow.sampler, workflow.scheduler);
  if (!show) return null;
  return (
    <ControlSection
      id="sampling"
      title="Sampling"
      summary={`${workflow.sampler} · ${workflow.scheduler}`}
      forceOpen={f.active && show}
    >
      <Field label="Sampler">
        <Select
          value={workflow.sampler}
          onValueChange={(v) => setWorkflow({ sampler: v })}
          options={samplerOpts}
          ariaLabel="Sampler"
          getOptionState={(v) => {
            const a = samplerAvail(v);
            return { disabled: !a.enabled, title: availabilityHint(a) };
          }}
        />
      </Field>
      <Field label="Scheduler">
        <Select
          value={workflow.scheduler}
          onValueChange={(v) => setWorkflow({ scheduler: v })}
          options={schedulerOpts}
          ariaLabel="Scheduler"
          getOptionState={(v) => {
            const a = schedulerAvail(v);
            return { disabled: !a.enabled, title: availabilityHint(a) };
          }}
        />
      </Field>
    </ControlSection>
  );
}

export function GenerationSection({ showDenoise = true }: { showDenoise?: boolean } = {}) {
  const workflow = useStore(s => s.workflow);
  const setWorkflow = useStore(s => s.setWorkflow);
  const f = useControlFilter();
  if (!f.matches('generation', 'steps', 'cfg', 'guidance', 'seed', 'random', 'denoise', 'strength')) return null;
  return (
    <ControlSection
      id="generation"
      title="Generation"
      summary={`${workflow.steps} steps · CFG ${Number(workflow.cfg).toFixed(1)}${showDenoise ? ` · denoise ${Number(workflow.denoise).toFixed(2)}` : ''}`}
      forceOpen={f.active}
    >
      {f.matches('steps', 'generation') && (
        <SliderRow label="Steps" value={workflow.steps} onChange={(v) => setWorkflow({ steps: v })} min={1} max={200} defaultValue={DEFAULTS.steps} />
      )}
      {f.matches('cfg', 'guidance', 'generation') && (
        <SliderRow label="CFG" value={workflow.cfg} onChange={(v) => setWorkflow({ cfg: v })} min={0} max={30} step={0.1} format={(v) => v.toFixed(1)} defaultValue={DEFAULTS.cfg} />
      )}
      {f.matches('seed', 'random', 'generation') && (
        <Field label="Seed">
          <NumberInput value={workflow.seed} onValueChange={(v) => setWorkflow({ seed: v })} step={1} align="right" ariaLabel="Seed" />
          <button
            type="button"
            title="Randomize seed now"
            aria-label="Randomize seed now"
            onClick={() => setWorkflow({ seed: Math.floor(Math.random() * 0xFFFFFFFF) })}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border-default bg-bg-elev text-fg-tertiary hover:border-border-strong hover:text-fg-secondary"
          >
            <ResetIcon size={16} />
          </button>
          <button
            type="button"
            title={workflow.randomizeSeed ? 'Auto-randomize seed on every generate (on)' : 'Auto-randomize seed on every generate (off)'}
            aria-label="Auto-randomize seed on every generate"
            aria-pressed={workflow.randomizeSeed}
            onClick={() => setWorkflow({ randomizeSeed: !workflow.randomizeSeed })}
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-colors',
              workflow.randomizeSeed
                ? 'border-accent bg-accent-soft text-accent-fg'
                : 'border-border-default bg-bg-elev text-fg-tertiary hover:border-border-strong hover:text-fg-secondary',
            )}
          >
            <DiceIcon size={16} filled={workflow.randomizeSeed} />
          </button>
        </Field>
      )}
      {showDenoise && f.matches('denoise', 'strength', 'generation') && (
        <SliderRow label="Denoise" value={workflow.denoise} onChange={(v) => setWorkflow({ denoise: v })} min={0} max={1} step={0.01} format={(v) => v.toFixed(2)} defaultValue={DEFAULTS.denoise} />
      )}
    </ControlSection>
  );
}

function sizeLabel(w: number, h: number) { return `${w} × ${h}`; }

export function OutputSection() {
  const workflow = useStore(s => s.workflow);
  const setWorkflow = useStore(s => s.setWorkflow);

  const current = sizeLabel(workflow.width, workflow.height);
  const presetLabels = RESOLUTION_PRESETS.map(([w, h]) => sizeLabel(w, h));
  // Keep whatever the workflow currently is selectable, even if it's not a preset.
  const options = presetLabels.includes(current) ? presetLabels : [current, ...presetLabels];

  const ratio = (() => {
    const w = workflow.width || 1;
    const h = workflow.height || 1;
    const g = (a: number, b: number): number => b ? g(b, a % b) : a;
    const d = g(w, h);
    return `${w / d}:${h / d}`;
  })();

  const f = useControlFilter();
  if (!f.matches('output', 'size', 'width', 'height', 'resolution', 'batch', 'count')) return null;
  return (
    <ControlSection
      id="output"
      title="Output"
      summary={`${current} · ${ratio}${workflow.batch > 1 ? ` · ×${workflow.batch}` : ''}`}
      forceOpen={f.active}
    >
      {f.matches('size', 'width', 'height', 'resolution', 'output') && (
        <Field label="Size">
          <Select
            value={current}
            onValueChange={(v) => {
              const m = v.match(/(\d+)\s*×\s*(\d+)/);
              if (m) setWorkflow({ width: Number(m[1]), height: Number(m[2]) });
            }}
            options={options}
            ariaLabel="Output size"
          />
          <span className="shrink-0 rounded bg-accent-soft px-2 py-1 text-[11px] font-medium text-accent-fg">
            {ratio}
          </span>
        </Field>
      )}
      {f.matches('batch', 'count', 'output') && (
        <SliderRow label="Batch" value={workflow.batch} onChange={(v) => setWorkflow({ batch: v })} min={1} max={64} defaultValue={DEFAULTS.batch}
          hint={workflow.batch > 4 ? `${workflow.batch} images per run — slower, and every one uses VRAM.` : undefined} />
      )}
    </ControlSection>
  );
}

export function UpscaleModelSection() {
  const workflow = useStore(s => s.workflow);
  const server = useStore(s => s.server);
  const setWorkflow = useStore(s => s.setWorkflow);
  const upscaleAvail = useResourceAvailability('upscale');
  const enabled = workflow.upscaleEnabled;
  const models = Array.isArray(server.upscaleModels) ? server.upscaleModels : [];
  const f = useControlFilter();
  if (!f.matches('upscale', 'upscale model', 'enlarge', 'resize', workflow.upscaleModel)) return null;
  // Native <select> avoids the Radix-Select empty-value crash and works
  // better on mobile keyboards.
  return (
    <ControlSection
      id="upscale"
      title="Upscale model"
      summary={enabled ? (workflow.upscaleModel || models[0] || 'none installed') : 'off'}
      forceOpen={f.active}
      action={<Switch checked={enabled} onCheckedChange={(on) => setWorkflow({ upscaleEnabled: on })} ariaLabel="Enable upscale model" />}
    >
      <p className="px-0.5 pb-1 text-[11px] text-fg-muted">
        A final pass over the finished image, after every sampling pass has run.
      </p>
      <div className={cn('flex flex-col gap-2 transition-opacity', !enabled && 'pointer-events-none opacity-50')}>
        {models.length > 0 ? (
          <Field label="Model">
            <select
              aria-label="Upscale model"
              value={workflow.upscaleModel || models[0]}
              onChange={(e) => setWorkflow({ upscaleModel: e.target.value })}
              className="min-h-[40px] w-full min-w-0 flex-1 truncate rounded-lg border border-border-default bg-bg-input px-3 py-2 text-[13px] text-fg-secondary outline-none hover:border-border-strong focus:border-accent"
            >
              {models.map(m => {
                const a = upscaleAvail(m);
                return (
                  <option key={m} value={m} disabled={!a.enabled} title={availabilityHint(a)}>
                    {m}
                  </option>
                );
              })}
            </select>
          </Field>
        ) : (
          <p className="px-1 text-[11px] italic text-fg-muted">
            No upscale models found on the server. Drop one in <code className="font-mono">models/upscale_models/</code>.
          </p>
        )}
      </div>
    </ControlSection>
  );
}

/**
 * Plain resize — interpolation only, no model.
 *
 * The upscale-model section reinterprets the picture: a neural upscaler invents detail that was
 * not there, which is the point of it and also why it is the wrong tool when a picture is already
 * right and simply needs to be a different size. This is the other one. It runs after the model
 * upscale so it can land a 4x result on an exact number, and works alone as a pure resample.
 */
export function ResizeSection() {
  const workflow = useStore(s => s.workflow);
  const setWorkflow = useStore(s => s.setWorkflow);
  const f = useControlFilter();
  if (!f.matches('resize', 'scale', 'size', 'width', 'height', 'lanczos', 'bicubic', 'interpolate', 'resample'))
    return null;

  const enabled = workflow.resizeEnabled;
  const byFactor = workflow.resizeMode !== 'size';
  const summary = !enabled
    ? 'off'
    : byFactor
      ? `×${Number(workflow.resizeScale).toFixed(2)} · ${workflow.resizeMethod}`
      : `${workflow.resizeWidth} × ${workflow.resizeHeight} · ${workflow.resizeMethod}`;

  return (
    <ControlSection
      id="resize"
      title="Resize"
      summary={summary}
      forceOpen={f.active}
      action={<Switch checked={enabled} onCheckedChange={(on) => setWorkflow({ resizeEnabled: on })} ariaLabel="Enable resize" />}
    >
      <p className="px-0.5 pb-1 text-[11px] text-fg-muted">
        Resamples the finished image. No model, nothing invented — runs after the upscale model, so
        it can land a 4× result on an exact size.
      </p>
      <div className={cn('flex flex-col gap-2 transition-opacity', !enabled && 'pointer-events-none opacity-50')}>
        <Field label="Mode">
          <div className="flex min-w-0 flex-1 overflow-hidden rounded-lg border border-border-default">
            {([['factor', 'By factor'], ['size', 'Exact size']] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={(workflow.resizeMode ?? 'factor') === value}
                onClick={() => setWorkflow({ resizeMode: value })}
                className={cn(
                  'min-h-[40px] flex-1 text-[12px] font-medium transition-colors',
                  (workflow.resizeMode ?? 'factor') === value ? 'bg-accent text-white' : 'text-fg-muted hover:text-fg-secondary',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>

        {byFactor ? (
          <SliderRow
            label="Scale"
            value={workflow.resizeScale}
            onChange={(v) => setWorkflow({ resizeScale: v })}
            min={0.1} max={4} step={0.05}
            format={(v) => `${v.toFixed(2)}×`}
            defaultValue={2}
            hint={`${Math.round(workflow.width * workflow.resizeScale)} × ${Math.round(workflow.height * workflow.resizeScale)} from the base size — the real input is whatever the passes produced.`}
          />
        ) : (
          <>
            <SliderRow label="Width"  value={workflow.resizeWidth}  onChange={(v) => setWorkflow({ resizeWidth: Math.round(v) })}  min={64} max={4096} step={8} defaultValue={1536} />
            <SliderRow label="Height" value={workflow.resizeHeight} onChange={(v) => setWorkflow({ resizeHeight: Math.round(v) })} min={64} max={4096} step={8} defaultValue={1536}
              hint="Aspect is not preserved — both numbers are taken literally." />
          </>
        )}

        <Field label="Method">
          <Select
            value={workflow.resizeMethod ?? 'lanczos'}
            onValueChange={(v) => setWorkflow({ resizeMethod: v as typeof workflow.resizeMethod })}
            options={['lanczos', 'bicubic', 'bilinear', 'area', 'nearest-exact']}
            ariaLabel="Resize method"
          />
        </Field>
        <p className="px-0.5 text-[11px] text-fg-muted">
          lanczos is sharpest and the right default. area is kinder when shrinking a long way;
          nearest-exact keeps hard pixel edges, for pixel art.
        </p>
      </div>
    </ControlSection>
  );
}

export function RemoveBgSection() {
  const workflow = useStore(s => s.workflow);
  const setWorkflow = useStore(s => s.setWorkflow);
  const f = useControlFilter();
  if (!f.matches('remove background', 'background', 'rmbg', 'transparent', 'cutout', 'alpha')) return null;
  return (
    <ControlSection
      id="removebg"
      title="Remove background"
      summary={workflow.removeBg ? 'on' : 'off'}
      forceOpen={f.active}
      action={<Switch checked={workflow.removeBg} onCheckedChange={(on) => setWorkflow({ removeBg: on })} ariaLabel="Remove background" />}
    >
      <p className="px-0.5 text-[11px] text-fg-muted">
        Uses BRIA RMBG-1.4 (<code className="font-mono">BRIA_RMBG_Zho</code>). Output is RGBA — saved with transparent background.
      </p>
    </ControlSection>
  );
}

/**
 * Multi-pass section — replaces Hi-Res Fix. Each entry is a full sampling
 * pass that latent-upscales the previous output and resamples with its own
 * params. Empty list = single-pass (legacy behavior). Pass 1 is the base
 * Parameters tab; entries here are Pass 2, Pass 3, …
 */
export function PassesSection() {
  const workflow = useStore(s => s.workflow);
  const setWorkflow = useStore(s => s.setWorkflow);
  const passes = workflow.passes;
  const f = useControlFilter();

  const updatePass = (id: string, patch: Partial<Pass>) => {
    setWorkflow({ passes: passes.map(p => p.id === id ? { ...p, ...patch } : p) });
  };
  const removePass = (id: string) => {
    setWorkflow({ passes: passes.filter(p => p.id !== id) });
  };
  const addPass = () => {
    // First pass added → mirror Pass 1 (the Parameters tab) so the user
    // gets a sane starting point matching what they've already set.
    // Subsequent passes → carry from the last pass so adding Pass 4 after
    // Pass 3 doesn't reset the params the user just tuned.
    const prev = passes[passes.length - 1] ?? null;
    const fresh: Pass = prev
      ? { ...prev, id: uid(), on: true }
      : {
          id: uid(),
          sampler: workflow.sampler,
          scheduler: workflow.scheduler,
          steps: Number(workflow.steps) || 12,
          cfg: Number(workflow.cfg) || 8,
          seed: Math.trunc(Number(workflow.seed) || 0),
          randomizeSeed: !!workflow.randomizeSeed,
          denoise: Number(workflow.denoise),
          scale: 1.5,
          maxEdge: 2048,
          on: true,
        };
    setWorkflow({ passes: [...passes, fresh] });
  };

  return (
    <ControlSection
      id="passes"
      title="Passes"
      summary={passes.length
        ? passes.map((p, i) => `${i + 2}:${p.on === false ? 'off' : `${p.upscaleMode === 'model' ? 'img' : 'lat'} ×${Number(p.scale).toFixed(2)}`}`).join(' · ')
        : 'base only'}
      forceOpen={f.active}
    >
      <p className="px-1 text-[11px] text-fg-muted">
        Pass 1 uses the Parameters tab. Each pass below enlarges the previous
        output and resamples with its own params. <strong className="font-semibold text-fg-secondary">Latent</strong> is
        fast but softens edges; <strong className="font-semibold text-fg-secondary">Image</strong> decodes, runs a real
        upscaler and re-encodes, which keeps linework. Max output edge clamps
        the scale down silently to prevent runaway resolutions.
      </p>
      {(() => {
        // Best-effort starting dims: matches the same logic buildGraph uses so
        // the resolution preview the user sees matches what the server runs.
        let curW = workflow.width;
        let curH = workflow.height;
        if (workflow.inputImage) {
          const { width, height } = workflow.inputImage;
          const s = scaleForLongestEdge(width, height, workflow.inputMaxSize, workflow.inputMinSize);
          curW = Math.max(8, Math.round(width * s));
          curH = Math.max(8, Math.round(height * s));
        }
        return passes.map((pass, i) => {
          const bypassed = pass.on === false;
          const requested = Math.max(0.1, Number(pass.scale) || 1);
          const cap = Math.max(64, Number(pass.maxEdge) || 2048);
          const longEdge = Math.max(curW, curH);
          const effective = Math.min(requested, cap / longEdge);
          const inW = curW;
          const inH = curH;
          // Bypassed passes don't change the running dimensions — the next
          // active pass reads from whatever dims the previous active pass
          // produced (matching what buildGraph does).
          const outW = bypassed ? curW : Math.round(curW * effective);
          const outH = bypassed ? curH : Math.round(curH * effective);
          if (!bypassed) { curW = outW; curH = outH; }
          return (
            <PassCard
              key={pass.id}
              index={i + 2}
              pass={pass}
              inDims={{ w: inW, h: inH }}
              outDims={{ w: outW, h: outH }}
              effectiveScale={effective}
              onChange={(patch) => updatePass(pass.id, patch)}
              onRemove={() => removePass(pass.id)}
            />
          );
        });
      })()}
      <button
        type="button"
        onClick={addPass}
        className="self-start rounded-lg border border-dashed border-border-default px-3 py-2 text-[12px] font-medium text-fg-tertiary hover:border-accent hover:text-accent"
      >
        + Add pass
      </button>
    </ControlSection>
  );
}

/**
 * How a pass gets bigger: in latent space, or through a real upscaler in pixels.
 *
 * Latent is cheap and stays in the sampler's own space, but it interpolates values that only mean
 * something once decoded, so edges come back soft. Pixel upscaling decodes, runs an image model,
 * resizes and re-encodes — a VAE round trip for linework that survives. That is the difference
 * between a hi-res pass that adds detail and one that just adds blur, so it is stated on the card
 * rather than buried in a tooltip.
 */
function UpscaleModeRow({ index, pass, onChange }: {
  index: number;
  pass: Pass;
  onChange: (patch: Partial<Pass>) => void;
}) {
  const server = useStore(s => s.server);
  const upscaleAvail = useResourceAvailability('upscale');
  const models = Array.isArray(server.upscaleModels) ? server.upscaleModels : [];
  // Undefined means latent: passes saved before this control existed keep doing what they did.
  const mode = pass.upscaleMode === 'model' ? 'model' : 'latent';

  return (
    <>
      <Field label="Upscale">
        <div className="flex min-w-0 flex-1 overflow-hidden rounded-lg border border-border-default">
          {([['latent', 'Latent'], ['model', 'Image']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              title={value === 'latent'
                ? 'LatentUpscaleBy — fast, no VAE round trip, softens edges'
                : 'Decode → upscale model → resize → re-encode. Keeps linework, costs a VAE round trip'}
              onClick={() => onChange({
                upscaleMode: value,
                // Pick a model the first time, so switching to Image is not a dead end.
                ...(value === 'model' && !pass.upscaleModel && models[0] ? { upscaleModel: models[0] } : {}),
              })}
              className={cn(
                'min-h-[40px] flex-1 text-[12px] font-medium transition-colors',
                mode === value ? 'bg-accent text-white' : 'text-fg-muted hover:text-fg-secondary',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>

      {mode === 'model' && (
        models.length > 0 ? (
          <Field label="Model">
            <select
              aria-label={`Pass ${index} upscale model`}
              value={pass.upscaleModel || models[0]}
              onChange={(e) => onChange({ upscaleModel: e.target.value })}
              className="min-h-[40px] w-full min-w-0 flex-1 truncate rounded-lg border border-border-default bg-bg-input px-3 py-2 text-[13px] text-fg-secondary outline-none hover:border-border-strong focus:border-accent"
            >
              {models.map(m => {
                const a = upscaleAvail(m);
                return (
                  <option key={m} value={m} disabled={!a.enabled} title={availabilityHint(a)}>
                    {m}
                  </option>
                );
              })}
            </select>
          </Field>
        ) : (
          <p className="px-1 text-[11px] italic text-status-err">
            No upscale models on the server — this pass will fail. Drop one in{' '}
            <code className="font-mono">models/upscale_models/</code> or switch back to Latent.
          </p>
        )
      )}
    </>
  );
}

const MAX_EDGE_OPTIONS = (() => {
  const out: number[] = [];
  for (let v = 256; v <= 4096; v += 256) out.push(v);
  return out;
})();

function PassCard({ index, pass, inDims, outDims, effectiveScale, onChange, onRemove }: {
  index: number;
  pass: Pass;
  inDims: { w: number; h: number };
  outDims: { w: number; h: number };
  effectiveScale: number;
  onChange: (patch: Partial<Pass>) => void;
  onRemove: () => void;
}) {
  const clamped = effectiveScale + 0.001 < pass.scale;
  const maxEdgeOpts = MAX_EDGE_OPTIONS.map(v => `${v}`);
  // Keep the current value selectable even when it's not on the 256 grid
  // (e.g. carried over from the v6 → v7 migration default of 2048 — fine
  // — or set by a future caller).
  if (!maxEdgeOpts.includes(`${pass.maxEdge}`)) maxEdgeOpts.unshift(`${pass.maxEdge}`);
  const server = useStore(s => s.server);
  const samplerAvail = useResourceAvailability('sampler');
  const schedulerAvail = useResourceAvailability('scheduler');
  const samplerOpts = server.samplers.includes(pass.sampler)
    ? server.samplers : [pass.sampler, ...server.samplers];
  const schedulerOpts = server.schedulers.includes(pass.scheduler)
    ? server.schedulers : [pass.scheduler, ...server.schedulers];
  const bypassed = pass.on === false;
  return (
    <div className={cn(
      'flex flex-col gap-2 rounded-lg border border-border-default bg-bg-elev p-3 transition-opacity',
      bypassed && 'opacity-55',
    )}>
      <div className="flex items-center gap-2 px-1">
        <span className="text-[11px] font-semibold uppercase tracking-section text-fg-secondary">
          Pass {index}
        </span>
        {bypassed && (
          <span className="rounded bg-bg-input px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-tag text-fg-muted">
            Bypassed
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Switch
            checked={!bypassed}
            onCheckedChange={(on) => onChange({ on })}
            ariaLabel={bypassed ? `Enable Pass ${index}` : `Bypass Pass ${index}`}
          />
          <button
            type="button"
            aria-label={`Remove Pass ${index}`}
            title={`Remove Pass ${index}`}
            onClick={onRemove}
            className="flex h-6 w-6 items-center justify-center rounded text-fg-muted transition-colors hover:bg-status-err/15 hover:text-status-err"
          >
            <CloseIcon size={12} />
          </button>
        </div>
      </div>
      <div className={cn(bypassed && 'pointer-events-none', 'flex flex-col gap-2')}>
      <Field label="Sampler">
        <Select
          value={pass.sampler}
          onValueChange={(v) => onChange({ sampler: v })}
          options={samplerOpts}
          ariaLabel={`Pass ${index} sampler`}
          getOptionState={(v) => {
            const a = samplerAvail(v);
            return { disabled: !a.enabled, title: availabilityHint(a) };
          }}
        />
      </Field>
      <Field label="Scheduler">
        <Select
          value={pass.scheduler}
          onValueChange={(v) => onChange({ scheduler: v })}
          options={schedulerOpts}
          ariaLabel={`Pass ${index} scheduler`}
          getOptionState={(v) => {
            const a = schedulerAvail(v);
            return { disabled: !a.enabled, title: availabilityHint(a) };
          }}
        />
      </Field>
      <SliderRow label="Steps"   value={pass.steps}   onChange={(v) => onChange({ steps: v })}   min={1} max={200} />
      <SliderRow label="CFG"     value={pass.cfg}     onChange={(v) => onChange({ cfg: v })}     min={0} max={30} step={0.1} format={(v) => v.toFixed(1)} />
      <SliderRow label="Denoise" value={pass.denoise} onChange={(v) => onChange({ denoise: v })} min={0} max={1} step={0.01} format={(v) => v.toFixed(2)} />
      <UpscaleModeRow index={index} pass={pass} onChange={onChange} />
      <SliderRow label="Scale"   value={pass.scale}   onChange={(v) => onChange({ scale: v })}   min={1} max={4} step={0.05} format={(v) => `${v.toFixed(2)}×`} />
      <p className="-mt-1 px-1 text-[11px] text-fg-muted">
        {inDims.w}×{inDims.h} → <span className="text-fg-secondary">{outDims.w}×{outDims.h}</span>
        {clamped && (
          <span className="text-status-err"> · capped to ×{effectiveScale.toFixed(2)}</span>
        )}
      </p>
      <Field label="Max edge">
        <Select
          value={`${pass.maxEdge}`}
          onValueChange={(v) => onChange({ maxEdge: Number(v) })}
          options={maxEdgeOpts}
          ariaLabel={`Pass ${index} max edge`}
        />
        <span className="shrink-0 text-[11px] text-fg-muted">px</span>
      </Field>
      <Field label="Seed">
        <NumberInput value={pass.seed} onValueChange={(v) => onChange({ seed: v })} step={1} align="right" ariaLabel={`Pass ${index} seed`} />
        <button
          type="button"
          title="Randomize seed now"
          aria-label="Randomize seed now"
          onClick={() => onChange({ seed: Math.floor(Math.random() * 0xFFFFFFFF) })}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border-default bg-bg-base text-fg-tertiary hover:border-border-strong hover:text-fg-secondary"
        >
          <ResetIcon size={16} />
        </button>
        <button
          type="button"
          title={pass.randomizeSeed ? 'Auto-randomize this pass every generate (on)' : 'Auto-randomize this pass every generate (off)'}
          aria-label="Auto-randomize seed on every generate"
          aria-pressed={pass.randomizeSeed}
          onClick={() => onChange({ randomizeSeed: !pass.randomizeSeed })}
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-colors',
            pass.randomizeSeed
              ? 'border-accent bg-accent-soft text-accent-fg'
              : 'border-border-default bg-bg-base text-fg-tertiary hover:border-border-strong hover:text-fg-secondary',
          )}
        >
          <DiceIcon size={16} filled={pass.randomizeSeed} />
        </button>
      </Field>
      </div>
    </div>
  );
}
