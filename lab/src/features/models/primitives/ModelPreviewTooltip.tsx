import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import * as RTooltip from '@radix-ui/react-tooltip';
import { cn } from '@/lib/cn';
import { ImagePlaceholderIcon } from '@/components/ui/icons';

// Long-press threshold for the touch "hover" gesture. ~450ms is the standard
// long-press feel — short enough to be discoverable, long enough that a tap to
// select the model never accidentally fires it.
const LONG_PRESS_MS = 450;
// Cancel the long-press if the finger drifts more than this many pixels —
// otherwise scrolling through a long list would constantly open tooltips.
const LONG_PRESS_MOVE_PX = 8;

/**
 * Hover tooltip for a model row in the picker — when a row is hovered, this
 * mounts a large preview that cross-fades through `srcs` on a timer.
 *
 * Each hover-in calls `getSrcs()` afresh, so callers can return a re-shuffled
 * order on every open (used by the "random" preview-source setting). On
 * `onError` the offending URL is dropped from the list so it doesn't keep
 * showing as a blank frame.
 *
 * Each tooltip wraps itself in a fresh `RTooltip.Provider` with
 * `skipDelayDuration={0}` so scrolling quickly through a long model list never
 * bypasses the open-delay and flashes a tooltip per row. The Content fades in
 * via the `animate-tooltip-in` keyframe (see index.css) for a non-glitchy feel.
 */
type Props = {
  /** Resolves the play-list every time the tooltip opens. */
  getSrcs: () => string[];
  /** Pixel size of the large preview. Defaults to 240×320. */
  width?: number;
  height?: number;
  /** Caption rendered under the slideshow — usually the model file name. */
  caption?: string;
  /** Subcaption (e.g. base-model bucket). */
  subCaption?: string;
  /** Optional availability line (replaces the old native `title` tooltip). */
  availability?: string;
  /** Optional kind for tinting the availability badge (ok / warning / error). */
  availabilityTone?: 'ok' | 'warn' | 'err';
  children: ReactNode;
};

export function ModelPreviewTooltip({
  getSrcs, width = 260, height = 340, caption, subCaption, availability, availabilityTone = 'ok', children,
}: Props) {
  const [open, setOpen] = useState(false);

  // Recompute the play-list on each open so 'random' really is random and
  // 'history' picks up the latest local generation.
  const [srcs, setSrcs] = useState<string[]>([]);
  useEffect(() => {
    if (open) setSrcs(getSrcs());
    // We intentionally only refresh on open transitions; getSrcs identity
    // changes (parent re-renders) shouldn't reset an in-flight slideshow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // -----------------------------------------------------------------------
  // Touch long-press → hover. Radix Tooltip is hover-only; on a touch device
  // there's no hover, so we add a press-and-hold gesture that opens the same
  // tooltip. Filtered to `pointerType === 'touch'` so desktop hover behaviour
  // is untouched. Cancels on scroll, on early release, or on pointercancel.
  //
  // After a successful long-press we suppress the synthetic `click` once so
  // tap-and-hold doesn't ALSO select the model on release.
  // -----------------------------------------------------------------------
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);
  const pressStart = useRef<{ x: number; y: number } | null>(null);

  const clearTimer = useCallback(() => {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'touch') return;
    longPressFired.current = false;
    pressStart.current = { x: e.clientX, y: e.clientY };
    clearTimer();
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      setOpen(true);
    }, LONG_PRESS_MS);
  }, [clearTimer]);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'touch') return;
    const start = pressStart.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (dx * dx + dy * dy > LONG_PRESS_MOVE_PX * LONG_PRESS_MOVE_PX) {
      clearTimer();
    }
  }, [clearTimer]);

  const onPointerEnd = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'touch') return;
    clearTimer();
    pressStart.current = null;
    // Close the tooltip on finger-up if we opened it via long-press.
    if (longPressFired.current) setOpen(false);
  }, [clearTimer]);

  // Suppress the click that fires right after a long-press release. We reset
  // the flag here so the very next user tap selects the model normally.
  const onClickCapture = useCallback((e: ReactMouseEvent<HTMLElement>) => {
    if (longPressFired.current) {
      e.preventDefault();
      e.stopPropagation();
      longPressFired.current = false;
    }
  }, []);

  // Cleanup on unmount — leaking a timer that calls setOpen on a stale tree
  // would crash dev with the act() warning, and is wasted work in any case.
  useEffect(() => () => clearTimer(), [clearTimer]);

  const hasImages = srcs.length > 0;
  const toneClass = availabilityTone === 'err'
    ? 'text-status-err'
    : availabilityTone === 'warn'
      ? 'text-fg-tertiary'
      : 'text-status-ok';

  return (
    // Wrap each tooltip in its own provider with `skipDelayDuration={0}` so
    // moving the cursor between rows in a long list never instantly opens the
    // next tooltip — every hover must dwell for the full delay. `delayDuration`
    // is the open-delay (350ms here — long enough to skim, short enough that a
    // deliberate hover still feels responsive).
    <RTooltip.Provider delayDuration={350} skipDelayDuration={0}>
      <RTooltip.Root open={open} onOpenChange={setOpen}>
        <RTooltip.Trigger
          asChild
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onPointerLeave={onPointerEnd}
          onClickCapture={onClickCapture}
          // Allow the OS to defer to our long-press without surfacing its own
          // context-menu / select gesture on a sustained touch.
          onContextMenu={(e) => { if (longPressFired.current) e.preventDefault(); }}
        >
          {children}
        </RTooltip.Trigger>
        <RTooltip.Portal>
          <RTooltip.Content
            side="right"
            sideOffset={12}
            collisionPadding={12}
            onPointerDownOutside={() => setOpen(false)}
            className={cn(
              'z-[60] overflow-hidden rounded-lg border border-border-default bg-bg-elev shadow-[0_20px_60px_rgba(0,0,0,0.75)]',
              'animate-tooltip-in',
            )}
          >
            {hasImages && <SlideshowPlayer srcs={srcs} width={width} height={height} />}
            {(caption || subCaption || availability) && (
              <div
                className={cn(
                  'flex flex-col gap-1 px-3 py-2',
                  hasImages ? 'border-t border-border-subtle' : 'min-w-[200px]',
                )}
              >
                {caption && (
                  <span className="break-all text-[11.5px] font-medium leading-snug text-fg-secondary">
                    {caption}
                  </span>
                )}
                {subCaption && (
                  <span className="text-[9.5px] uppercase tracking-section text-fg-muted">
                    {subCaption}
                  </span>
                )}
                {availability && (
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', toneClass.replace('text-', 'bg-'))} />
                    <span className={cn('text-[10.5px] font-medium', toneClass)}>{availability}</span>
                  </div>
                )}
              </div>
            )}
          </RTooltip.Content>
        </RTooltip.Portal>
      </RTooltip.Root>
    </RTooltip.Provider>
  );
}

