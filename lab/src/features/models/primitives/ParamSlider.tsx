import * as RSlider from '@radix-ui/react-slider';
import { cn } from '@/lib/cn';
import type { ModelKind } from '../types';
import { KIND_ACCENT } from '../kindMeta';

type Props = {
  label: string;
  value: number;
  onValueChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Formats the numeric readout; defaults to 2 decimal places. */
  format?: (v: number) => string;
  /** Tints the slider range/thumb to the model kind. Defaults to checkpoint/accent. */
  kind?: ModelKind;
};

/**
 * Labeled single-value slider row — the generic param control used by LoRA
 * strength, ControlNet weight, etc. Range color follows the model kind.
 */
export function ParamSlider({
  label,
  value,
  onValueChange,
  min,
  max,
  step = 0.05,
  format,
  kind = 'checkpoint',
}: Props) {
  const a = KIND_ACCENT[kind];
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-[88px] shrink-0 text-[11px] font-medium text-fg-muted">{label}</span>
      <RSlider.Root
        value={[value]}
        onValueChange={([v]) => onValueChange(v)}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        className="relative flex h-7 flex-1 items-center select-none touch-none"
      >
        <RSlider.Track className="relative h-1.5 flex-1 rounded-full bg-border-default">
          <RSlider.Range className={cn('absolute h-full rounded-full', a.range)} />
        </RSlider.Track>
        <RSlider.Thumb
          className={cn(
            'block h-4 w-4 cursor-pointer rounded-full bg-white shadow-md outline-none focus-visible:ring-2',
            a.ring,
          )}
        />
      </RSlider.Root>
      <span className="w-11 shrink-0 text-right text-[12px] font-semibold tabular-nums text-fg-secondary">
        {format ? format(value) : value.toFixed(2)}
      </span>
    </div>
  );
}
