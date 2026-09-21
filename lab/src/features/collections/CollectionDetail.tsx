import { useState } from 'react';
import * as RPopover from '@radix-ui/react-popover';
import { useStore } from '@/lib/store';
import { getImportedBlob } from '@/lib/importedDb';
import {
  blobToDataUrl,
  describeImage,
  httpUrlToDataUrl,
  promptFromImage,
  tagImage,
  TAG_COUNT_DEFAULT, TAG_COUNT_MIN, TAG_COUNT_MAX,
  VENICE_VISION_MODELS,
  type DescribeLength,
  type TagStyle,
} from '@/lib/venice';
import { cn } from '@/lib/cn';
import {
  CheckIcon, CloseIcon, CopyIcon, DownloadIcon,
  GenerateIcon, HeartIcon, ImagePlaceholderIcon, PlusIcon, SparkleIcon,
} from '@/components/ui/icons';
import type { Tile } from './useCollectionTiles';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { useConfirm } from '@/components/ui/ConfirmDialog';

/**
 * Right-side detail drawer. Always mounted — when no tile is selected,
 * shows a lightweight empty state. The previous behavior toggled this
 * column between present/absent and the grid had to reflow each time,
 * which the user (rightly) called out as jarring; keeping the column
 * stable means tile sizes never change between selection states.
 *
 * Layout: small preview at the top, compact metadata, then a single
 * Venice section that groups Tag / Describe / Prompt into tabs to stop
 * the body from running long. Each tab keeps its result inline so users
 * see the most-recent output without expanding anything.
 */
export function CollectionDetail({ tile, onClose }: { tile: Tile | null; onClose: () => void }) {
  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-border-subtle bg-bg-panel">
      <header className="flex shrink-0 items-center gap-2 border-b border-border-subtle px-3 py-2">
        <span
          className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-fg-primary"
          title={tile?.title}
        >
          {tile?.title ?? 'No image selected'}
        </span>
        {tile && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Clear selection"
            title="Clear selection"
            className="flex h-7 w-7 items-center justify-center rounded-md text-fg-dim hover:bg-bg-elev hover:text-fg-secondary"
          >
            <CloseIcon size={13} />
          </button>
        )}
      </header>

      {tile && <TileActionRow tile={tile} />}
      {tile ? <DetailBody tile={tile} /> : <EmptyState />}
    </aside>
  );
}

function TileActionRow({ tile }: { tile: Tile }) {
  const toggleHistoryLiked = useStore((s) => s.toggleHistoryLiked);
  const toggleImportedLiked = useStore((s) => s.toggleImportedLiked);
  const removeHistoryEntry = useStore((s) => s.removeHistoryEntry);
  const removeImportedImage = useStore((s) => s.removeImportedImage);
  const removeServerFavorite = useStore((s) => s.removeServerFavorite);
  const removeItemFromAllCollections = useStore((s) => s.removeItemFromAllCollections);
  const confirm = useConfirm();

  const toggleLiked = () => {
    if (tile.source === 'history') toggleHistoryLiked(tile.id);
    else if (tile.source === 'import') toggleImportedLiked(tile.id);
    // For a server favorite the only meaningful "unfavorite" is to remove
    // it from disk — there's no local-only "starred" bit to flip.
    else if (tile.source === 'favorite' && tile.favorite) {
      removeServerFavorite(tile.favorite.serverId, tile.favorite.id);
    }
  };
  const deleteTile = async () => {
    const label =
      tile.source === 'history'  ? 'this generated image' :
      tile.source === 'favorite' ? 'this favorite from the server' :
                                   'this imported image';
    if (!await confirm(`Delete ${label}?`)) return;
    if (tile.source === 'history') { removeHistoryEntry(tile.id); removeItemFromAllCollections(tile.id); }
    else if (tile.source === 'import') removeImportedImage(tile.id);
    else if (tile.source === 'favorite' && tile.favorite) removeServerFavorite(tile.favorite.serverId, tile.favorite.id);
  };

  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-border-subtle bg-bg-panel/60 px-3 py-2">
      <button
        type="button"
        onClick={toggleLiked}
        aria-label={tile.liked ? 'Unfavorite' : 'Favorite'}
        title={tile.liked ? 'Unfavorite' : 'Favorite'}
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-md border transition-colors',
          tile.liked
            ? 'border-coral-bg/40 bg-coral-bg/30 text-coral-fg'
            : 'border-border-default bg-bg-elev text-fg-dim hover:text-coral-fg',
        )}
      >
        <HeartIcon size={14} filled={tile.liked} />
      </button>
      <AddToCollectionButton tileId={tile.id} />
      <div className="flex-1" />
      <button
        type="button"
        onClick={deleteTile}
        aria-label="Delete image"
        title="Delete"
        className="flex h-8 w-8 items-center justify-center rounded-md border border-border-default bg-bg-elev text-fg-dim transition-colors hover:text-status-err"
      >
        <CloseIcon size={14} />
      </button>
    </div>
  );
}

