import * as RTooltip from '@radix-ui/react-tooltip';
import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RTooltip.Provider delayDuration={400}>{children}</RTooltip.Provider>;
}

type TipProps = {
  label: string;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
};

export function Tip({ label, children, side = 'top', className }: TipProps) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={6}
          className={cn(
            'z-50 rounded-md border border-border-default bg-bg-elev px-2 py-1 text-[10px] text-fg-secondary shadow-lg',
            className,
          )}
        >
          {label}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}
