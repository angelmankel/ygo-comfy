import { useEffect, useMemo, useRef } from 'react';
import { useBrowserStore } from './store';
import { BrowserFiltersRail } from './BrowserFiltersRail';
import { BrowserGrid } from './BrowserGrid';
import { OpenByIdInput } from './OpenByIdInput';
import { CollectionsIcon } from '@/components/ui/icons';
import { useModelMetadataStore } from '@/features/model-metadata/store';

/**
 * Model browser — a top-level view switched from the sidebar (not an overlay).
 * Fills the main area; the sidebar is the only sibling. Two columns:
 *
 *   ┌──────────┬────────────────────────────────────────┐
 *   │ filters  │ grid of CivitAI cards (hero images)    │
 *   │          │   ┌──┐ ┌──┐ ┌──┐ ┌──┐                  │
 *   │  type    │   └──┘ └──┘ └──┘ └──┘                  │
 *   │  base    │   ┌──┐ ┌──┐ …                         │
 *   │  sort    │                                        │
 *   │  period  │                                        │
 *   │  nsfw    │                                        │
 *   │  search  │                                        │
 *   └──────────┴────────────────────────────────────────┘
 *
 * Clicking a card opens the existing `<ModelMetadataModal>` which already
 * does the gallery + download flow. That keeps the browser focused on
 * discovery and reuses the polished single-model surface for action.
 */
export function ModelBrowserView() {
  const filters = useBrowserStore((s) => s.filters);
  const items = useBrowserStore((s) => s.items);
  const loading = useBrowserStore((s) => s.loading);
  const loadingMore = useBrowserStore((s) => s.loadingMore);
  const nextCursor = useBrowserStore((s) => s.nextCursor);
  const error = useBrowserStore((s) => s.error);
  const refresh = useBrowserStore((s) => s.refresh);
  const loadMore = useBrowserStore((s) => s.loadMore);
  const openModel = useModelMetadataStore((s) => s.open);

  // First mount → kick off the initial fetch. Subsequent filter changes are
  // handled by the store's `setFilters` action so each chip click re-runs.
  const fetchedOnce = useRef(false);
  useEffect(() => {
    if (fetchedOnce.current) return;
    fetchedOnce.current = true;
    void refresh();
  }, [refresh]);

  // Infinite scroll: intersection observer on a sentinel after the grid. A
  // generous root margin (2500px) means the next page is requested long
  // before the user scrolls into the empty zone — by the time they reach
  // the bottom of the current page, the next batch is usually already
  // rendered. Tuned to roughly two viewports of headroom.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !nextCursor) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMore();
    }, { rootMargin: '2500px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [nextCursor, loadMore, items.length]);

  // Tile click → open the metadata modal. We synthesize a `browser:<id>`
  // entry id so the modal's "openEntryId" reset semantics still work.
  const onCardClick = (modelId: number) => openModel(`browser:${modelId}`, modelId);

  const headerCount = useMemo(() => {
    if (loading) return 'searching…';
    if (error) return error;
    return `${items.length}${nextCursor ? '+' : ''} model${items.length === 1 ? '' : 's'}`;
  }, [loading, error, items.length, nextCursor]);

  return (
    <div className="flex h-full w-full flex-col bg-bg-base">
      <header className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-bg-panel px-3 py-2">
        <CollectionsIcon size={15} className="text-fg-tertiary" />
        <span className="text-[12.5px] font-semibold text-fg-primary">Browse models</span>
        <span className="rounded bg-bg-elev px-1.5 py-0.5 text-[10px] font-medium text-fg-muted">
          {headerCount}
        </span>
        <div className="ml-auto"><OpenByIdInput /></div>
      </header>

      <div className="flex min-h-0 flex-1">
        <BrowserFiltersRail filters={filters} />
        <BrowserGrid
          items={items}
          loading={loading}
          loadingMore={loadingMore}
          error={error}
          onRetry={refresh}
          onCardClick={onCardClick}
          showNsfw={filters.showNsfw}
          nsfwFirst={filters.catalog === 'red'}
          sentinelRef={sentinelRef}
        />
      </div>
    </div>
  );
}
