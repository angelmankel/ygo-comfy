import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TopNavProps {
  /** Slot rendered flush-left. */
  left?: ReactNode;
  /** Slot rendered centered between the left/right insets. */
  center?: ReactNode;
  /** Slot rendered flush-right. */
  right?: ReactNode;
  /** Distance from the viewport's left edge (px). Lets the bar dodge a docked left panel. */
  leftInset?: number;
  /** Distance from the viewport's right edge (px). */
  rightInset?: number;
  /** Animates the inset transitions in lockstep with the panels that drive them. */
  insetTransition?: string;
  /** Extra classes on the outer bar (the glass surface). */
  className?: string;
}

/**
 * Generic floating top toolbar. Acts as a styled, positioned shell — the
 * caller decides what content lives in the left/center/right slots, so the
 * same bar can be reused across views (canvas, generate, collections, …)
 * with completely different controls.
 *
 * The shell is a single blurred glass pill that hugs its contents. Slots are
 * `pointer-events-auto` so clicks land on the buttons, while the wrapper is
 * `pointer-events-none` so empty gutters don't swallow canvas gestures.
 */
export function TopNav({
  left,
  center,
  right,
  leftInset = 0,
  rightInset = 0,
  insetTransition,
  className,
}: TopNavProps) {
  const wrapperStyle: CSSProperties = {
    left: leftInset,
    right: rightInset,
    transition: insetTransition,
  };

  return (
    <div
      className="pointer-events-none absolute top-0 z-10 p-2"
      style={wrapperStyle}
    >
      <div
        className={cn(
          'pointer-events-auto relative flex h-12 w-full items-center rounded-md px-2',
          'border border-border-subtle bg-bg-panel/85 shadow-lg shadow-black/30',
          'backdrop-blur-md',
          className,
        )}
      >
        <NavCluster align="start">{left}</NavCluster>
        <NavCluster align="center" className="hidden sm:inline-flex">
          {center}
        </NavCluster>
        <NavCluster align="end">{right}</NavCluster>
      </div>
    </div>
  );
}

function NavCluster({
  children,
  align,
  className,
}: {
  children?: ReactNode;
  align: 'start' | 'center' | 'end';
  className?: string;
}) {
  // Three absolutely-positioned tracks let the center cluster stay perfectly
  // centered regardless of how wide the left/right clusters grow. A pure flex
  // layout would push the center off-axis the moment one side outgrew the
  // other.
  const positionClass =
    align === 'start'
      ? 'left-2 justify-start'
      : align === 'end'
        ? 'right-2 justify-end'
        : 'left-1/2 -translate-x-1/2 justify-center';

  return (
    <div
      data-align={align}
      className={cn(
        'absolute inline-flex items-center gap-1.5 top-1/2 -translate-y-1/2',
        positionClass,
        !children && 'pointer-events-none',
        className,
      )}
    >
      {children}
    </div>
  );
}
