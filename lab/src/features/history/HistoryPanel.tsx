import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { viewUrl } from '@/lib/comfy';
import type { HistoryEntry } from '@/lib/types';
import { FullscreenViewer } from './FullscreenViewer';
import { cn } from '@/lib/cn';
import { CloseIcon, HeartIcon, TrashIcon } from '@/components/ui/icons';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { ImageTile } from '@/components/ui/ImageTile';
import { useShortcut, ShortcutPriority } from '@/hooks/useShortcut';

export interface HistoryPanelProps {
  /**
   * Tile click behavior. `'select-then-open'` (default) requires a second
   * click on an already-selected tile to open the fullscreen viewer — the
   * generate view uses this so the first click just updates the selection.
   * `'open-immediately'` opens the viewer on the first click — canvas view
   * uses this since the canvas compositor doesn't react to selection.
   */
  tileClickMode?: 'select-then-open' | 'open-immediately';
}

/**
 * History is one unified list now — the server that generated an image is just
 * metadata (`entry.serverId`). The tab row ("All" + one per server) filters on
 * that metadata; like/delete go straight through the store.
 */
export function HistoryPanel({ tileClickMode = 'select-then-open' }: HistoryPanelProps = {}) {
  // In 'open-immediately' mode the panel doesn't write to the global
  // `selectedEntry` — that selection drives the generate-view canvas
  // (StrippedCanvas), and bleeding canvas-view clicks into it would make the
  // two views feel synced. Track the active tile locally instead so the
  // fullscreen viewer + arrow keys still have a cursor.
  const isolateSelection = tileClickMode === 'open-immediately';
  const history = useStore(s => s.history);
  const servers = useStore(s => s.servers);
  const globalSelectedEntry = useStore(s => s.selectedEntry);
  const selectHistoryEntry = useStore(s => s.selectHistoryEntry);
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);
  const selectedId = isolateSelection
    ? localSelectedId
    : (globalSelectedEntry?.id ?? null);
  const toggleHistoryLiked = useStore(s => s.toggleHistoryLiked);
  const removeHistoryEntry = useStore(s => s.removeHistoryEntry);
  const clearUnliked = useStore(s => s.clearUnliked);
  const confirm = useConfirm();
  const viewerOpen = useStore(s => s.viewerOpen);
  const openViewer = useStore(s => s.openViewer);
  const closeViewer = useStore(s => s.closeViewer);

  // Tab is a server id, or 'all'.
  const [tab, setTab] = useState<string>('all');
  const [likedOnly, setLikedOnly] = useState(false);
  const [sizes, setSizes] = useState<Record<string, [number, number]>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  const hostFor = useCallback(
    (e: HistoryEntry) => servers.find(s => s.id === e.serverId)?.host ?? '',
    [servers],
  );
  const serverName = useCallback(
    (id: string) => servers.find(s => s.id === id)?.name ?? 'Unknown server',
    [servers],
  );

  const list = useMemo(() => {
    let arr = tab === 'all' ? history : history.filter(h => h.serverId === tab);
    if (likedOnly) arr = arr.filter(h => h.liked);
    return arr;
  }, [tab, history, likedOnly]);

  // Shared by click + arrow keys. In generate mode this writes to global
  // selection (StrippedCanvas reads `selectedEntry` directly); in canvas mode
  // it only updates the panel-local cursor.
  const selectEntry = useCallback((entry: HistoryEntry) => {
    if (isolateSelection) setLocalSelectedId(entry.id);
    else selectHistoryEntry(entry);
  }, [isolateSelection, selectHistoryEntry]);

  // ←/→ step through the current list. Panel priority — the fullscreen
  // viewer registers at TopOverlay so its arrows take precedence when open;
  // the metadata gallery overlay uses Overlay priority, also higher than
  // this panel-level binding.
  const arrowHandler = (dir: -1 | 1) => {
    if (list.length === 0) return;
    const cur = list.findIndex(h => h.id === selectedId);
    const nextIdx = cur < 0
      ? 0
      : dir === -1 ? Math.max(0, cur - 1) : Math.min(list.length - 1, cur + 1);
    const next = list[nextIdx];
    if (next && next.id !== selectedId) selectEntry(next);
  };
  useShortcut('ArrowLeft',  () => arrowHandler(-1), { priority: ShortcutPriority.Panel, when: () => !viewerOpen });
  useShortcut('ArrowRight', () => arrowHandler(1),  { priority: ShortcutPriority.Panel, when: () => !viewerOpen });

  // Keep the selected thumbnail scrolled into view (click or arrow selection).
  // Guard: when the panel is collapsed it's translated off-screen but still in
  // the DOM, and `scrollIntoView` will walk scroll ancestors trying to reveal
  // the tile — which scrolls the app shell sideways and "half-opens" the
  // panel. Skip when our own scroll container isn't on-screen, and constrain
  // the scroll to that container by computing the offset manually instead of
  // letting `scrollIntoView` propagate upward.
  useEffect(() => {
    if (!selectedId) return;
    const container = scrollRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const onScreen =
      rect.width > 0 &&
      rect.height > 0 &&
      rect.right > 0 &&
      rect.left < window.innerWidth;
    if (!onScreen) return;
    const tile = container.querySelector<HTMLElement>(`[data-history-id="${selectedId}"]`);
    if (!tile) return;
    const tileRect = tile.getBoundingClientRect();
    const above = tileRect.top < rect.top;
    const below = tileRect.bottom > rect.bottom;
    if (!above && !below) return;
    const delta = above ? tileRect.top - rect.top : tileRect.bottom - rect.bottom;
    container.scrollBy({ top: delta, behavior: 'smooth' });
  }, [selectedId, list]);

  const unlikedCount = history.filter(h => !h.liked).length;
  const onClearUnliked = async () => {
    if (unlikedCount === 0) return;
    const noun = unlikedCount === 1 ? 'image' : 'images';
    if (await confirm(`Delete ${unlikedCount} non-favorited ${noun}? Liked images are kept.`)) {
      clearUnliked();
    }
  };

  const tabs: { id: string; label: string }[] = [
    { id: 'all', label: 'All' },
    ...servers.map(s => ({ id: s.id, label: s.name })),
  ];
  const viewerIndex = viewerOpen ? Math.max(0, list.findIndex(e => e.id === selectedId)) : -1;

  return (
    <aside className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border-subtle bg-bg-panel px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold text-fg-primary">History</span>
          <span className="rounded bg-bg-elev px-1.5 py-0.5 text-[11px] font-medium text-fg-muted">
            {list.length}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Show favorites only"
            aria-pressed={likedOnly}
            title="Show favorites only"
            onClick={() => setLikedOnly(v => !v)}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-lg border transition-colors',
              likedOnly
                ? 'border-red-500/60 bg-red-500/15 text-red-400'
                : 'border-border-default bg-bg-elev text-fg-tertiary hover:border-border-strong',
            )}
          >
            <HeartIcon size={16} filled={likedOnly} />
          </button>
          <button
            type="button"
            aria-label="Delete non-favorited images"
            title="Delete every non-favorited image"
            onClick={onClearUnliked}
            disabled={unlikedCount === 0}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-lg border border-border-default bg-bg-elev transition-colors',
              unlikedCount === 0
                ? 'cursor-not-allowed text-fg-dim opacity-50'
                : 'text-fg-tertiary hover:border-red-500/60 hover:bg-red-500/10 hover:text-red-400',
            )}
          >
            <TrashIcon size={15} />
          </button>
        </div>
      </div>

      {/* Server filter tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto px-3.5 pt-3 pb-2">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'min-h-[40px] shrink-0 rounded-full border px-3.5 text-[12px] font-medium transition-colors',
              tab === t.id
                ? 'border-accent bg-accent-soft text-accent-fg'
                : 'border-border-default bg-bg-elev text-fg-tertiary hover:border-border-strong',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div ref={scrollRef} className="scroll-y min-h-0 flex-1 px-3.5 pb-3.5 pt-1">
        {list.length === 0 ? (
          <div className="px-2 py-10 text-center text-[12px] italic text-fg-muted">
            {likedOnly ? 'No favorited images here' : 'No generations yet'}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {list.map(entry => {
              const url = viewUrl(entry, hostFor(entry));
              const selected = entry.id === selectedId;
              return (
                <ImageTile
                  key={entry.id}
                  src={url}
                  selected={selected}
                  selectedClassName="border-accent border-2 shadow-[0_0_14px_rgba(79,138,255,0.4)]"
                  className="block w-full"
                  buttonLabel={entry.positive || 'history image'}
                  dragPayload={{ url, name: entry.filename }}
                  onClick={() => {
                    if (tileClickMode === 'open-immediately') {
                      selectEntry(entry);
                      openViewer();
                      return;
                    }
                    if (entry.id === selectedId) { openViewer(); return; }
                    selectEntry(entry);
                  }}
                  onNaturalSize={(w, h) => setSizes(prev =>
                    prev[entry.id]?.[0] === w && prev[entry.id]?.[1] === h
                      ? prev
                      : { ...prev, [entry.id]: [w, h] }
                  )}
                >
                  <div data-history-id={entry.id} className="pointer-events-none absolute inset-0">
                    {/* Server badge — only meaningful on the All tab */}
                    {tab === 'all' && (
                      <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[9px] font-medium text-white/90">
                        {serverName(entry.serverId)}
                      </span>
                    )}
                    {sizes[entry.id] && (
                      <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-black/65 px-1.5 py-0.5 font-mono text-[9px] text-white/90 opacity-0 transition-opacity group-hover:opacity-100">
                        {sizes[entry.id][0]}×{sizes[entry.id][1]}
                      </span>
                    )}
                  </div>

                  {/* Like + delete — always visible so they work on touch */}
                  <button
                    type="button"
                    aria-label={entry.liked ? 'Unfavorite' : 'Favorite'}
                    title={entry.liked ? 'Unfavorite' : 'Favorite'}
                    onClick={(e) => { e.stopPropagation(); toggleHistoryLiked(entry.id); }}
                    className={cn(
                      'absolute left-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-full backdrop-blur-md transition-colors',
                      entry.liked
                        ? 'bg-red-500/85 text-white'
                        : 'bg-black/50 text-white/80 hover:bg-black/70 hover:text-white',
                    )}
                  >
                    <HeartIcon size={16} filled={entry.liked} />
                  </button>
                  <button
                    type="button"
                    aria-label="Delete image"
                    title="Delete image"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (await confirm('Delete this image?')) removeHistoryEntry(entry.id);
                    }}
                    className="absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white/80 backdrop-blur-md transition-colors hover:bg-red-500/80 hover:text-white"
                  >
                    <CloseIcon size={13} />
                  </button>
                </ImageTile>
              );
            })}
          </div>
        )}
      </div>

      {viewerOpen && list.length > 0 && (
        <FullscreenViewer
          list={list}
          index={viewerIndex}
          onIndexChange={(i) => { const next = list[i]; if (next) selectEntry(next); }}
          onClose={closeViewer}
        />
      )}
    </aside>
  );
}
