import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

type Props = {
  pressed: boolean;
  onPressedChange: (next: boolean) => void;
  ariaLabel?: string;
  title?: string;
  /** Active state tint — both background and text use this colour family. */
  accent?: 'accent' | 'coral' | 'neutral';
  size?: 'sm' | 'md';
  className?: string;
  children: ReactNode;
};

/**
 * Two-state toggle button. Visually distinct from the `Switch` track style:
 * a square chip that fills with the accent colour when pressed. Used on layer
 * cards in place of the previous slider switch.
 */
export function ToggleButton({
  pressed, onPressedChange, ariaLabel, title, accent = 'accent', size = 'md', className, children,
}: Props) {
  const dims = size === 'sm' ? 'h-7 px-2 text-[10px]' : 'h-8 px-2.5 text-[11px]';
  const palette = accent === 'coral'
    ? {
        on: 'bg-coral-bg text-coral-fg border-coral-fg/30',
        off: 'bg-bg-input text-fg-dim border-border-default hover:border-border-strong',
      }
    : accent === 'accent'
      ? {
          on: 'bg-accent text-white border-accent shadow-[0_0_0_1px_rgba(79,138,255,0.35)]',
          off: 'bg-bg-input text-fg-dim border-border-default hover:border-border-strong',
        }
      : {
          on: 'bg-bg-card-on text-fg-secondary border-border-strong',
          off: 'bg-bg-input text-fg-dim border-border-default hover:border-border-strong',
        };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={pressed}
      aria-label={ariaLabel}
      title={title}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1 rounded-md border font-semibold uppercase tracking-tag outline-none transition-colors',
        dims,
        pressed ? palette.on : palette.off,
        className,
      )}
    >
      {children}
    </button>
  );
}
