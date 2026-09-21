import * as RSlider from '@radix-ui/react-slider';
import { useStore } from '@/lib/store';

/**
 * N-way checkpoint merge control — appears when `workflow.checkpoints` has 2+
 * entries. One ratio slider per non-base checkpoint; each ratio is the blend
 * applied as that checkpoint's UNet is chained into the base via
 * ModelMergeSimple. CLIP + VAE always come from the base checkpoint.
 */
export function CheckpointMergeBox() {
  const checkpoints = useStore((s) => s.workflow.checkpoints);
  const updateCheckpoint = useStore((s) => s.updateCheckpoint);

  if (checkpoints.length < 2) return null;
  const base = checkpoints[0];
  const extras = checkpoints.slice(1);

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border-default bg-bg-card p-2.5">
      <div className="flex items-center gap-2">
        <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-tag text-accent-fg">
          Merge
        </span>
        <span className="text-[11px] text-fg-muted">
          {checkpoints.length} checkpoints · ModelMergeSimple ×{extras.length}
        </span>
      </div>
      {extras.map((ckpt) => (
        <div key={ckpt.id} className="flex items-center gap-2.5">
          <span
            className="min-w-0 flex-1 truncate text-[11px] font-medium text-fg-tertiary"
            title={ckpt.name}
          >
            {ckpt.name}
          </span>
          <RSlider.Root
            value={[ckpt.ratio]}
            onValueChange={([v]) => updateCheckpoint(ckpt.id, { ratio: v })}
            min={0}
            max={1}
            step={0.01}
            aria-label={`${ckpt.name} merge ratio`}
            className="relative flex h-7 w-[136px] shrink-0 items-center select-none touch-none"
          >
            <RSlider.Track className="relative h-1.5 flex-1 rounded-full bg-border-default">
              <RSlider.Range className="absolute h-full rounded-full bg-accent" />
            </RSlider.Track>
            <RSlider.Thumb className="block h-4 w-4 cursor-pointer rounded-full bg-white shadow-md outline-none focus-visible:ring-2 focus-visible:ring-accent/60" />
          </RSlider.Root>
          <span className="w-9 shrink-0 text-right text-[11px] font-semibold tabular-nums text-fg-secondary">
            {ckpt.ratio.toFixed(2)}
          </span>
        </div>
      ))}
      <p className="text-[10px] text-fg-dim">
        Each ratio blends that checkpoint into <span className="text-fg-tertiary">{base.name}</span> (the base).
      </p>
    </div>
  );
}