function AddToCollectionButton({ tileId }: { tileId: string }) {
  const collections = useStore((s) => s.collections);
  const addToCollection = useStore((s) => s.addToCollection);
  const removeFromCollection = useStore((s) => s.removeFromCollection);
  const createCollection = useStore((s) => s.createCollection);
  const [open, setOpen] = useState(false);

  return (
    <RPopover.Root open={open} onOpenChange={setOpen}>
      <RPopover.Trigger asChild>
        <button
          type="button"
          aria-label="Add to collection"
          title="Add to collection"
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border-default bg-bg-elev text-fg-dim transition-colors hover:text-accent-fg"
        >
          <PlusIcon size={14} />
        </button>
      </RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content
          align="start"
          sideOffset={6}
          className="z-[70] w-56 rounded-lg border border-border-default bg-bg-panel p-1 shadow-lg"
        >
          {collections.length === 0 ? (
            <p className="px-2 py-2 text-[11px] italic text-fg-dim">No collections yet — create one from the rail.</p>
          ) : (
            collections.map((c) => {
              const isMember = c.itemIds.includes(tileId);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => isMember ? removeFromCollection(c.id, tileId) : addToCollection(c.id, tileId)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-fg-secondary transition-colors hover:bg-bg-elev"
                >
                  <span aria-hidden className="w-3 text-fg-dim">{isMember && <CheckIcon size={12} />}</span>
                  <span aria-hidden className="text-[11px]">{c.icon ?? '📁'}</span>
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="text-[10px] tabular-nums text-fg-dim">{c.itemIds.length}</span>
                </button>
              );
            })
          )}
          <div className="my-1 border-t border-border-subtle" />
          <button
            type="button"
            onClick={() => {
              const name = prompt('New collection name')?.trim();
              if (!name) return;
              const id = createCollection(name);
              addToCollection(id, tileId);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11.5px] text-accent-fg transition-colors hover:bg-bg-elev"
          >
            <PlusIcon size={12} /> New collection…
          </button>
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <ImagePlaceholderIcon size={36} className="text-fg-dim" />
      <p className="text-[12px] font-medium text-fg-secondary">No image selected</p>
      <p className="text-[11px] leading-relaxed text-fg-muted">
        Click any tile to load metadata and Venice AI tools here.
        Click it again to open the fullscreen viewer.
      </p>
    </div>
  );
}

