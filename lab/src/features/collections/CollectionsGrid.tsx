import { useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { Slider } from '@/components/ui/Slider';
import { COLLECTIONS_TILE_MAX, COLLECTIONS_TILE_MIN } from '@/lib/storage';
import {
  DownloadIcon, ImagePlaceholderIcon, SearchIcon, UploadIcon,
} from '@/components/ui/icons';
import type { RailBucket, Sort, Source, Tile } from './useCollectionTiles';
import { PixiCollectionsGrid } from './PixiCollectionsGrid';
import { PixiCollectionsFan } from './PixiCollectionsFan';
import { cn } from '@/lib/cn';

export type ViewMode = 'grid' | 'fan';

export function CollectionsGrid({
  tiles,
  bucket,
  selectedId,
  onTileClick,
  search,
  onSearchChange,
  sort,
  onSortChange,
  source,
  onSourceChange,
  viewMode,
  onViewModeChange,
  onGridColsChange,
}: {
  tiles: Tile[];
  bucket: RailBucket;
  selectedId: string | null;
  /** Click handler — the overlay decides whether this is "select" or
   *  "open fullscreen" based on whether the same tile is already selected. */
  onTileClick: (id: string) => void;
  search: string;
  onSearchChange: (next: string) => void;
  sort: Sort;
  onSortChange: (next: Sort) => void;
  source: Source;
  onSourceChange: (next: Source) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  /** Reported up to CollectionsView so up/down arrow keys can step by row. */
  onGridColsChange?: (cols: number) => void;
}) {
  const tileSize = useStore((s) => s.collectionsTileSize);
  const setTileSize = useStore((s) => s.setCollectionsTileSize);
  const addImportedImage = useStore((s) => s.addImportedImage);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);

  const importFiles = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    setImporting(true);
    try {
      for (const file of images) {
        const { width, height } = await readImageDimensions(file);
        await addImportedImage(file, { name: file.name, width, height });
      }
    } finally {
      setImporting(false);
    }
  };

  // Body-level drag handlers — capture even when the pointer enters via the
  // detail drawer or the rail. We only commit the drop if the data actually
  // includes files.
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setDragging(true);
  };
  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    // Only de-highlight when leaving the grid container — not when crossing
    // over a child element.
    if (e.currentTarget === e.target) setDragging(false);
  };
  const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) await importFiles(files);
  };

  return (
    <div
      className="relative flex min-w-0 flex-1 flex-col"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <Toolbar
        search={search} onSearchChange={onSearchChange}
        sort={sort} onSortChange={onSortChange}
        source={source} onSourceChange={onSourceChange}
        tileSize={tileSize} onTileSizeChange={setTileSize}
        viewMode={viewMode} onViewModeChange={onViewModeChange}
        importing={importing}
        onImportClick={() => fileInputRef.current?.click()}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = ''; // allow re-import of the same file
          if (files.length) await importFiles(files);
        }}
      />

      {tiles.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-3">
          <EmptyState bucket={bucket} search={search} onImportClick={() => fileInputRef.current?.click()} />
        </div>
      ) : viewMode === 'fan' ? (
        <PixiCollectionsFan
          tiles={tiles}
          selectedId={selectedId}
          onTileClick={onTileClick}
        />
      ) : (
        <PixiCollectionsGrid
          tiles={tiles}
          tileSize={tileSize}
          selectedId={selectedId}
          onTileClick={onTileClick}
          onColsChange={onGridColsChange}
        />
      )}

      {/* Drop overlay — only shown while a Files-bearing drag is over the
          grid. Pointer-events-none so the underlying onDrop still fires. */}
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-accent-soft/70 backdrop-blur-sm">
          <div className="rounded-lg border-2 border-dashed border-accent bg-bg-panel/95 px-6 py-4 text-center">
            <UploadIcon size={28} className="mx-auto text-accent-fg" />
            <p className="mt-2 text-[13px] font-semibold text-fg-primary">Drop to import</p>
            <p className="mt-0.5 text-[11px] text-fg-dim">PNG · JPG · WEBP — multiple files OK</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Toolbar ────────────────────────────────────────────────────────────────

