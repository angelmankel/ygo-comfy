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
      // `touch-pan-y`, not `touch-none`. The root spans the whole row, and `touch-none` on it tells
      // the browser to hand every touch to the page instead of scrolling — which was survivable
      // while sliders were small and rare, and killed scrolling outright once every parameter row
      // had a full-width one. `pan-y` keeps vertical scrolling with the browser and still delivers
      // the horizontal drag to the thumb, which is the only direction this control cares about.
      className={cn('relative flex h-9 flex-1 items-center select-none touch-pan-y', className)}
    >
      <RSlider.Track className="relative h-1.5 flex-1 rounded-full bg-border-default">
        <RSlider.Range className="absolute h-full rounded-full bg-accent" />
      </RSlider.Track>
      <RSlider.Thumb
        className={cn(
          // The thumb itself keeps `touch-none`: once a finger is on it, the drag belongs to the
          // slider in both axes and must not also scroll the panel.
          'block h-5 w-5 touch-none rounded-full bg-white shadow-md',
          'outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
          'cursor-pointer',
        )}
      />
    </RSlider.Root>
  );
}
