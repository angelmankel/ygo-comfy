import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { CloseIcon } from '@/components/ui/icons';
import { useShortcut, ShortcutPriority } from '@/hooks/useShortcut';

/**
 * Generic, controlled modal base.
 *
 * Renders a portal + dimmed backdrop + centered panel. Escape and backdrop
 * clicks both call `onClose`. The panel is otherwise an empty shell — compose
 * its contents with the `Modal.*` slot components below, or pass arbitrary
 * children. Concrete modals (e.g. the model-metadata modal) live in their own
 * folders and only use this for the shell.
 */

type ModalContextValue = { onClose: () => void };
const ModalContext = createContext<ModalContextValue | null>(null);

function useModalContext(component: string): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error(`<Modal.${component}> must be rendered inside <Modal>`);
  return ctx;
}

type ModalProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Extra classes for the panel — set width / max-width here. */
  panelClassName?: string;
  /** id of the element that labels the dialog, for a11y. */
  labelledBy?: string;
};

function ModalRoot({ open, onClose, children, panelClassName, labelledBy }: ModalProps) {
  // Top overlay priority — when a confirm dialog opens on top of a modal,
  // Esc dismisses the confirm first (its priority is also TopOverlay but
  // mounted later — last-in-first-out for equal priorities is fine here
  // because we call `break` after the first handler).
  useShortcut('Escape', () => { if (open) onClose(); }, {
    priority: ShortcutPriority.TopOverlay,
    when: () => open,
  });

  if (!open) return null;

  return createPortal(
    <ModalContext.Provider value={{ onClose }}>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
        {/* Backdrop covers the whole viewport (including the padding gutter), so
            a mousedown anywhere outside the panel closes. mousedown — not click —
            so a drag that starts inside the panel and releases here doesn't. */}
        <div
          className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          aria-hidden
          onMouseDown={onClose}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          className={cn(
            'relative z-10 flex max-h-[90vh] overflow-hidden rounded-2xl',
            'border border-border-default bg-bg-panel shadow-[0_30px_90px_rgba(0,0,0,0.7)]',
            panelClassName,
          )}
        >
          {children}
        </div>
      </div>
    </ModalContext.Provider>,
    document.body,
  );
}

/** Close button wired to the modal's `onClose`. */
function ModalClose({ className }: { className?: string }) {
  const { onClose } = useModalContext('Close');
  return (
    <button
      type="button"
      aria-label="Close"
      onClick={onClose}
      className={cn(
        'flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border border-border-default',
        'bg-bg-elev text-fg-tertiary outline-none transition-colors',
        'hover:border-border-strong hover:text-fg-secondary focus-visible:border-accent',
        className,
      )}
    >
      <CloseIcon size={14} />
    </button>
  );
}

/** A vertical column inside the panel — header / scrollable body / footer rhythm. */
function ModalColumn({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex min-h-0 min-w-0 flex-col', className)}>{children}</div>;
}

function ModalHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('shrink-0 border-b border-border-subtle px-5 py-4', className)}>{children}</div>
  );
}

function ModalBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('scroll-y min-h-0 flex-1 px-5 py-4', className)}>{children}</div>;
}

function ModalFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('shrink-0 border-t border-border-subtle bg-bg-base/40 px-5 py-3.5', className)}>
      {children}
    </div>
  );
}

export const Modal = Object.assign(ModalRoot, {
  Close: ModalClose,
  Column: ModalColumn,
  Header: ModalHeader,
  Body: ModalBody,
  Footer: ModalFooter,
});
