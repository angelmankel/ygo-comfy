import type { ReactNode } from 'react';

/** Small header used inside Settings tabs to group related fields. */
export function FieldGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-[10px] font-semibold uppercase tracking-section text-fg-tertiary">{title}</h3>
      {children}
    </section>
  );
}