function Toolbar({
  search, onSearchChange, sort, onSortChange, source, onSourceChange,
  tileSize, onTileSizeChange,
  viewMode, onViewModeChange,
  importing, onImportClick,
}: {
  search: string; onSearchChange: (s: string) => void;
  sort: Sort; onSortChange: (s: Sort) => void;
  source: Source; onSourceChange: (s: Source) => void;
  tileSize: number; onTileSizeChange: (px: number) => void;
  viewMode: ViewMode; onViewModeChange: (m: ViewMode) => void;
  importing: boolean; onImportClick: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-bg-panel/60 px-4 py-2">
      <div className="relative flex min-w-0 max-w-[260px] flex-1 items-center">
        <SearchIcon size={12} className="absolute left-2 text-fg-dim" />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder='Search · prefix "#" for tags only'
          className="w-full rounded-md border border-border-default bg-bg-input pl-7 pr-2 py-1.5 text-[12px] text-fg-secondary placeholder:text-fg-dim outline-none focus:border-accent"
        />
      </div>
      <select
        aria-label="Sort"
        value={sort}
        onChange={(e) => onSortChange(e.target.value as Sort)}
        className="rounded-md border border-border-default bg-bg-elev px-2 py-1.5 text-[11px] text-fg-secondary outline-none focus:border-accent"
      >
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
        <option value="name">By name</option>
      </select>
      <select
        aria-label="Source"
        value={source}
        onChange={(e) => onSourceChange(e.target.value as Source)}
        className="rounded-md border border-border-default bg-bg-elev px-2 py-1.5 text-[11px] text-fg-secondary outline-none focus:border-accent"
      >
        <option value="all">All sources</option>
        <option value="history">Generated</option>
        <option value="imports">Imported</option>
      </select>

      {/* Tile-size slider — grid mode only. */}
      {viewMode === 'grid' && (
        <div className="flex min-w-[140px] max-w-[220px] flex-1 items-center gap-2 px-1" title="Thumbnail size">
          <span aria-hidden className="text-[10px] text-fg-dim">A</span>
          <Slider
            value={tileSize}
            onValueChange={onTileSizeChange}
            min={COLLECTIONS_TILE_MIN}
            max={COLLECTIONS_TILE_MAX}
            step={10}
            ariaLabel="Thumbnail size"
          />
          <span aria-hidden className="text-[13px] text-fg-dim">A</span>
        </div>
      )}

      <div className="flex-1" />

      <ViewModeSwitcher value={viewMode} onChange={onViewModeChange} />

      <button
        type="button"
        onClick={onImportClick}
        disabled={importing}
        className="flex items-center gap-1.5 rounded-md border border-accent bg-accent px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
      >
        <UploadIcon size={12} />
        {importing ? 'Importing…' : 'Import'}
      </button>
    </div>
  );
}

// ─── View-mode switcher ─────────────────────────────────────────────────────

function ViewModeSwitcher({ value, onChange }: { value: ViewMode; onChange: (m: ViewMode) => void }) {
  const opt = (mode: ViewMode, label: string) => (
    <button
      key={mode}
      type="button"
      onClick={() => onChange(mode)}
      aria-pressed={value === mode}
      title={`${label} view`}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded px-2.5 text-[11px] font-semibold transition-colors',
        value === mode
          ? 'bg-bg-base text-fg-primary shadow-sm'
          : 'text-fg-muted hover:text-fg-secondary',
      )}
    >
      <ViewIcon mode={mode} />
      <span>{label}</span>
    </button>
  );
  return (
    <div className="flex h-8 items-center gap-0.5 rounded-md border border-border-default bg-bg-elev p-0.5">
      {opt('grid', 'Grid')}
      {opt('fan', 'Fan')}
    </div>
  );
}

function ViewIcon({ mode }: { mode: ViewMode }) {
  if (mode === 'grid') {
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor" />
        <rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor" />
        <rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor" />
        <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" />
      </svg>
    );
  }
  // fan
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="6" y="3" width="4" height="10" rx="1" fill="currentColor" />
      <rect x="2" y="4" width="3" height="8" rx="1" fill="currentColor" opacity="0.55" transform="rotate(-10 3.5 8)" />
      <rect x="11" y="4" width="3" height="8" rx="1" fill="currentColor" opacity="0.55" transform="rotate(10 12.5 8)" />
    </svg>
  );
}

// ─── Empty state ────────────────────────────────────────────────────────────

function EmptyState({ bucket, search, onImportClick }: { bucket: RailBucket; search: string; onImportClick: () => void }) {
  let title = 'Nothing here yet';
  let body = '';
  if (search) { title = 'No matches'; body = 'Clear the search to see everything.'; }
  else if (bucket === 'imports') body = 'Drop image files anywhere here, or click Import to add some.';
  else if (bucket === 'favorites') body = 'Heart any image to keep it pinned to Favorites.';
  else body = 'Drop image files to import, or generate something to start populating history.';

  return (
    <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-3 text-center text-fg-dim">
      <ImagePlaceholderIcon size={48} className="opacity-50" />
      <p className="text-[14px] font-semibold text-fg-secondary">{title}</p>
      <p className="max-w-[280px] text-[11.5px]">{body}</p>
      {bucket !== 'favorites' && (
        <button
          type="button"
          onClick={onImportClick}
          className="mt-1 flex items-center gap-1.5 rounded-md border border-border-default bg-bg-elev px-3 py-1.5 text-[11px] font-semibold text-fg-secondary hover:border-border-strong"
        >
          <DownloadIcon size={12} className="rotate-180" /> Import images
        </button>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error('Could not decode image'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
