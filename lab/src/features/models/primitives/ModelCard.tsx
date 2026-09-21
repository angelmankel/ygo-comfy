import { createContext, useContext, type MouseEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { ModelKind } from '../types';
import { KIND_ACCENT } from '../kindMeta';
import { KindBadge } from './Badge';
import { PreviewThumb } from './PreviewThumb';
import { ChevronDownIcon, ChevronRightIcon, CloseIcon } from '@/components/ui/icons';

/**
 * Compound card shell shared by every concrete model-type component.
 *
 *   <ModelCard kind="lora" onOpen={openMetadata}>
 *     <ModelCard.Preview src={thumb} />
 *     <ModelCard.Body>
 *       <ModelCard.Header title={name} subtitle="LoRA" onRemove={remove} />
 *       <ModelCard.Params>{...sliders...}</ModelCard.Params>
 *     </ModelCard.Body>
 *   </ModelCard>
 *
 * Clicking the card calls `onOpen` (used to launch the metadata modal). Clicks
 * inside `<ModelCard.Params>` and on the header action buttons stop bubbling,
 * so editing a parameter never opens the modal.
 */

type CardCtx = { kind: ModelKind };
const Ctx = createContext<CardCtx | null>(null);
const useCard = (part: string): CardCtx => {
  const v = useContext(Ctx);
  if (!v) throw new Error(`<ModelCard.${part}> must be used inside <ModelCard>`);
  return v;
};

/** Wrap a handler so its click also stops bubbling to the card root. */
function stop(handler?: () => void) {
  return (e: MouseEvent) => {
    e.stopPropagation();
    handler?.();
  };
}

type RootProps = {
  kind: ModelKind;
  children: ReactNode;
  /** Fires on a card click that isn't a parameter control or action button. */
  onOpen?: () => void;
  className?: string;
};

function Root({ kind, children, onOpen, className }: RootProps) {
  const a = KIND_ACCENT[kind];
  return (
    <Ctx.Provider value={{ kind }}>
      <div
        role={onOpen ? 'button' : undefined}
        onClick={onOpen ? () => onOpen() : undefined}
        className={cn(
          'flex overflow-hidden rounded-lg border border-l-[3px] border-border-default bg-bg-card transition-colors',
          a.borderL,
          onOpen && 'cursor-pointer hover:bg-bg-card-on',
          className,
        )}
      >
        {children}
      </div>
    </Ctx.Provider>
  );
}

/** Optional left-side preview column. */
function Preview({
  src,
  label,
  className,
}: {
  src?: string | null;
  label?: string;
  className?: string;
}) {
  return <PreviewThumb src={src} label={label} className={cn('w-[88px] shrink-0 self-stretch', className)} />;
}

/** Right-side content column. */
function Body({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex min-w-0 flex-1 flex-col gap-2.5 p-2.5', className)}>{children}</div>;
}

type HeaderProps = {
  title: string;
  subtitle?: string;
  onRemove?: () => void;
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  /** Optional content rendered before the remove button — used to slot in the
   *  per-card edit picker. Clicks inside are stopped from bubbling to the
   *  card's `onOpen`. */
  editSlot?: ReactNode;
};

/** Badge + title/subtitle + optional edit/expand/remove. */
function Header({ title, subtitle, onRemove, expandable, expanded, onToggleExpand, editSlot }: HeaderProps) {
  const { kind } = useCard('Header');
  return (
    <div className="flex items-start gap-2">
      <KindBadge kind={kind} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-semibold text-fg-primary">{title}</div>
        {subtitle && <div className="truncate text-[10px] text-fg-dim">{subtitle}</div>}
      </div>
      {editSlot && (
        <div onClick={(e) => e.stopPropagation()} className="flex items-center">
          {editSlot}
        </div>
      )}
      {expandable && (
        <button
          type="button"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          onClick={stop(onToggleExpand)}
          className="flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:text-fg-secondary"
        >
          {expanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
        </button>
      )}
      {onRemove && (
        <button
          type="button"
          aria-label="Remove model"
          onClick={stop(onRemove)}
          className="flex h-6 w-6 items-center justify-center rounded text-fg-dim transition-colors hover:bg-bg-elev hover:text-status-err"
        >
          <CloseIcon size={12} />
        </button>
      )}
    </div>
  );
}

/** Region for editable params — clicks here never bubble to the card's onOpen. */
function Params({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2.5', className)} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}

export const ModelCard = Object.assign(Root, { Preview, Body, Header, Params });
