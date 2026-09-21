import * as RPopover from '@radix-ui/react-popover';
import { useStore } from '@/lib/store';
import { RESOLUTION_PRESETS } from '@/lib/storage';
import { fireFromStore } from './GenerateButton';
import { RoutingPicker } from './RoutingPicker';
import { Field } from '@/components/ui/Field';
import { Slider } from '@/components/ui/Slider';
import { NumberInput } from '@/components/ui/NumberInput';
import { Select } from '@/components/ui/Select';
import { cn } from '@/lib/cn';
import {
  GenerateIcon, KeyboardCommandIcon, KeyboardEnterIcon, ChevronDownIcon,
  TuneIcon, ResetIcon, DiceIcon,
} from '@/components/ui/icons';

/**
 * Compact generate widget shown in the top floating nav when the left panel
 * is collapsed. Mirrors <GenerateButton>'s queue + routing affordances and
 * adds a small popover with the most-used params (seed, steps, CFG, size).
 */
export function GenerateWidget() {
  return (
    <div className="flex items-center gap-1.5">
      <div className="btn-glow flex overflow-hidden rounded-md">
        <button
          type="button"
          onClick={fireFromStore}
          className="flex min-h-[36px] items-center gap-1.5 bg-accent px-3 text-[12px] font-semibold text-white transition-colors hover:bg-accent-hover"
        >
          <GenerateIcon size={13} />
          <span>Generate</span>
          <span className="ml-1 flex items-center gap-0.5 rounded bg-white/15 px-1 py-0.5">
            <KeyboardCommandIcon size={10} />
            <KeyboardEnterIcon size={10} />
          </span>
        </button>
        <RoutingPicker variant="sm" align="start" />
      </div>

      <RPopover.Root>
        <RPopover.Trigger asChild>
          <button
            type="button"
            title="Quick params"
            aria-label="Quick params"
            className="flex min-h-[36px] items-center gap-1 rounded-md border border-border-default bg-bg-elev/80 px-2 text-fg-secondary backdrop-blur hover:border-border-strong focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <TuneIcon size={14} />
            <ChevronDownIcon size={10} />
          </button>
        </RPopover.Trigger>
        <RPopover.Portal>
          <RPopover.Content
            align="start"
            sideOffset={6}
            className="z-50 w-[320px] overflow-hidden rounded-lg border border-border-default bg-bg-elev shadow-xl"
          >
            <div className="border-b border-border-subtle px-3 py-2 text-[10px] font-semibold uppercase tracking-section text-fg-tertiary">
              Quick params
            </div>
            <div className="px-3 py-3">
              <QuickParams />
            </div>
          </RPopover.Content>
        </RPopover.Portal>
      </RPopover.Root>
    </div>
  );
}

function QuickParams() {
  const workflow = useStore(s => s.workflow);
  const setWorkflow = useStore(s => s.setWorkflow);

  const current = `${workflow.width} × ${workflow.height}`;
  const presetLabels = RESOLUTION_PRESETS.map(([w, h]) => `${w} × ${h}`);
  const sizeOptions = presetLabels.includes(current) ? presetLabels : [current, ...presetLabels];

  return (
    <div className="flex flex-col gap-2">
      <Field label="Steps">
        <Slider value={workflow.steps} onValueChange={(v) => setWorkflow({ steps: v })} min={1} max={200} ariaLabel="Steps" />
        <span className="w-10 shrink-0 text-right text-[12px] font-medium tabular-nums text-fg-secondary">
          {workflow.steps}
        </span>
      </Field>
      <Field label="CFG">
        <Slider value={workflow.cfg} onValueChange={(v) => setWorkflow({ cfg: v })} min={0} max={30} step={0.1} ariaLabel="CFG" />
        <span className="w-10 shrink-0 text-right text-[12px] font-medium tabular-nums text-fg-secondary">
          {workflow.cfg.toFixed(1)}
        </span>
      </Field>
      <Field label="Seed">
        <NumberInput value={workflow.seed} onValueChange={(v) => setWorkflow({ seed: v })} step={1} align="right" ariaLabel="Seed" />
        <button
          type="button"
          title="Randomize seed now"
          aria-label="Randomize seed now"
          onClick={() => setWorkflow({ seed: Math.floor(Math.random() * 0xFFFFFFFF) })}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border-default bg-bg-elev text-fg-tertiary hover:border-border-strong hover:text-fg-secondary"
        >
          <ResetIcon size={14} />
        </button>
        <button
          type="button"
          title={workflow.randomizeSeed ? 'Auto-randomize seed on every generate (on)' : 'Auto-randomize seed on every generate (off)'}
          aria-label="Auto-randomize seed on every generate"
          aria-pressed={workflow.randomizeSeed}
          onClick={() => setWorkflow({ randomizeSeed: !workflow.randomizeSeed })}
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors',
            workflow.randomizeSeed
              ? 'border-accent bg-accent-soft text-accent-fg'
              : 'border-border-default bg-bg-elev text-fg-tertiary hover:border-border-strong hover:text-fg-secondary',
          )}
        >
          <DiceIcon size={14} filled={workflow.randomizeSeed} />
        </button>
      </Field>
      <Field label="Size">
        <Select
          value={current}
          onValueChange={(v) => {
            const m = v.match(/(\d+)\s*×\s*(\d+)/);
            if (m) setWorkflow({ width: Number(m[1]), height: Number(m[2]) });
          }}
          options={sizeOptions}
          ariaLabel="Output size"
        />
      </Field>
    </div>
  );
}
