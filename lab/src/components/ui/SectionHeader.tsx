import type { ReactNode } from 'react';

type Props = {
  label: string;
  count?: number;
  right?: ReactNode;
};

export function SectionHeader({ label, count, right }: Props) {
  return (
    <div className="flex items-center gap-2 px-1">
      <span className="text-[10px] font-semibold uppercase tracking-section text-fg-dim">{label}</span>
      {count != null && (
        <span className="rounded bg-bg-elev px-1.5 py-0.5 text-[10px] font-medium text-fg-muted">
          {count}
        </span>
      )}
      {right && <div className="ml-auto flex items-center gap-1">{right}</div>}
    </div>
  );
}

export function AddButton({ label = 'Add', onClick }: { label?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 items-center gap-1 rounded-lg border border-border-default bg-bg-elev px-3 text-[12px] font-medium text-fg-tertiary transition-colors hover:border-border-strong hover:text-fg-secondary"
    >
      <span className="text-[15px] leading-none text-fg-muted">+</span>
      <span>{label}</span>
    </button>
  );
}
