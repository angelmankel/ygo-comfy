import { useEffect, useMemo, useState } from 'react';
import { CollectionsIcon } from '@/components/ui/icons';
import { CollectionsRail } from './CollectionsRail';
import { CollectionsGrid } from './CollectionsGrid';
import { CollectionDetail } from './CollectionDetail';
import { useCollectionTiles, type RailBucket, type Sort, type Source, type Tile } from './useCollectionTiles';
import { useShortcut, ShortcutPriority } from '@/hooks/useShortcut';
import { FullscreenImage, type FullscreenItem } from '@/components/FullscreenImage';
import type { ViewMode } from './CollectionsGrid';

const VIEW_MODE_KEY = 'imagelab.collections.viewMode.v1';

/**
 * Collections — a top-level view, switched from the sidebar (not an overlay).
 * Fills the main area; the sidebar is the only sibling. Three columns:
 *
 *   ┌─────────┬──────────────────────────────┬───────────┐
 *   │ rail    │ toolbar  +  tile grid        │ detail    │
 *   │  All    │  slider · search · sort      │  preview  │
 *   │  Imp.   │  ┌──┐ ┌──┐ ┌──┐ ┌──┐         │  tags …   │
 *   │  Favs   │  └──┘ └──┘ └──┘ └──┘         │  AI       │
 *   │ ─────   │  ┌──┐ ┌──┐ …                 │  actions  │
 *   │ Custom… │                              │           │
 *   └─────────┴──────────────────────────────┴───────────┘
 *
 * The detail drawer is now *always* mounted (with an empty state when nothing
 * is selected) so the grid doesn't have to resize between selection states —
 * the column count stays stable as you click around. Clicking an already-
 * selected tile opens the fullscreen viewer instead of re-toggling selection.
 */
export function CollectionsView() {
  const [bucket, setBucket] = useState<RailBucket>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const [source, setSource] = useState<Source>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [gridCols, setGridCols] = useState(1);
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(VIEW_MODE_KEY) : null;
    return stored === 'fan' ? 'fan' : 'grid';
  });
  const setViewMode = (m: ViewMode) => {
    setViewModeState(m);
    try { localStorage.setItem(VIEW_MODE_KEY, m); } catch { /* quota */ }
  };

  const { tiles, total } = useCollectionTiles({ bucket, search, sort, source });
  const selectedTile: Tile | null = selectedId ? tiles.find((t) => t.id === selectedId) ?? null : null;

  // When a tile is removed/filtered out from under the selection, clear it.
  useEffect(() => {
    if (selectedId && !tiles.some((t) => t.id === selectedId)) {
      setSelectedId(null);
      setViewerOpen(false);
    }
  }, [tiles, selectedId]);

  /** Tile-click semantics: first click selects, second click on the same tile
   *  opens the fullscreen viewer — works for both history and imports. */
  const onTileClick = (id: string) => {
    if (id !== selectedId) { setSelectedId(id); return; }
    setViewerOpen(true);
  };

  const viewerItems = useMemo<FullscreenItem[]>(
    () => tiles.filter(t => t.thumbnailUrl).map(t => ({ key: t.id, url: t.thumbnailUrl })),
    [tiles],
  );
  const viewerIndex = viewerOpen && selectedId
    ? Math.max(0, viewerItems.findIndex(it => it.key === selectedId))
    : -1;

  // Esc clears tile selection. Switching back to Generate/Canvas is now a
  // sidebar action — there's nothing to "close" here. (Esc closes the
  // fullscreen viewer first via its own TopOverlay shortcut.)
  useShortcut('Escape', () => {
    if (selectedId) setSelectedId(null);
  }, { priority: ShortcutPriority.Overlay, when: () => selectedId !== null && !viewerOpen });

  // Arrow keys step through the visible tile list. Left/right move one tile
  // in either mode; up/down jump by a full row in grid mode (fan mode treats
  // them as left/right since there are no rows). Bumped to Overlay priority
  // so the History panel's own arrow handlers stand down while Collections
  // is up.
  const stepSelection = (delta: number) => {
    if (!tiles.length) return;
    const curIdx = selectedId ? tiles.findIndex(t => t.id === selectedId) : -1;
    const nextIdx = curIdx < 0
      ? (delta > 0 ? 0 : tiles.length - 1)
      : Math.max(0, Math.min(tiles.length - 1, curIdx + delta));
    const nextTile = tiles[nextIdx];
    if (nextTile) setSelectedId(nextTile.id);
  };
  const rowStep = viewMode === 'grid' ? Math.max(1, gridCols) : 1;
  useShortcut('ArrowLeft',  () => stepSelection(-1),     { priority: ShortcutPriority.Overlay, when: () => !viewerOpen });
  useShortcut('ArrowRight', () => stepSelection(1),      { priority: ShortcutPriority.Overlay, when: () => !viewerOpen });
  useShortcut('ArrowUp',    () => stepSelection(-rowStep), { priority: ShortcutPriority.Overlay, when: () => !viewerOpen });
  useShortcut('ArrowDown',  () => stepSelection(rowStep),  { priority: ShortcutPriority.Overlay, when: () => !viewerOpen });

  return (
    <div className="flex h-full w-full flex-col bg-bg-base">
      <header className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-bg-panel px-3 py-2">
        <CollectionsIcon size={15} className="text-fg-tertiary" />
        <span className="text-[12.5px] font-semibold text-fg-primary">Collections</span>
        <span className="rounded bg-bg-elev px-1.5 py-0.5 text-[10px] font-medium text-fg-muted">
          {total}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <CollectionsRail bucket={bucket} onChange={setBucket} />
        <CollectionsGrid
          tiles={tiles}
          bucket={bucket}
          selectedId={selectedId}
          onTileClick={onTileClick}
          search={search}
          onSearchChange={setSearch}
          sort={sort}
          onSortChange={setSort}
          source={source}
          onSourceChange={setSource}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onGridColsChange={setGridCols}
        />
        <CollectionDetail tile={selectedTile} onClose={() => setSelectedId(null)} />
      </div>

      {viewerOpen && viewerIndex >= 0 && (
        <FullscreenImage
          items={viewerItems}
          index={viewerIndex}
          onIndexChange={(i) => {
            const next = viewerItems[i];
            if (next) setSelectedId(next.key);
          }}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </div>
  );
}
