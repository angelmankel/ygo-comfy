/**
 * The model kit and the input image, brought into the same shell as every other control.
 *
 * ModelStack and InputImageSection have their own internals and are left alone; what they were
 * missing was membership. Before this they were the only things on the Parameters tab that did not
 * fold, did not summarise themselves and ignored the search entirely — typing "cfg" left the
 * checkpoint, VAE and LoRA blocks sitting there, which is exactly the kind of inconsistency that
 * makes a panel feel complicated. Wrapping from the outside gives them the card, the summary, the
 * fold and the filter without touching a line of how they work.
 */
import { useStore } from '@/lib/store';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ModelStack } from '@/features/models';
import { InputImageSection } from '@/features/inputImage';
import { ControlSection } from './ControlSection';
import { useControlFilter } from './ControlFilter';

/** Just the filename, so a summary is readable at a glance. */
const shortName = (f: string) => f.replace(/\.(safetensors|ckpt|pt|pth|bin)$/i, '').replace(/^.*[\\/]/, '');

export function ModelsSection() {
  const workflow = useStore(s => s.workflow);
  const f = useControlFilter();

  const base = workflow.checkpoints[0]?.name;
  const loraNames = workflow.loras.map(l => l.name);
  if (!f.matches('models', 'checkpoint', 'ckpt', 'vae', 'lora', 'loras', 'merge',
                 base, workflow.vae, ...loraNames)) return null;

  const parts = [
    base ? shortName(base) : 'no checkpoint',
    workflow.checkpoints.length > 1 ? `+${workflow.checkpoints.length - 1} merged` : null,
    workflow.vae ? shortName(workflow.vae) : null,
    workflow.loras.length ? `${workflow.loras.length} LoRA${workflow.loras.length === 1 ? '' : 's'}` : null,
  ].filter(Boolean);

  return (
    <ControlSection id="models" title="Models" summary={parts.join(' · ')} forceOpen={f.active}>
      <ErrorBoundary label="Models"><ModelStack /></ErrorBoundary>
    </ControlSection>
  );
}

export function InputImageControlSection() {
  const workflow = useStore(s => s.workflow);
  const f = useControlFilter();
  if (!f.matches('input image', 'image', 'img2img', 'source', 'reference', 'denoise')) return null;

  const img = workflow.inputImage;
  return (
    <ControlSection
      id="inputimage"
      title="Input image"
      summary={img ? `${img.width} × ${img.height} · img2img on` : 'none · txt2img'}
      // Nothing is set and nothing is being searched for: this is the one section that is usually
      // irrelevant, so it starts folded. The summary still says so, and one tap opens it.
      defaultCollapsed={!img}
      forceOpen={f.active}
    >
      <ErrorBoundary label="Input image"><InputImageSection /></ErrorBoundary>
    </ControlSection>
  );
}