// ---------------------------------------------------------------------------
// Slideshow player — overlapping <img> layers with a CSS opacity transition.
// ---------------------------------------------------------------------------

const FRAME_MS = 1800;
const FADE_MS = 600;

function SlideshowPlayer({ srcs, width, height }: { srcs: string[]; width: number; height: number }) {
  const [errors, setErrors] = useState<Set<string>>(new Set());
  // Drop URLs that have failed so the slideshow doesn't sit on a blank frame.
  // Memoised so the play-list identity is stable across rerenders that don't
  // change the underlying URL list.
  const valid = useMemo(
    () => srcs.filter((s) => !errors.has(s)),
    [srcs, errors],
  );

  const [index, setIndex] = useState(0);
  // Reset to frame 0 whenever the candidate set itself changes — keeps the
  // re-roll-on-open behaviour correct.
  useEffect(() => { setIndex(0); }, [valid.length, valid[0]]);

  // Auto-advance. Cleared on unmount + when the play-list shrinks below 2.
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (timer.current != null) window.clearTimeout(timer.current);
    if (valid.length <= 1) return;
    timer.current = window.setTimeout(() => {
      setIndex((i) => (i + 1) % valid.length);
    }, FRAME_MS);
    return () => {
      if (timer.current != null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [index, valid.length]);

  const onError = (url: string) => {
    setErrors((prev) => {
      const next = new Set(prev);
      next.add(url);
      return next;
    });
  };

  if (valid.length === 0) {
    return (
      <div
        style={{ width, height }}
        className="flex flex-col items-center justify-center gap-1 bg-gradient-to-br from-bg-elev to-bg-input text-fg-dim"
      >
        <ImagePlaceholderIcon size={28} />
        <span className="text-[10px] font-medium">No preview available</span>
      </div>
    );
  }

  return (
    <div
      style={{ width, height }}
      className="relative overflow-hidden bg-black"
    >
      {valid.map((url, i) => (
        <img
          // The src in the key forces React to mount a fresh <img> per URL —
          // makes onError fire reliably even on cached failures.
          key={url}
          src={url}
          alt=""
          loading="lazy"
          onError={() => onError(url)}
          style={{ transitionDuration: `${FADE_MS}ms` }}
          className={cn(
            'absolute inset-0 h-full w-full object-cover transition-opacity ease-in-out',
            i === index ? 'opacity-100 z-10' : 'opacity-0 z-0',
          )}
        />
      ))}
      {valid.length > 1 && (
        <div className="absolute inset-x-0 bottom-1 z-20 flex justify-center gap-1">
          {valid.map((_, i) => (
            <span
              key={i}
              aria-hidden
              className={cn(
                'h-1 rounded-full transition-all duration-300',
                i === index ? 'w-4 bg-white/80' : 'w-1 bg-white/30',
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
