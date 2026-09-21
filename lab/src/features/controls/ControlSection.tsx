/**
 * A named group of controls that can be folded away — without its values going with it.
 *
 * Collapsing is only honest if the header still answers the question the section answers. So each
 * one carries a summary: "euler_ancestral · normal", "25 steps · CFG 8.0", "1024 × 1024 · ×1".
 * Folded, the panel becomes a readable list of what the run will do; unfolded, every parameter is
 * exactly where it was. Nothing is moved behind a menu and nothing is dropped.
 *
 * The header is the tap target, full width and 48px tall, so it works with a thumb. State is
 * persisted per section, and a section forced open by a search stays visually open without
 * disturbing what the person chose.
 */
import type { ReactNode } from 'react';
import { useCollapsed } from '@/hooks/useCollapsed';
import { ChevronDownIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

export interface ControlSectionProps {
  /** Stable key for the persisted open/closed state. */
  id: string;
  title: string;
  /** The section's current values, in a few words. Shown when folded, and dimmed when open. */
  summary?: ReactNode;
  /** A switch or button that belongs to the section as a whole. Does not toggle the fold. */
  action?: ReactNode;
  defaultCollapsed?: boolean;
  /** Forces the section open regardless of stored state — used while a search is active. */
  forceOpen?: boolean;
  children: ReactNode;
}

export function ControlSection({
  id, title, summary, action, defaultCollapsed = false, forceOpen, children,
}: ControlSectionProps) {
  const [collapsed, toggle] = useCollapsed(`controls.${id}`, defaultCollapsed);
  const open = forceOpen || !collapsed;

  return (
    // `shrink-0` is load-bearing. The panel body is a flex column inside a scroll container, and a
    // flex item shrinks to fit by default — so each card was being squashed by the one after it and
    // clipping its own contents. Invisible while sections were borderless; obvious once they were cards.
    <section className="shrink-0 overflow-hidden rounded-lg border border-border-default bg-bg-elev">
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex min-h-[48px] min-w-0 flex-1 items-center gap-2 px-3 text-left"
        >
          <ChevronDownIcon
            size={13}
            className={cn('shrink-0 text-fg-muted transition-transform', !open && '-rotate-90')}
          />
          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-section text-fg-secondary">
            {title}
          </span>
          {summary != null && (
            <span className="min-w-0 flex-1 truncate text-right text-[11.5px] tabular-nums text-fg-muted">
              {summary}
            </span>
          )}
        </button>
        {action && (
          // Outside the toggle button: a nested button cannot be tapped without also folding.
          <div className="flex shrink-0 items-center pr-3">{action}</div>
        )}
      </div>
      {open && <div className="flex flex-col gap-1 border-t border-border-subtle px-3 pb-3 pt-2">{children}</div>}
    </section>
  );
}
