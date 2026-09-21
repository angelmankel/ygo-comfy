import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useIsDesktop } from '@/hooks/useIsDesktop';

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
 *
 * Two layouts, because the two jobs conflict:
 *
 *  - Desktop uses three absolutely-positioned tracks, so the centre cluster
 *    stays exactly centred however wide the other two grow.
 *  - Mobile uses ordinary flow. Absolute tracks cannot see each other, so on a
 *    narrow screen the end cluster simply paints on top of the start cluster and
 *    wins every tap. On a 412px phone the generate bar's end cluster measured
 *    409px wide starting at x=-14, which buried the one control that opens the
 *    prompt panel — the whole app was unreachable behind it. In flow the two
 *    clusters cannot occupy the same pixels, and the actions scroll sideways
 *    instead of covering anything.
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
  const isDesktop = useIsDesktop();
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
        {isDesktop ? (
          <>
            <NavCluster align="start">{left}</NavCluster>
            <NavCluster align="center" className="hidden sm:inline-flex">
              {center}
            </NavCluster>
            <NavCluster align="end">{right}</NavCluster>
          </>
        ) : (
          <div className="flex w-full min-w-0 items-center gap-1.5">
            {/* The panel triggers are the way back into the app, so they never
                shrink and never scroll away. Only the action strip between them
                gives up space. */}
            <div className="flex shrink-0 items-center gap-1.5">{left}</div>
            <div className="scroll-x-thin flex min-w-0 flex-1 items-center justify-end gap-1.5 overflow-x-auto">
              {right}
            </div>
          </div>
        )}
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
