import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { CivitaiSearchHit, CivitaiImage } from '@/lib/civitai';
import { civitaiThumbUrl } from '@/lib/civitai';
import { cn } from '@/lib/cn';
import { formatCount } from '@/features/model-metadata/civitai';

/** Tile heroes don't need full-resolution. 450px wide is plenty for the
 *  default ~220px tile (×2 DPR) and CivitAI's CDN re-encodes cheaply, so we
 *  burn far less bandwidth than the default ~1024 the search payload hands
 *  back. The metadata modal still requests larger sizes when clicked. */
const TILE_THUMB_WIDTH = 450;

/** How far below (and above) the viewport to start fetching a tile's hero
 *  image. ~2 viewport-heights of runway means a smooth-scrolling user
 *  almost always lands on a tile that's already decoded, while still
 *  letting `content-visibility: auto` skip layout for tiles further out. */
const PREFETCH_ROOT_MARGIN = '1200px 0px';

/**
 * Center grid of CivitAI model cards. Each card hero-images one of the
 * model's gallery samples; hover cycles through the rest. The grid is
 * responsive (2–5 cols) and infinite-scrolls via a sentinel the parent
 * observes.
 */
export function BrowserGrid({
  items, loading, loadingMore, error, onRetry, onCardClick, showNsfw, nsfwFirst, sentinelRef,
}: {
  items: CivitaiSearchHit[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  onRetry: () => void;
  onCardClick: (modelId: number) => void;
  showNsfw: boolean;
  /** When true (Civitai Red catalog), each tile sorts its preview images
   *  NSFW-first so the hero matches the catalog's intent, and the per-tile
   *  blur is suppressed regardless of the SFW toggle. */
  nsfwFirst: boolean;
  sentinelRef: RefObject<HTMLDivElement>;
}) {
  return (
    <div className="scroll-y min-h-0 flex-1 overflow-x-hidden p-4">
      {loading && items.length === 0 ? (
        <SkeletonGrid />
      ) : items.length === 0 ? (
        <EmptyState error={error} onRetry={onRetry} />
      ) : (
        <>
          <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
            {items.map((m) => (
              <ModelCard
                key={m.id}
                model={m}
                blurNsfw={!showNsfw && !nsfwFirst}
                nsfwFirst={nsfwFirst}
                onClick={() => onCardClick(m.id)}
              />
            ))}
          </div>
          <div ref={sentinelRef} className="h-1 w-full" />
          {loadingMore && (
            <div className="mt-4 flex justify-center">
              <span className="text-[11px] text-fg-muted">Loading more…</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-lg border border-border-subtle bg-bg-elev/40">
          <div className="skeleton-shimmer aspect-[3/4] w-full" />
          <div className="space-y-1.5 p-2.5">
            <div className="skeleton-shimmer h-3 w-3/4 rounded" />
            <div className="skeleton-shimmer h-2 w-1/2 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center text-[12px] text-fg-muted">
      <div className="text-[13px] font-medium text-fg-secondary">
        {error ?? 'No models match these filters'}
      </div>
      {error
        ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border border-border-default bg-bg-elev px-3 py-1.5 text-[12px] text-fg-secondary hover:border-accent hover:text-accent"
          >
            Retry
          </button>
        ) : (
          <div>Try widening the type or base-model filters, or clear the search.</div>
        )
      }
    </div>
  );
}

/**
 * One model tile. Hero image with hover-slideshow through the rest of the
 * model's gallery samples, name + creator + downloads/rating below.
 *
 * `blurNsfw` blurs the hero when the SFW toggle is on and the rendered image
 * carries `nsfwLevel > 1`. The full NSFW gallery is gated by the metadata
 * modal's own filter — clicking through reveals it there if the user wants.
 */
function ModelCard({ model, blurNsfw, nsfwFirst, onClick }: {
  model: CivitaiSearchHit;
  blurNsfw: boolean;
  nsfwFirst: boolean;
  onClick: () => void;
}) {
  const images: CivitaiImage[] = useMemo(() => {
    // Two collection strategies. The default (SFW catalog) takes the first
    // ~8 images in version-walk order — cheap and matches CivitAI's own
    // curated ordering. The Red catalog walks EVERY version so the global
    // sort below can surface NSFW samples that live in later versions
    // (a model's first version often has only SFW promo shots, and a naive
    // first-8 collection would never see the spicy stuff at all).
    const out: CivitaiImage[] = [];
    const seen = new Set<string>();
    const versions = model.modelVersions ?? [];
    for (const v of versions) {
      for (const img of v.images ?? []) {
        if (img.url && !seen.has(img.url)) {
          seen.add(img.url);
          out.push(img);
        }
      }
      if (!nsfwFirst && out.length >= 8) break;
    }
    if (nsfwFirst && out.length > 1) {
      // Sort by descending nsfwLevel so the hero is the spiciest sample on
      // file, then cap at 8 (same payload size as the SFW path).
      out.sort((a, b) => (b.nsfwLevel ?? 0) - (a.nsfwLevel ?? 0));
      if (out.length > 8) out.length = 8;
    }
    return out;
  }, [model.modelVersions, nsfwFirst]);

  const [hover, setHover] = useState(false);
  /** True once hover has been entered at least once — we use this to defer
   *  network requests for the non-hero gallery images. Tiles that the user
   *  never hovers over only download a single thumbnail. */
  const [hoverArmed, setHoverArmed] = useState(false);
  /** True once the tile is within PREFETCH_ROOT_MARGIN of the viewport.
   *  Sticky — once armed we never un-arm, so scrolling back to a tile
   *  never re-triggers the placeholder state. Gates the hero <img> render
   *  so off-screen tiles don't issue requests at all, and on-screen tiles
   *  start fetching ~2 viewport-heights before the user reaches them. */
  const [prefetchArmed, setPrefetchArmed] = useState(false);
  const cardRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (prefetchArmed) return;
    const el = cardRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some(e => e.isIntersecting)) {
          setPrefetchArmed(true);
          io.disconnect();
        }
      },
      { rootMargin: PREFETCH_ROOT_MARGIN },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [prefetchArmed]);
  const [tickIdx, setTickIdx] = useState(0);
  /** Per-URL loaded flag so each image fades in only after its bytes arrive.
   *  The skeleton sits under the image until at least the hero is loaded. */
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  /** Click-to-reveal — if the global NSFW toggle is off, the user can still
   *  peek at this specific card's hero by clicking the blur. Per-card so it
   *  doesn't ripple to the rest of the grid. */
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!hover || images.length <= 1) return;
    const id = setInterval(() => setTickIdx((i) => (i + 1) % images.length), 1400);
    return () => clearInterval(id);
  }, [hover, images.length]);

  const heroIdx = hover && images.length > 1 ? tickIdx : 0;
  const hero = images[heroIdx];
  const nsfw = (hero?.nsfwLevel ?? 0) > 1;
  const shouldBlur = blurNsfw && nsfw && !revealed;
  const heroThumb = hero ? civitaiThumbUrl(hero.url, TILE_THUMB_WIDTH) : '';
  const heroLoaded = heroThumb ? !!loaded[heroThumb] : true;

  return (
    <button
      ref={cardRef}
      type="button"
      onClick={onClick}
      onMouseEnter={() => { setHover(true); setHoverArmed(true); setTickIdx(0); }}
      onMouseLeave={() => setHover(false)}
      // content-visibility: auto + a contain-intrinsic-size hint lets the
      // browser skip layout/paint of offscreen tiles, which is what makes
      // long-grid scroll feel smooth. The intrinsic size matches the aspect
      // (220×ish) so the scrollbar doesn't jitter when content swaps in.
      style={{
        contentVisibility: 'auto',
        // 220 tile width × (3/4 hero aspect) + ~44 footer ≈ 209
        containIntrinsicSize: '220px 360px',
      }}
      className="group flex flex-col overflow-hidden rounded-lg border border-border-subtle bg-bg-elev/40 text-left transition-transform hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-lg"
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-bg-elev">
        {/* Skeleton — visible shimmer under the image until the hero's bytes
            arrive. Uses .skeleton-shimmer (defined in index.css) instead of
            Tailwind's animate-pulse, because pulse only animates opacity and
            is invisible when the placeholder and the tile share bg-bg-elev. */}
        {!heroLoaded && (
          <div aria-hidden className="skeleton-shimmer absolute inset-0" />
        )}

        {/* Image stack — hero renders once the tile is within the prefetch
            rootMargin (so it's already downloading by the time it enters
            view), and the rest defer until the user actually hovers (network
            savings for cards never hovered). */}
        {images.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] italic text-fg-muted">
            no preview
          </div>
        ) : prefetchArmed && images.map((img, i) => {
          const src = civitaiThumbUrl(img.url, TILE_THUMB_WIDTH);
          if (i !== 0 && !hoverArmed) return null;
          const isLoaded = !!loaded[src];
          return (
            <img
              key={src}
              src={src}
              alt={model.name}
              // Eager-load every mounted frame so fast-scrolling never lands
              // on a blank tile while the browser's lazy heuristic catches
              // up. content-visibility above keeps offscreen tiles unmounted-
              // ish, so this doesn't translate to N×1000 requests.
              loading="eager"
              decoding="async"
              onLoad={() => setLoaded((m) => (m[src] ? m : { ...m, [src]: true }))}
              className={cn(
                'absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ease-out',
                // Hide non-loaded frames entirely (skeleton stands in for them).
                // Active frame fades in; inactive loaded frames stay at 0 so
                // they're ready instantly on cycle without a re-decode.
                !isLoaded ? 'opacity-0'
                  : i === heroIdx ? 'opacity-100'
                  : 'opacity-0',
                shouldBlur && 'blur-2xl scale-110',
              )}
            />
          );
        })}
        {/* Chips are part of the loaded state — while the skeleton is up they
            stay hidden so the tile reads as a single coherent placeholder
            during fast scroll (rather than "labelled empty box"). */}
        {heroLoaded && (
          <>
            <span className="absolute left-2 top-2 rounded bg-bg-base/80 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-section text-fg-secondary backdrop-blur">
              {model.type}
            </span>
            {nsfw && (
              <span className="absolute right-2 top-2 rounded bg-status-err/80 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-section text-white backdrop-blur">
                NSFW
              </span>
            )}
          </>
        )}
        {/* Click-to-reveal overlay — only visible while still blurred. Stops
            propagation so revealing doesn't also open the metadata modal. */}
        {shouldBlur && (
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => { e.stopPropagation(); setRevealed(true); }}
            className="absolute inset-0 flex items-center justify-center bg-black/20 text-[11px] font-medium text-white/90 backdrop-blur-[1px] transition-colors hover:bg-black/30"
          >
            Tap to reveal
          </span>
        )}
        {hover && images.length > 1 && (
          <div className="absolute inset-x-0 bottom-1.5 flex justify-center gap-1">
            {images.map((_, i) => (
              <span
                key={i}
                className={cn(
                  'h-1 w-1 rounded-full transition-colors',
                  i === heroIdx ? 'bg-white/90' : 'bg-white/30',
                )}
              />
            ))}
          </div>
        )}
      </div>
      {/* Footer: matches SkeletonGrid's bar layout until the hero loads, so a
          tile entering view via fast scroll reads as a coherent skeleton tile
          instead of "tile with text + blank image patch." */}
      {heroLoaded ? (
        <div className="flex flex-col gap-0.5 p-2.5">
          <div className="line-clamp-2 text-[12.5px] font-semibold text-fg-secondary">{model.name}</div>
          <div className="flex items-center gap-1.5 text-[10.5px] text-fg-muted">
            <span className="truncate">{model.creator?.username ?? '—'}</span>
            <span>·</span>
            <span title="Downloads">↓ {formatCount(model.stats?.downloadCount ?? 0)}</span>
            <span>·</span>
            <span title="Rating">★ {(model.stats?.rating ?? 0).toFixed(1)}</span>
          </div>
        </div>
      ) : (
        <div aria-hidden className="space-y-1.5 p-2.5">
          <div className="skeleton-shimmer h-3 w-3/4 rounded" />
          <div className="skeleton-shimmer h-2 w-1/2 rounded" />
        </div>
      )}
    </button>
  );
}
