/**
 * One numeric parameter, built for a thumb.
 *
 * The old row was `label(70px) · slider · value`, which on a phone left the slider about 150px of
 * travel to cover 1–200 steps — every value a fight, and no way to type an exact one. This stacks
 * instead: the name and its value on top, the slider across the full width underneath. Same
 * information, roughly three times the travel, and the value itself became the input.
 *
 * What the row can do, all without leaving it:
 *   - drag the slider, with a thumb big enough to find
 *   - tap the value and type an exact one
 *   - nudge one step at a time with − / +, for when a pixel of travel is too coarse
 *   - reset to the default, offered only once the value is actually off it
 *
 * Nothing is hidden behind a menu: every affordance is a visible control on the row.
 */
import { useEffect, useRef, useState } from 'react';
import { Slider } from '@/components/ui/Slider';
import { cn } from '@/lib/cn';
import { ResetIcon } from '@/components/ui/icons';

export interface ParamRowProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  /** How the value reads. Defaults to the plain number. */
  format?: (v: number) => string;
  /** The value the reset button goes back to. Omit to hide reset entirely. */
  defaultValue?: number;
  /** Short note under the row — units, a warning, a computed result. */
  hint?: React.ReactNode;
  /** Dimmed and non-interactive, for a bypassed pass. */
  disabled?: boolean;
}

export function ParamRow({
  label, value, onChange, min, max, step = 1, format, defaultValue, hint, disabled,
}: ParamRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => { if (editing) input.current?.select(); }, [editing]);

  const shown = format ? format(value) : String(value);
  const changed = defaultValue != null && Math.abs(value - defaultValue) > 1e-9;

  const commit = () => {
    const n = Number(draft);
    setEditing(false);
    if (!Number.isFinite(n)) return;
    // Typing is the way past a slider's range when a workflow legitimately wants more, so the
    // typed value is only clamped to the hard min — never to the slider's cosmetic max.
    onChange(Math.max(min, n));
  };

  // Steppers land on clean multiples of `step` rather than drifting off the grid: 0.6 + 0.05
  // repeated is how you end up with 0.6500000000000001 in a prompt.
  const nudge = (dir: 1 | -1) => {
    const next = Math.round((value + step * dir) / step) * step;
    const decimals = (String(step).split('.')[1] ?? '').length;
    onChange(Math.min(max, Math.max(min, Number(next.toFixed(decimals)))));
  };

  return (
    <div className={cn('flex flex-col gap-1 py-1', disabled && 'pointer-events-none opacity-55')}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-secondary">{label}</span>

        {changed && (
          <button
            type="button"
            onClick={() => onChange(defaultValue!)}
            aria-label={`Reset ${label}`}
            title={`Reset to ${format ? format(defaultValue!) : defaultValue}`}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:text-fg-secondary"
          >
            <ResetIcon size={12} />
          </button>
        )}

        {editing ? (
          <input
            ref={input}
            // `decimal` rather than `numeric`: a step of 0.05 needs a dot on the phone keypad.
            inputMode={step < 1 ? 'decimal' : 'numeric'}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setEditing(false);
            }}
            aria-label={label}
            className="h-9 w-24 shrink-0 rounded-md border border-accent bg-bg-input px-2 text-right text-[13px] font-medium tabular-nums text-fg-primary outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => { setDraft(String(value)); setEditing(true); }}
            title="Tap to type an exact value"
            aria-label={`${label}: ${shown}. Tap to type an exact value`}
            className={cn(
              'h-9 min-w-[64px] shrink-0 rounded-md border px-2 text-right text-[13px] font-medium tabular-nums transition-colors',
              changed
                ? 'border-accent/50 bg-accent-soft text-accent-fg'
                : 'border-border-default bg-bg-input text-fg-secondary hover:border-border-strong',
            )}
          >
            {shown}
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <StepButton label={`Decrease ${label}`} onClick={() => nudge(-1)} disabled={value <= min}>−</StepButton>
        <Slider
          value={Math.min(max, Math.max(min, value))}
          onValueChange={onChange}
          min={min}
          max={max}
          step={step}
          ariaLabel={label}
          className="flex-1"
        />
        <StepButton label={`Increase ${label}`} onClick={() => nudge(1)} disabled={value >= max}>+</StepButton>
      </div>

      {hint && <p className="px-0.5 text-[11px] text-fg-muted">{hint}</p>}
    </div>
  );
}

/** A 36px square is the smallest thing a thumb hits reliably; the glyph is only the hint. */
function StepButton({ label, onClick, disabled, children }: {
  label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border-default',
        'bg-bg-elev text-[15px] leading-none text-fg-tertiary transition-colors',
        'hover:border-border-strong hover:text-fg-secondary disabled:opacity-30',
      )}
    >
      {children}
    </button>
  );
}
