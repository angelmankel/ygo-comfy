import * as RSlider from '@radix-ui/react-slider';
import { cn } from '@/lib/cn';

type Props = {
  value: number;
  onValueChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  className?: string;
  ariaLabel?: string;
};

export function Slider({ value, onValueChange, min, max, step = 1, className, ariaLabel }: Props) {
  return (
    <RSlider.Root
      value={[value]}
      onValueChange={([v]) => onValueChange(v)}
      min={min}
      max={max}
      step={step}
      aria-label={ariaLabel}
      className={cn('relative flex h-9 flex-1 items-center select-none touch-none', className)}
    >
      <RSlider.Track className="relative h-1.5 flex-1 rounded-full bg-border-default">
        <RSlider.Range className="absolute h-full rounded-full bg-accent" />
      </RSlider.Track>
      <RSlider.Thumb
        className={cn(
          'block h-5 w-5 rounded-full bg-white shadow-md',
          'outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
          'cursor-pointer',
        )}
      />
    </RSlider.Root>
  );
}
