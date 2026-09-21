import type { ModelKind } from './types';

/**
 * Per-kind display metadata. Kept out of `types.ts` so the type layer stays
 * free of Tailwind class strings. The colors resolve to the `--color-lora/vae`
 * tokens in the `@theme` block (checkpoint reuses `--color-accent`).
 */

export const KIND_LABEL: Record<ModelKind, { group: string; badge: string }> = {
  checkpoint: { group: 'Checkpoint', badge: 'CKPT' },
  lora: { group: 'LoRAs', badge: 'LORA' },
  vae: { group: 'VAE', badge: 'VAE' },
};

/** Tailwind class fragments for a kind's accent — used by badges, cards, sliders. */
export type KindAccent = {
  /** accent text color */
  fg: string;
  /** soft accent background (badges, chips) */
  soft: string;
  /** left-border accent for cards */
  borderL: string;
  /** filled slider-range color */
  range: string;
  /** focus ring color */
  ring: string;
};

export const KIND_ACCENT: Record<ModelKind, KindAccent> = {
  checkpoint: { fg: 'text-accent-fg', soft: 'bg-accent-soft', borderL: 'border-l-accent', range: 'bg-accent', ring: 'ring-accent/60' },
  lora: { fg: 'text-lora-fg', soft: 'bg-lora-soft', borderL: 'border-l-lora', range: 'bg-lora', ring: 'ring-lora/60' },
  vae: { fg: 'text-vae-fg', soft: 'bg-vae-soft', borderL: 'border-l-vae', range: 'bg-vae', ring: 'ring-vae/60' },
};
