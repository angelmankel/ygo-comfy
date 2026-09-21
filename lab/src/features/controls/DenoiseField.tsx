import { useStore } from '@/lib/store';
import { Field } from '@/components/ui/Field';
import { Slider } from '@/components/ui/Slider';

/**
 * Denoise slider for img2img / inpaint pipelines. Reads + writes
 * `workflow.inputDenoise` on the global store.
 *
 * Hosted in three places today:
 *   - Left panel Parameters tab, in layer scope when fillMode is
 *     `txt2img` or `img2img` (see LeftPanel.tsx).
 *   - Right panel Selected Layer → Inpaint section when fillMode is
 *     `inpaint` (see InpaintSection.tsx).
 *   - Global non-layer-scope img2img inside InputImageSection.
 *
 * Standalone so the next move — surfacing it as a floating control under
 * the selected layer's bounds on the canvas — is a single new render site,
 * not a rewrite.
 */
export function DenoiseField({ label = 'Denoise' }: { label?: string }) {
  const inputDenoise = useStore(s => s.workflow.inputDenoise);
  const setWorkflow = useStore(s => s.setWorkflow);
  return (
    <Field label={label}>
      <Slider
        value={inputDenoise}
        onValueChange={(v) => setWorkflow({ inputDenoise: v })}
        min={0}
        max={1}
        step={0.01}
        ariaLabel="Denoise"
      />
      <span className="w-12 shrink-0 text-right text-[12px] font-medium tabular-nums text-fg-secondary">
        {inputDenoise.toFixed(2)}
      </span>
    </Field>
  );
}
