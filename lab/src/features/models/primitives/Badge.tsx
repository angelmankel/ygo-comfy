import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { ModelKind } from '../types';
import { KIND_ACCENT, KIND_LABEL } from '../kindMeta';

/** Short kind badge — "CKPT" / "LORA" / "VAE" / "CN", colored by kind. */
export function KindBadge({ kind, className }: { kind: ModelKind; className?: string }) {
  const a = KIND_ACCENT[kind];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-tag',
        a.soft,
        a.fg,
        className,
      )}
    >
      {KIND_LABEL[kind].badge}
    </span>
  );
}

/** Neutral count / meta badge. */
export function CountBadge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded bg-bg-elev px-1.5 py-0.5 text-[10px] font-medium text-fg-muted',
        className,
      )}
    >
      {children}
    </span>
  );
}

type ChipTone = 'neutral' | 'accent' | 'ok' | 'warn';

/** Generic pill chip. `tone` picks the color scheme. */
export function Chip({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: ChipTone;
  className?: string;
}) {
  const tones: Record<ChipTone, string> = {
    neutral: 'bg-bg-elev text-fg-tertiary',
    accent: 'bg-accent-soft text-accent-fg',
    ok: 'bg-vae-soft text-vae-fg',
    warn: 'bg-coral-bg text-coral-fg',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
