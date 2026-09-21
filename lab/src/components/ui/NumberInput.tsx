import { cn } from '@/lib/cn';
import { useEffect, useState } from 'react';

type Props = {
  value: number;
  onValueChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  align?: 'left' | 'right';
  className?: string;
  ariaLabel?: string;
};

/**
 * Local-edit number input that commits on blur or Enter, so typing partial
 * values like "1." doesn't immediately get reset by NaN-clamping.
 */
export function NumberInput({ value, onValueChange, step = 1, min, max, align = 'right', className, ariaLabel }: Props) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n)) { setDraft(String(value)); return; }
    let v = n;
    if (min != null && v < min) v = min;
    if (max != null && v > max) v = max;
    onValueChange(v);
    setDraft(String(v));
  };
  return (
    <input
      type="number"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      step={step}
      min={min}
      max={max}
      aria-label={ariaLabel}
      className={cn(
        'min-w-0 flex-1 rounded-lg border border-border-default bg-bg-input px-3 py-2.5',
        'text-[13px] font-medium text-fg-secondary outline-none tabular-nums',
        'hover:border-border-strong focus:border-accent',
        align === 'right' && 'text-right',
        className,
      )}
    />
  );
}
