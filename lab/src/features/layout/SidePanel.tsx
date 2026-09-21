import type { CSSProperties, ReactNode } from 'react';
import { IconButton } from '@/components/ui/IconButton';
import { ChevronRightIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

export interface SidePanelProps {
  /** Which edge of the viewport the panel docks to. */
  side: 'left' | 'right';
  /** Whether the panel is currently visible. */
  open: boolean;
  /** Whether to use desktop (in-flow absolute) or mobile (viewport-fixed) geometry. */
  isDesktop: boolean;
  /** Panel width on desktop, in px. The closed-state transform slides this far off-screen. */
  width: number;
  /** Optional offset on mobile — e.g. so the left panel sits past a 52px side rail. */
  mobileLeftOffset?: number;
  /** Optional override for the mobile width. Defaults to `min(88vw, 420px)`. */
  mobileWidth?: string;
  /** Extra classes for the outer <aside>. */
  className?: string;
  /**
   * Optional sticky header strip rendered at the top of the panel. Use for
   * panel-scoped chrome (collapse triggers, status indicators) so it stays
   * visually attached to the panel surface as the body scrolls.
   */
  header?: ReactNode;
  children: ReactNode;
}

/**
 * Generic side-panel shell. Owns the chrome (border, blurred surface,
 * z-index) and the slide-in/out transform — but knows nothing about its
 * contents, so the same shell can host different feature panels per view.
 *
 * Geometry differs by `isDesktop`: desktop panels are absolutely positioned
 * inside their parent (no resize side-effects on the canvas); mobile panels
 * are viewport-fixed drawers with an optional left offset to clear a side
 * rail.
 *
 * The open/close trigger is intentionally NOT bundled here — render
 * `<SidePanelTrigger>` somewhere visible (typically inside a `<TopNav>` slot)
 * so the affordance lives next to the user's other tools rather than as a
 * protruding tab on the panel edge.
 */
export function SidePanel({
  side,
  open,
  isDesktop,
  width,
  mobileLeftOffset = 0,
  mobileWidth = 'min(88vw, 420px)',
  className,
  header,
  children,
}: SidePanelProps) {
  // Desktop: panel floats with an 8px gutter on all sides — matching the
  // TopNav's wrapper padding so the two read as a unified frame. The closed
  // transform overshoots by 16px (gutter + a few px of shadow) so nothing
  // peeks back into the viewport when collapsed.
  const desktopClosed =
    side === 'left' ? 'translateX(calc(-100% - 16px))' : 'translateX(calc(100% + 16px))';
  const desktopStyle: CSSProperties = {
    position: 'absolute',
    top: 8,
    bottom: 8,
    [side]: 8,
    width,
    zIndex: 30,
    transform: open ? 'translateX(0)' : desktopClosed,
    transition: 'transform 200ms ease-out',
  };

  // Mobile: edge-flush drawer (the conventional pattern). No gutter so the
  // drawer reads as overlay chrome, not a card.
  const mobileClosed = side === 'left' ? 'translateX(-100%)' : 'translateX(100%)';
  const mobileStyle: CSSProperties = {
    position: 'fixed',
    top: 0,
    bottom: 0,
    [side]: side === 'left' ? mobileLeftOffset : 0,
    width: mobileWidth,
    zIndex: 30,
    transform: open ? 'translateX(0)' : mobileClosed,
    transition: 'transform 200ms ease-out',
  };

  // Desktop: detached card → full border + rounded corners + matches TopNav.
  // Mobile: flush drawer → single edge border, no rounding.
  const desktopShell = 'border border-border-subtle rounded-md overflow-hidden';
  const mobileShell = side === 'left' ? 'border-r border-border-subtle' : 'border-l border-border-subtle';

  return (
    <aside
      style={isDesktop ? desktopStyle : mobileStyle}
      className={cn(
        'flex flex-col bg-bg-panel/85 backdrop-blur-md',
        isDesktop ? desktopShell : mobileShell,
        className,
      )}
    >
      {header && (
        <div className="shrink-0 border-b border-border-subtle bg-bg-panel/60 px-2 py-2">
          {header}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </aside>
  );
}

export interface SidePanelTriggerProps {
  side: 'left' | 'right';
  open: boolean;
  onClick: () => void;
}

/**
 * Companion trigger for `<SidePanel>`. Renders as a small IconButton so it
 * drops into a `<TopNav>` slot without ceremony. Chevron always points in
 * the direction the click will move the panel edge — into the canvas to open,
 * back toward the viewport edge to close.
 */
export function SidePanelTrigger({ side, open, onClick }: SidePanelTriggerProps) {
  const pointsRight = (side === 'left' && !open) || (side === 'right' && open);
  return (
    <IconButton
      aria-label={open ? `Collapse ${side} panel` : `Expand ${side} panel`}
      title={open ? 'Collapse panel' : 'Expand panel'}
      onClick={onClick}
    >
      <ChevronRightIcon size={14} className={cn('transition-transform', !pointsRight && 'rotate-180')} />
    </IconButton>
  );
}

export interface BothPanelsTriggerProps {
  leftOpen: boolean;
  rightOpen: boolean;
  onChange: (open: boolean) => void;
}

/**
 * Convenience toggle that collapses or expands both side panels in one
 * click. "Any open → close both" is the rule (so the button is a quick
 * "give me a clean canvas"), and "both closed → open both" restores them.
 */
export function BothPanelsTrigger({ leftOpen, rightOpen, onChange }: BothPanelsTriggerProps) {
  const anyOpen = leftOpen || rightOpen;
  return (
    <IconButton
      aria-label={anyOpen ? 'Collapse both panels' : 'Expand both panels'}
      title={anyOpen ? 'Collapse both panels' : 'Expand both panels'}
      onClick={() => onChange(!anyOpen)}
    >
      <span className="inline-flex items-center gap-px">
        <ChevronRightIcon size={12} className={cn('transition-transform', anyOpen ? 'rotate-180' : '')} />
        <ChevronRightIcon size={12} className={cn('transition-transform', anyOpen ? '' : 'rotate-180')} />
      </span>
    </IconButton>
  );
}
