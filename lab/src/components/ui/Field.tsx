import type { ReactNode } from 'react';

/**
 * One row in a settings section: a 70px label on the left, a flexible control on the right.
 */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[40px] items-center gap-2.5">
      <label className="w-[70px] shrink-0 text-[12px] text-fg-muted">{label}</label>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </div>
  );
}
