import * as RDialog from '@radix-ui/react-dialog';
import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title?: string;
  children: ReactNode;
  className?: string;
};

export function Dialog({ open, onOpenChange, title, children, className }: Props) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-20 bg-black/55 data-[state=open]:animate-in data-[state=open]:fade-in" />
        <RDialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2',
            'w-[min(92vw,420px)] rounded-xl border border-border-strong bg-bg-elev px-5 py-4 text-fg-secondary shadow-2xl outline-none',
            className,
          )}
        >
          {title && (
            <RDialog.Title className="mb-3 text-[10px] font-semibold uppercase tracking-section text-fg-tertiary">
              {title}
            </RDialog.Title>
          )}
          {children}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
