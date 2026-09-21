import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import * as RPopover from '@radix-ui/react-popover';
import { usePanZoom } from '@/hooks/usePanZoom';
import { useShortcut, ShortcutPriority } from '@/hooks/useShortcut';
import { CloseIcon, InfoIcon, PauseIcon, PlayIcon, ChevronDownIcon, CheckIcon } from '@/components/ui/icons';
import {
  loadSlideshowTransition,
  saveSlideshowTransition,
  type SlideshowTransition,
} from '@/lib/storage';
import { cn } from '@/lib/cn';

/**
 * Generic, reusable fullscreen image viewer.
 *
 * Owns the chrome (close, prev/next, page counter, slideshow toggle, info
 * panel) plus pan/pinch/wheel/momentum gestures and keyboard navigation
 * (←/→ for nav, S for slideshow, Esc for close). The contents of the
 * info panel are caller-provided — the history viewer renders an entry's
 * metadata; the model-metadata modal can pass `null`.
 *
 * Slideshow play state can be externally controlled (pass `playing` +
 * `onPlayingChange`) for cross-component persistence, or left internal.
 */

export type FullscreenItem = {
  /** Stable identity for React key + the pan/zoom reset trigger. */
  key: string;
  /** Image URL to display. */
  url: string;
};

type Props = {
  items: FullscreenItem[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  /** Optional content for the side info panel. Hides the info button if omitted. */
  infoSlot?: ReactNode;
  /** Initial open state for the info panel. */
  initialInfoOpen?: boolean;
  /** Controlled play state; falls back to internal state if undefined. */
  playing?: boolean;
  onPlayingChange?: (playing: boolean) => void;
  /** Milliseconds per slideshow step. */
  slideshowMs?: number;
  /** Optional caption rendered with the page counter. */
  pageCaption?: string;
};

const DEFAULT_SLIDESHOW_MS = 3000;

export function FullscreenImage({
  items,
  index,
  onIndexChange,
  onClose,
  infoSlot,
  initialInfoOpen = false,
  playing: playingProp,
  onPlayingChange,
  slideshowMs = DEFAULT_SLIDESHOW_MS,
  pageCaption,
}: Props) {
  const item = items[index];
  const url = item?.url ?? '';

  // Controlled-or-uncontrolled playing state.
  const [playingState, setPlayingState] = useState(playingProp ?? false);
  const playing = playingProp ?? playingState;
  const setPlaying = (next: boolean | ((p: boolean) => boolean)) => {
    const resolved = typeof next === 'function' ? next(playing) : next;
    if (onPlayingChange) onPlayingChange(resolved);
    else setPlayingState(resolved);
  };

  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [infoOpen, setInfoOpen] = useState(initialInfoOpen);
  const containerRef = useRef<HTMLDivElement>(null);

  // Slideshow transition (persisted). The chosen effect only applies when
  // `playing === true` — manual prev/next stays instant so quick browsing
  // isn't blocked behind a 500 ms animation.
  const [transition, setTransitionState] = useState<SlideshowTransition>(() => loadSlideshowTransition());
  const setTransition = (t: SlideshowTransition) => {
    saveSlideshowTransition(t);
    setTransitionState(t);
  };

  // Previous-URL ref drives the dual-image transition stack. On every URL
  // change while the slideshow is playing, we capture the just-shown URL and
  // bump `animKey` so both layers remount and run their enter/exit
  // animations.
  const [prevUrl, setPrevUrl] = useState<string | null>(null);
  const [animKey, setAnimKey] = useState(0);
  const lastUrlRef = useRef<string>(url);
  useEffect(() => {
    if (lastUrlRef.current === url) return;
    if (playing && transition !== 'none') {
      setPrevUrl(lastUrlRef.current);
      setAnimKey((k) => k + 1);
    } else {
      setPrevUrl(null);
    }
    lastUrlRef.current = url;
  }, [url, playing, transition]);

  const len = items.length;
  const prev = () => onIndexChange((index - 1 + len) % len);
  const next = () => onIndexChange((index + 1) % len);

  const { zoom, offset, reframing, handlers } = usePanZoom(containerRef, {
    resetKey: item?.key ?? index,
    onTap: onClose,
  });

  useEffect(() => { setSize(null); }, [item?.key, index]);

  // Slideshow auto-advance. The `index` dependency means a manual nav resets
  // the timer naturally — the interval is torn down + recreated.
  useEffect(() => {
    if (!playing || len < 2) return;
    const t = setInterval(() => onIndexChange((index + 1) % len), slideshowMs);
    return () => clearInterval(t);
  }, [playing, index, len, onIndexChange, slideshowMs]);

  // Top-overlay priority — when the fullscreen viewer is open, its arrows
  // and Esc take precedence over the history panel / metadata gallery behind.
  useShortcut('Escape', () => onClose(), { priority: ShortcutPriority.TopOverlay });
  useShortcut('ArrowLeft', () => onIndexChange((index - 1 + len) % len), { priority: ShortcutPriority.TopOverlay });
  useShortcut('ArrowRight', () => onIndexChange((index + 1) % len), { priority: ShortcutPriority.TopOverlay });
  useShortcut(['s', 'S'], () => setPlaying(p => !p), { priority: ShortcutPriority.TopOverlay });

  if (!item) return null;

  return createPortal(
    <div
      ref={containerRef}
      className="fixed inset-0 z-[80] overflow-hidden"
      style={{ touchAction: 'none' }}
      onWheel={handlers.onWheel}
      onPointerDown={handlers.onPointerDown}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerUp}
      onClick={handlers.onClick}
    >
      {/* Ambient backdrop sampled from the image via heavy blur. */}
      <div className="pointer-events-none absolute inset-0">
        <img
          src={url}
          alt=""
          aria-hidden
          className="h-full w-full scale-125 object-cover opacity-50"
          style={{ filter: 'blur(60px)' }}
        />
        <div className="absolute inset-0 bg-black/55" />
      </div>

      {/* Image stack — when the slideshow is playing with a non-`none`
          transition, the outgoing image (back layer) runs its exit anim
          while the new image (front layer) runs its enter anim. Outside of
          slideshow mode only the front layer is rendered, so manual prev /
          next stays instant. The user's pan/zoom transform stays on the
          inner image; the transition transform wraps it so the two compose. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {prevUrl && (
          <div key={`out-${animKey}`} className={cn('absolute', transitionClass(transition, 'out'))}>
            <img
              src={prevUrl}
              alt=""
              draggable={false}
              className="max-h-[92vh] max-w-[92vw] select-none rounded-md shadow-[0_20px_70px_rgba(0,0,0,0.7)]"
            />
          </div>
        )}
        <div
          key={`in-${animKey}`}
          className={cn('absolute', prevUrl && transitionClass(transition, 'in'))}
        >
          <KenBurnsWrap active={playing && transition === 'ken-burns'} durationMs={slideshowMs} animKey={animKey}>
            <img
              src={url}
              alt=""
              draggable={false}
              onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              className="max-h-[92vh] max-w-[92vw] select-none rounded-md shadow-[0_20px_70px_rgba(0,0,0,0.7)]"
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                transition: reframing ? 'transform 250ms cubic-bezier(0.22, 1, 0.36, 1)' : undefined,
              }}
            />
          </KenBurnsWrap>
        </div>
      </div>

      {len > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous"
            onClick={(e) => { e.stopPropagation(); prev(); }}
            className="absolute left-4 top-1/2 z-10 flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-[24px] text-white/80 backdrop-blur-md hover:bg-black/60 hover:text-white"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Next"
            onClick={(e) => { e.stopPropagation(); next(); }}
            className="absolute right-4 top-1/2 z-10 flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-[24px] text-white/80 backdrop-blur-md hover:bg-black/60 hover:text-white"
          >
            ›
          </button>
        </>
      )}

      {/* Top-right control cluster: slideshow + transition picker + info + close.
          The slideshow button moved up here (it used to live bottom-center,
          where it overlapped tall portraits). */}
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        {len > 1 && (
          <>
            <button
              type="button"
              aria-label={playing ? 'Pause slideshow' : 'Play slideshow'}
              title={playing ? 'Pause slideshow (S)' : 'Play slideshow (S)'}
              onClick={(e) => { e.stopPropagation(); setPlaying(p => !p); }}
              className={cn(
                'flex h-11 items-center gap-2 rounded-full px-4 text-[12.5px] font-medium backdrop-blur-md transition-colors',
                playing
                  ? 'bg-white/85 text-black hover:bg-white'
                  : 'bg-black/40 text-white/85 hover:bg-black/60 hover:text-white',
              )}
            >
              {playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
              <span>{playing ? 'Pause' : 'Slideshow'}</span>
            </button>
            <TransitionPicker value={transition} onChange={setTransition} />
          </>
        )}

        {infoSlot && (
          <button
            type="button"
            aria-label={infoOpen ? 'Hide image info' : 'Show image info'}
            title={infoOpen ? 'Hide image info' : 'Show image info'}
            aria-expanded={infoOpen}
            onClick={(e) => { e.stopPropagation(); setInfoOpen(o => !o); }}
            className={cn(
              'flex h-11 w-11 items-center justify-center rounded-full backdrop-blur-md',
              infoOpen
                ? 'bg-white/85 text-black hover:bg-white'
                : 'bg-black/40 text-white/80 hover:bg-black/60 hover:text-white',
            )}
          >
            <InfoIcon size={18} />
          </button>
        )}

        <button
          type="button"
          aria-label="Close"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-white/80 backdrop-blur-md hover:bg-black/60 hover:text-white"
        >
          <CloseIcon size={17} />
        </button>
      </div>

      {infoSlot && (
        <>
          <div
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            style={{ touchAction: 'pan-y' }}
            className={`absolute right-0 top-0 z-10 flex h-full w-[340px] max-w-[85vw] flex-col bg-black/65 backdrop-blur-xl transition-transform duration-200 ${
              infoOpen ? 'translate-x-0' : 'pointer-events-none translate-x-full'
            }`}
          >
            <div className="flex items-center justify-between px-5 pb-3 pt-5">
              <span className="text-[13px] font-semibold uppercase tracking-wide text-white/80">Image Info</span>
              <button
                type="button"
                aria-label="Hide image info"
                onClick={(e) => { e.stopPropagation(); setInfoOpen(false); }}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
              >
                <CloseIcon size={13} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 pb-6">
              {infoSlot}
            </div>
          </div>
        </>
      )}

      <div className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full bg-black/40 px-3 py-1.5 font-mono text-[12px] text-white/70 backdrop-blur-md">
        <span>{index + 1} / {len}</span>
        {size && (
          <>
            <span className="text-white/30">·</span>
            <span>{size.w}×{size.h}</span>
          </>
        )}
        {pageCaption && (
          <>
            <span className="text-white/30">·</span>
            <span>{pageCaption}</span>
          </>
        )}
      </div>

    </div>,
    document.body,
  );
}

// ── Slideshow transition helpers ──────────────────────────────────────────

/** Map a transition kind + direction to the CSS class name in index.css. */
function transitionClass(t: SlideshowTransition, dir: 'in' | 'out'): string {
  if (t === 'none') return '';
  if (t === 'fade')      return dir === 'in' ? 'ss-anim-fade-in'  : 'ss-anim-fade-out';
  if (t === 'slide')     return dir === 'in' ? 'ss-anim-slide-in' : 'ss-anim-slide-out';
  if (t === 'zoom')      return dir === 'in' ? 'ss-anim-zoom-in'  : 'ss-anim-zoom-out';
  if (t === 'ken-burns') return dir === 'in' ? 'ss-anim-fade-in'  : 'ss-anim-fade-out';
  return '';
}

/**
 * Wraps the image with a Ken-Burns continuous zoom while the slide is on
 * screen. Inert when `active` is false — just renders its children straight
 * through, so manual nav / non-Ken-Burns transitions stay untouched.
 *
 * The animation duration is tied to the slideshow step so the scale finishes
 * right as the next slide begins. `animKey` remounts the wrapper between
 * slides so the zoom restarts cleanly from scale(1).
 */
function KenBurnsWrap({
  active, durationMs, animKey, children,
}: { active: boolean; durationMs: number; animKey: number; children: ReactNode }) {
  if (!active) return <>{children}</>;
  return (
    <div
      key={`kb-${animKey}`}
      className="ss-ken-burns"
      style={{ animationDuration: `${durationMs}ms` }}
    >
      {children}
    </div>
  );
}

const TRANSITION_OPTIONS: { value: SlideshowTransition; label: string; hint: string }[] = [
  { value: 'none',      label: 'None',           hint: 'Instant cut' },
  { value: 'fade',      label: 'Crossfade',      hint: 'Smooth blend (default)' },
  { value: 'slide',     label: 'Slide',          hint: 'Push from the right' },
  { value: 'zoom',      label: 'Zoom blur',      hint: 'Scale + fade' },
  { value: 'ken-burns', label: 'Ken Burns',      hint: 'Slow continuous zoom' },
];

/** Compact dropdown sitting next to the slideshow play button. Lives in the
 *  same top-right cluster so the user finds it with the play control. */
function TransitionPicker({
  value, onChange,
}: { value: SlideshowTransition; onChange: (v: SlideshowTransition) => void }) {
  const active = TRANSITION_OPTIONS.find(o => o.value === value) ?? TRANSITION_OPTIONS[1];
  return (
    <RPopover.Root>
      <RPopover.Trigger asChild>
        <button
          type="button"
          aria-label={`Slideshow transition: ${active.label}`}
          title={`Slideshow transition: ${active.label}`}
          onClick={(e) => e.stopPropagation()}
          className="flex h-11 items-center gap-1.5 rounded-full bg-black/40 px-3 text-[12px] font-medium text-white/85 backdrop-blur-md hover:bg-black/60 hover:text-white"
        >
          <span>{active.label}</span>
          <ChevronDownIcon size={12} />
        </button>
      </RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content
          align="end"
          sideOffset={6}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="z-[90] w-[200px] overflow-hidden rounded-lg border border-white/10 bg-black/85 p-1 shadow-xl backdrop-blur-md"
        >
          <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-section text-white/50">
            Slideshow transition
          </div>
          {TRANSITION_OPTIONS.map((o) => {
            const selected = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => onChange(o.value)}
                className={cn(
                  'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors',
                  selected ? 'bg-white/10 text-white' : 'text-white/80 hover:bg-white/10 hover:text-white',
                )}
              >
                <span className="mt-0.5 flex h-3 w-3 shrink-0 items-center justify-center">
                  {selected && <CheckIcon size={11} />}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">{o.label}</span>
                  <span className="text-[10.5px] text-white/55">{o.hint}</span>
                </span>
              </button>
            );
          })}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}
