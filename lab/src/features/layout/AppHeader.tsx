import { IconButton } from '@/components/ui/IconButton';

type Props = {
  onOpenSettings: () => void;
};

export function AppHeader({ onOpenSettings }: Props) {
  return (
    <header className="flex items-center gap-2.5 px-4 py-3 bg-bg-panel border-b border-border-subtle">
      <div className="relative h-7 w-7 rounded-lg bg-accent shadow-[0_0_10px_rgba(79,138,255,0.4)]">
        <div className="absolute left-1.5 top-1.5 h-2 w-2 rounded-sm bg-white/95" />
        <div className="absolute left-3.5 top-3.5 h-2 w-2 rounded-sm bg-white/45" />
      </div>
      <div className="flex flex-1 flex-col leading-tight">
        <span className="text-[13px] font-semibold text-fg-primary">Image Lab</span>
        <span className="text-[9px] font-medium uppercase tracking-[0.06em] text-fg-dim">GPU · v1.0</span>
      </div>
      <IconButton aria-label="Settings" onClick={onOpenSettings}>
        <span className="text-[12px]">⚙</span>
      </IconButton>
    </header>
  );
}