function DetailBody({ tile }: { tile: Tile }) {
  const venice = useStore((s) => s.venice);
  const setItemAi = useStore((s) => s.setItemAi);
  const addLayer = useStore((s) => s.addLayer);
  const layers = useStore((s) => s.layers);
  const removeLayer = useStore((s) => s.removeLayer);
  const setStatus = useStore((s) => s.setStatus);

  const [tab, setTab] = useState<'tags' | 'describe' | 'prompt'>('tags');
  const [tagStyle, setTagStyle] = useState<TagStyle>('danbooru');
  const [tagCount, setTagCount] = useState<number>(TAG_COUNT_DEFAULT);
  const [descLength, setDescLength] = useState<DescribeLength>('detailed');
  const [visionModel, setVisionModel] = useState<string>(VENICE_VISION_MODELS[0].id);

  /** Tag <-> layer matching: when a tag is "added as a layer" we use
   *  tag='AI' + the tag text. To toggle a single tag back off we look for
   *  any positive layer with those two fields matching. Match is text-only
   *  so a layer added by hand with the same text is also considered "on". */
  const findLayerForTag = (tag: string) =>
    layers.find((l) => l.kind === 'positive' && l.tag === 'AI' && l.text === tag);

  const toggleTagLayer = (tag: string) => {
    const existing = findLayerForTag(tag);
    if (existing) {
      removeLayer(existing.id);
    } else {
      addLayer('positive', { tag: 'AI', text: tag, weight: 1.0 });
    }
  };

  const [running, setRunning] = useState<null | 'tag' | 'describe' | 'prompt'>(null);
  const [error, setError] = useState<string | null>(null);
  const { copy, copied } = useCopyToClipboard(1100);

  /** Resolve the image bytes for whichever tile is selected — imports come
   *  from IDB, history fetches the ComfyUI `/view?…` URL through the
   *  browser. Returns a data URL ready to feed Venice. */
  const resolveImageDataUrl = async (): Promise<string> => {
    if (tile.source === 'import') {
      const blob = await getImportedBlob(tile.id);
      if (!blob) throw new Error('Imported image blob is missing — was it cleared from the browser?');
      return blobToDataUrl(blob);
    }
    if (!tile.thumbnailUrl) throw new Error("Can't reach this image — is the source server online?");
    return httpUrlToDataUrl(tile.thumbnailUrl);
  };

  const settingsWithModel = { ...venice, model: visionModel || venice.model };

  const runTag = async () => {
    setRunning('tag'); setError(null);
    try {
      const dataUrl = await resolveImageDataUrl();
      const { tags } = await tagImage(dataUrl, tagStyle, settingsWithModel, { maxTags: tagCount });
      if (!tags.length) throw new Error('Venice returned no tags. Try a different style or model.');
      setItemAi(tile.id, { tags });
      setStatus(`Tagged ${tags.length} tags from Venice`, 'ok');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(null);
    }
  };

  const runDescribe = async () => {
    setRunning('describe'); setError(null);
    try {
      const dataUrl = await resolveImageDataUrl();
      const description = await describeImage(dataUrl, descLength, settingsWithModel);
      if (!description) throw new Error('Venice returned an empty description.');
      setItemAi(tile.id, { description });
      setStatus('Description ready', 'ok');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(null);
    }
  };

  const runPrompt = async () => {
    setRunning('prompt'); setError(null);
    try {
      const dataUrl = await resolveImageDataUrl();
      const aiPrompt = await promptFromImage(dataUrl, settingsWithModel);
      if (!aiPrompt) throw new Error('Venice returned an empty prompt.');
      setItemAi(tile.id, { aiPrompt });
      setStatus('Prompt generated', 'ok');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(null);
    }
  };

  const addTagsAsLayers = () => {
    if (!tile.tags?.length) return;
    let added = 0;
    for (const tag of tile.tags) {
      if (findLayerForTag(tag)) continue; // already on — don't duplicate
      addLayer('positive', { tag: 'AI', text: tag, weight: 1.0 });
      added++;
    }
    if (added) setStatus(`Added ${added} tags as layers`, 'ok');
    else setStatus('All tags already added', 'ok');
  };

  return (
    <div className="scroll-y flex min-h-0 flex-1 flex-col gap-3 px-3 py-3">
      {/* Preview — smaller now (16rem max) so the AI tools below get more
          room without scrolling. */}
      <div className="flex max-h-[240px] items-center justify-center overflow-hidden rounded-lg border border-border-subtle bg-bg-base">
        {tile.thumbnailUrl ? (
          <img src={tile.thumbnailUrl} alt="" className="max-h-[240px] max-w-full object-contain" />
        ) : (
          <ImagePlaceholderIcon size={36} className="text-fg-dim" />
        )}
      </div>

      {/* Metadata — single-line chips instead of a 2-col dl, easier to scan. */}
      <div className="flex flex-wrap gap-1">
        <MetaChip
          label={tile.source === 'history' ? 'Generated' : tile.source === 'favorite' ? 'Favorited' : 'Imported'}
          accent
        />
        {tile.width && tile.height && <MetaChip label={`${tile.width}×${tile.height}`} />}
        {tile.source === 'history' && tile.history?.model && (
          <MetaChip label={truncate(tile.history.model, 32)} title={tile.history.model} />
        )}
        {tile.source === 'history' && tile.history && (
          <MetaChip label={`seed ${tile.history.seed}`} />
        )}
        {tile.source === 'import' && tile.imported && (
          <MetaChip label={formatBytes(tile.imported.bytes)} />
        )}
        {tile.source === 'import' && tile.thumbnailUrl && (
          <a
            href={tile.thumbnailUrl}
            download={tile.imported?.name || 'image.png'}
            title="Download original"
            className="flex items-center gap-1 rounded bg-bg-elev px-1.5 py-0.5 text-[10.5px] text-fg-tertiary hover:text-accent-fg"
          >
            <DownloadIcon size={10} />
            Download
          </a>
        )}
      </div>

      {/* Venice AI block — tabs replace the old three stacked Sections. */}
      <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-bg-base/30 p-2">
        {!venice.apiKey ? (
          <p className="rounded-md bg-bg-elev px-2 py-1.5 text-[11px] text-fg-dim">
            Add a Venice API key in Settings → AI to enable tagging, descriptions, and image-to-prompt.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <div className="flex flex-1 rounded-md border border-border-default bg-bg-input p-0.5">
                <TabButton active={tab === 'tags'} onClick={() => setTab('tags')}>Tags</TabButton>
                <TabButton active={tab === 'describe'} onClick={() => setTab('describe')}>Describe</TabButton>
                <TabButton active={tab === 'prompt'} onClick={() => setTab('prompt')}>Prompt</TabButton>
              </div>
              <select
                aria-label="Vision model"
                value={visionModel}
                onChange={(e) => setVisionModel(e.target.value)}
                className="max-w-[120px] rounded-md border border-border-default bg-bg-input px-1.5 py-1 text-[10.5px] text-fg-secondary outline-none focus:border-accent"
                title={VENICE_VISION_MODELS.find((m) => m.id === visionModel)?.note ?? ''}
              >
                {VENICE_VISION_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>

            {error && (
              <p className="rounded border border-status-err/40 bg-status-err/10 px-2 py-1 text-[10.5px] text-status-err">
                {error}
              </p>
            )}

            {tab === 'tags' && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5">
                  <select
                    value={tagStyle}
                    onChange={(e) => setTagStyle(e.target.value as TagStyle)}
                    className="rounded border border-border-default bg-bg-input px-2 py-1 text-[11px] text-fg-secondary outline-none focus:border-accent"
                    disabled={running === 'tag'}
                  >
                    <option value="danbooru">Danbooru</option>
                    <option value="natural">Natural</option>
                    <option value="sdxl">SDXL prompt</option>
                  </select>
                  <label className="flex items-center gap-1 text-[10.5px] text-fg-dim" title="How many tags to request">
                    <span className="select-none">#</span>
                    <input
                      type="number"
                      value={tagCount}
                      onChange={(e) => setTagCount(Math.max(TAG_COUNT_MIN, Math.min(TAG_COUNT_MAX, Number(e.target.value) || TAG_COUNT_DEFAULT)))}
                      min={TAG_COUNT_MIN}
                      max={TAG_COUNT_MAX}
                      step={1}
                      disabled={running === 'tag'}
                      className="w-12 rounded border border-border-default bg-bg-input px-1 py-0.5 text-center text-[11px] text-fg-secondary outline-none focus:border-accent"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={runTag}
                    disabled={!venice.apiKey || running !== null}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-accent bg-accent px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                  >
                    <SparkleIcon size={11} />
                    {running === 'tag' ? 'Tagging…' : tile.tags?.length ? 'Re-tag' : 'Tag image'}
                  </button>
                </div>
                {tile.tags && tile.tags.length > 0 && (
                  <>
                    <p className="text-[10px] text-fg-dim">
                      Click a tag to add it as a positive prompt layer · click again to remove
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {tile.tags.map((t, i) => {
                        const on = !!findLayerForTag(t);
                        return (
                          <button
                            key={`${t}-${i}`}
                            type="button"
                            onClick={() => toggleTagLayer(t)}
                            title={on ? 'Remove from layers' : 'Add as positive layer'}
                            className={cn(
                              'rounded px-1.5 py-0.5 text-[10.5px] transition-colors',
                              on
                                ? 'bg-accent text-white hover:bg-accent-hover'
                                : 'bg-bg-elev text-fg-tertiary hover:bg-bg-elev/70 hover:text-accent-fg',
                            )}
                          >
                            {t}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={addTagsAsLayers}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border-default bg-bg-elev px-2 py-1.5 text-[11px] text-fg-secondary hover:border-border-strong hover:text-accent-fg"
                        title="Add every tag as a positive prompt layer"
                      >
                        <GenerateIcon size={11} /> Add all as layers
                      </button>
                      <CopyButton
                        copied={copied === 'tags'}
                        onClick={() => void copy(tile.tags!.join(', '), 'tags')}
                        title="Copy comma-separated tags"
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {tab === 'describe' && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5">
                  <select
                    value={descLength}
                    onChange={(e) => setDescLength(e.target.value as DescribeLength)}
                    className="rounded border border-border-default bg-bg-input px-2 py-1 text-[11px] text-fg-secondary outline-none focus:border-accent"
                    disabled={running === 'describe'}
                  >
                    <option value="short">Short</option>
                    <option value="detailed">Detailed</option>
                  </select>
                  <button
                    type="button"
                    onClick={runDescribe}
                    disabled={!venice.apiKey || running !== null}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-accent bg-accent px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                  >
                    <SparkleIcon size={11} />
                    {running === 'describe' ? 'Describing…' : tile.description ? 'Re-describe' : 'Describe'}
                  </button>
                </div>
                {tile.description && (
                  <ResultBlock
                    text={tile.description}
                    copied={copied === 'description'}
                    onCopy={() => void copy(tile.description!, 'description')}
                  />
                )}
              </div>
            )}

            {tab === 'prompt' && (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={runPrompt}
                  disabled={!venice.apiKey || running !== null}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-accent bg-accent px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  <SparkleIcon size={11} />
                  {running === 'prompt' ? 'Writing…' : tile.aiPrompt ? 'Re-generate prompt' : 'Generate prompt'}
                </button>
                {tile.aiPrompt && (
                  <ResultBlock
                    text={tile.aiPrompt}
                    copied={copied === 'prompt'}
                    onCopy={() => void copy(tile.aiPrompt!, 'prompt')}
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>

      {tile.source === 'history' && tile.history?.positive && (
        <details className="rounded-lg border border-border-subtle bg-bg-base/30 px-2 py-1.5">
          <summary className="cursor-pointer text-[10.5px] font-semibold uppercase tracking-section text-fg-dim">
            Original prompt
          </summary>
          <p className="mt-1.5 whitespace-pre-line rounded bg-bg-elev px-2 py-1.5 text-[11px] text-fg-tertiary">
            {tile.history.positive}
          </p>
        </details>
      )}
    </div>
  );
}

// ─── Small atoms ────────────────────────────────────────────────────────────

function MetaChip({ label, accent, title }: { label: string; accent?: boolean; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        'rounded px-1.5 py-0.5 text-[10.5px]',
        accent
          ? 'bg-accent-soft text-accent-fg'
          : 'bg-bg-elev text-fg-tertiary',
      )}
    >
      {label}
    </span>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 rounded px-2 py-1 text-[11px] font-medium transition-colors',
        active ? 'bg-accent text-white' : 'text-fg-tertiary hover:text-fg-secondary',
      )}
    >
      {children}
    </button>
  );
}

function ResultBlock({ text, copied, onCopy }: { text: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="space-y-1.5">
      <p className="whitespace-pre-line rounded-md bg-bg-elev px-2 py-1.5 text-[11.5px] text-fg-tertiary">
        {text}
      </p>
      <CopyButton copied={copied} onClick={onCopy} title="Copy" full />
    </div>
  );
}

function CopyButton({ copied, onClick, title, full }: { copied: boolean; onClick: () => void; title: string; full?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'flex items-center justify-center gap-1 rounded-md border border-border-default bg-bg-elev px-2 py-1 text-[10.5px] text-fg-secondary hover:border-border-strong',
        full && 'w-full',
        copied && 'text-accent-fg',
      )}
    >
      {copied ? <CheckIcon size={11} /> : <CopyIcon size={11} />}
      {copied ? 'Copied' : title}
    </button>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
