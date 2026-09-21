import type { ReactNode } from 'react';

/** Shared labeled section wrapper used throughout the metadata column. */
export function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-section text-fg-dim">{label}</span>
      {children}
    </section>
  );
}
