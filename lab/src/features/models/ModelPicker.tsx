import { useEffect, useMemo, useState, type ReactElement } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { cn } from '@/lib/cn';
import { useStore } from '@/lib/store';
import { availabilityHint } from '@/hooks/useResourceAvailability';
import { orderForPreview, type BaseModelBucket } from '@/lib/modelHash';
import type { ModelKind } from './types';
import { KindBadge, PreviewThumb, ModelPreviewTooltip } from './primitives';
import { RefreshIcon } from '@/components/ui/icons';

type Props = {
  kind: ModelKind;
  /** All model file names available across every server for this kind. */
  options: string[];
  /** File names already in use — shown dimmed with an "added" marker. */
  selected?: string[];
  onSelect: (name: string) => void;
  /** Label on the trigger button, e.g. "Add" / "Change" / "Set". */
  triggerLabel: string;
  /**
   * Per-model availability for the current routing target. Models that aren't
   * available are shown disabled (still visible) with a tooltip listing which
   * server(s) have them; available ones get an informational tooltip too.
   */
  availability?: (name: string) => { servers: string[]; serverIds: string[]; enabled: boolean };
  /** Ordered preview-image candidates per model — the first non-404 wins. */
  previewUrls?: (name: string) => string[];
  /** Local history image URLs for a model, newest first. Optional — only
   *  meaningful when the user has run this model locally. */
  historyUrls?: (name: string) => string[];
  /** Base-model bucket per model (SDXL / Pony / Flux / …). Drives the filter
   *  chip row above the results. Unset = all options group as "Unknown". */
  getBaseBucket?: (name: string) => BaseModelBucket;
  /**
   * Render a custom trigger (e.g. the per-card edit pencil) instead of the
   * default "+ Add" pill. The returned element is rendered as the Radix
   * `Popover.Trigger asChild`, so it must forward `ref` / `onClick` — a plain
   * `<button>` works out of the box.
   */
  renderTrigger?: () => ReactElement;
  /** Side the popover prefers — defaults to `'bottom'`. */
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Alignment along the chosen side — defaults to `'end'`. */
  align?: 'start' | 'center' | 'end';
};

const KIND_NOUN: Record<ModelKind, string> = {
  checkpoint: 'checkpoints',
  lora: 'LoRAs',
  vae: 'VAEs',
};

/**
 * Searchable model picker — a Radix popover anchored to a small trigger button.
 * Lists the kind's available models as cards; clicking one calls `onSelect` and
 * closes the popover. Generic over kind, so checkpoint / VAE / LoRA share it.
 *
 * Hovering a row mounts a large slideshow tooltip via <ModelPreviewTooltip>.
 * The bucket filter is persisted per-kind in localStorage (via the store) so
 * the popover comes back the same way you left it.
 */
export function ModelPicker({
  kind, options, selected = [], onSelect, triggerLabel, availability,
  previewUrls, historyUrls, getBaseBucket, renderTrigger,
  side = 'bottom', align = 'end',
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  // Persisted base-model filter — load when the popover opens, save on every
  // change. Default is 'all'; legacy / unknown values fall back to that too.
  const persistedFilter = useStore((s) => s.modelPickerFilters[kind]);
  const setPersistedFilter = useStore((s) => s.setModelPickerFilter);
  const previewSource = useStore((s) => s.modelPreviewSource);
  const [bucket, setBucket] = useState<BaseModelBucket | 'all'>(
    (persistedFilter as BaseModelBucket | 'all') || 'all',
  );
  // Re-sync if the store changes from elsewhere (rare, but keeps state honest).
  useEffect(() => {
    setBucket((persistedFilter as BaseModelBucket | 'all') || 'all');
  }, [persistedFilter]);

  // Per-server filter — list of server IDs we restrict the results to. Empty
  // = no filter (show all). Persisted per-kind.
  const servers = useStore((s) => s.servers);
  const refreshServerInfo = useStore((s) => s.refreshServerInfo);
  const [refreshing, setRefreshing] = useState(false);

  // Re-fetch /object_info from every server. The custom-node download flow
  // already triggers this on completion, but a manual refresh handles cases
  // where ComfyUI's folder-mtime cache missed a new file (or the user added
  // models out-of-band, e.g. via SSH).
  const refreshAllServers = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all(servers.map((sv) => refreshServerInfo(sv.id)));
    } finally {
      setRefreshing(false);
    }
  };
  const persistedServerFilter = useStore((s) => s.serverPickerFilters[kind]);
  const setPersistedServerFilter = useStore((s) => s.setServerPickerFilter);
  // Stale IDs (server was removed) just no-op the filter; we don't auto-prune
  // so the user's selection survives a momentary server-list rebuild.
  const serverFilter: string[] = persistedServerFilter ?? [];
  const toggleServer = (id: string) => {
    const next = serverFilter.includes(id)
      ? serverFilter.filter((x) => x !== id)
      : [...serverFilter, id];
    setPersistedServerFilter(kind, next);
  };
  const clearServerFilter = () => setPersistedServerFilter(kind, []);

  // Per-option base bucket — memoised so we don't re-walk every keystroke.
  const buckets = useMemo(() => {
    const map = new Map<string, BaseModelBucket>();
    for (const name of options) map.set(name, getBaseBucket?.(name) ?? 'Unknown');
    return map;
  }, [options, getBaseBucket]);

  // Which buckets are actually present in this option list, in BASE_MODEL_BUCKETS
  // order — keeps the chip row tidy when only two or three families exist.
  const presentBuckets = useMemo(() => {
    const counts = new Map<BaseModelBucket, number>();
    for (const b of buckets.values()) counts.set(b, (counts.get(b) ?? 0) + 1);
    return counts;
  }, [buckets]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const serverSet = serverFilter.length ? new Set(serverFilter) : null;
    return options.filter((o) => {
      if (bucket !== 'all' && buckets.get(o) !== bucket) return false;
      if (q && !o.toLowerCase().includes(q)) return false;
      if (serverSet) {
        const av = availability?.(o);
        if (!av) return false;
        if (!av.serverIds.some((id) => serverSet.has(id))) return false;
      }
      return true;
    });
  }, [options, buckets, bucket, query, serverFilter, availability]);

  const close = () => {
    setOpen(false);
    setQuery('');
    // Keep the bucket filter — it's persisted; resetting on close would
    // contradict the user's "survives refreshes" expectation.
  };

  const applyBucket = (b: BaseModelBucket | 'all') => {
    setBucket(b);
    setPersistedFilter(kind, b);
  };

  return (
    <Popover.Root open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <Popover.Trigger asChild>
        {renderTrigger ? renderTrigger() : (
          <button
            type="button"
            className="flex items-center gap-1 rounded-md border border-border-default bg-bg-elev px-2 py-1 text-[11px] font-medium text-fg-tertiary transition-colors hover:border-border-strong hover:text-fg-secondary"
          >
            <span className="text-fg-muted">+</span> {triggerLabel}
          </button>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className="z-50 w-[360px] overflow-hidden rounded-lg border border-border-default bg-bg-elev shadow-[0_20px_60px_rgba(0,0,0,0.6)]"
        >
          <div className="flex flex-col gap-1.5 border-b border-border-subtle p-2">
            <div className="flex items-stretch gap-1.5">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${options.length} ${KIND_NOUN[kind]}…`}
                className="min-w-0 flex-1 rounded-md border border-border-default bg-bg-input px-2.5 py-1.5 text-[12px] text-fg-secondary placeholder:text-fg-dim outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={refreshAllServers}
                disabled={refreshing}
                title="Re-scan every server for new model files"
                aria-label="Refresh model list"
                className={cn(
                  'flex shrink-0 items-center justify-center rounded-md border border-border-default bg-bg-elev px-2 text-fg-tertiary transition-colors hover:border-border-strong hover:text-fg-secondary disabled:cursor-not-allowed disabled:opacity-50',
                  refreshing && 'animate-spin-slow',
                )}
              >
                <RefreshIcon size={13} />
              </button>
            </div>
            <BucketChips
              presentBuckets={presentBuckets}
              selected={bucket}
              onSelect={applyBucket}
              totalCount={options.length}
            />
            {servers.length > 1 && (
              <>
                <div className="-mx-2 border-t border-border-subtle" />
                <ServerToggles
                  servers={servers.map((s) => ({ id: s.id, name: s.name }))}
                  selected={serverFilter}
                  onToggle={toggleServer}
                  onClear={clearServerFilter}
                />
              </>
            )}
          </div>
          <div className="scroll-y max-h-[420px] p-1.5">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-3 py-8 text-center text-[11px] text-fg-dim">
                {options.length === 0 ? (
                  <>
                    <p>No {KIND_NOUN[kind]} reported by any server.</p>
                    <p className="leading-snug text-fg-faint">
                      If you just downloaded one, ComfyUI may not have noticed the new file yet.
                      Try the refresh button — or click <span className="font-medium text-fg-tertiary">Refresh</span> in
                      ComfyUI's own sidebar.
                    </p>
                    <button
                      type="button"
                      onClick={refreshAllServers}
                      disabled={refreshing}
                      className="flex items-center gap-1.5 rounded-md border border-accent bg-accent px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RefreshIcon size={12} className={refreshing ? 'animate-spin-slow' : undefined} />
                      {refreshing ? 'Refreshing…' : 'Refresh now'}
                    </button>
                  </>
                ) : (
                  <>
                    <p>No {KIND_NOUN[kind]} match the current filters.</p>
                    {bucket !== 'all' && (
                      <button
                        type="button"
                        onClick={() => applyBucket('all')}
                        className="rounded-md border border-border-default bg-bg-elev px-2.5 py-1 text-[11px] font-medium text-fg-tertiary hover:border-border-strong hover:text-fg-secondary"
                      >
                        Clear base-model filter ({String(bucket)})
                      </button>
                    )}
                  </>
                )}
              </div>
            ) : (
              filtered.map((name) => {
                const isSelected = selected.includes(name);
                const av = availability?.(name);
                // Not available on the routing target → disabled but visible.
                const unavailable = !!av && !av.enabled;
                const availabilityText = av ? availabilityHint(av) : undefined;
                const availabilityTone: 'ok' | 'warn' | 'err' = !av
                  ? 'ok'
                  : av.servers.length === 0
                    ? 'err'
                    : av.enabled
                      ? 'ok'
                      : 'warn';
                const srcs = previewUrls?.(name) ?? [];
                const histSrcs = historyUrls?.(name) ?? [];
                const bucketLabel = buckets.get(name);
                // Resolver is called fresh on every hover-open by the tooltip,
                // so `previewSource === 'random'` shuffles each time.
                const getOrdered = () => orderForPreview(srcs, histSrcs, previewSource);
                const row = (
                  <button
                    type="button"
                    disabled={unavailable}
                    onClick={() => {
                      onSelect(name);
                      close();
                    }}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md p-1.5 text-left transition-colors',
                      unavailable
                        ? 'cursor-not-allowed opacity-40'
                        : 'hover:bg-bg-card-on',
                      isSelected && !unavailable && 'opacity-55',
                    )}
                  >
                    <PreviewThumb srcs={srcs} className="h-20 w-20 shrink-0 rounded-md" label="" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="line-clamp-2 break-all text-[12px] leading-snug text-fg-secondary">{name}</span>
                      <div className="flex flex-wrap items-center gap-1">
                        <KindBadge kind={kind} className="self-start" />
                        {bucketLabel && bucketLabel !== 'Unknown' && (
                          <span className="rounded bg-bg-card-on px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-tag text-fg-tertiary">
                            {bucketLabel}
                          </span>
                        )}
                        {isSelected && <span className="text-[9.5px] uppercase tracking-tag text-fg-dim">added</span>}
                        {!isSelected && unavailable && (
                          <span className="text-[9.5px] uppercase tracking-tag text-fg-dim">off-server</span>
                        )}
                      </div>
                    </div>
                  </button>
                );
                return (
                  <ModelPreviewTooltip
                    key={name}
                    getSrcs={getOrdered}
                    caption={name}
                    subCaption={bucketLabel && bucketLabel !== 'Unknown' ? bucketLabel : undefined}
                    availability={availabilityText}
                    availabilityTone={availabilityTone}
                  >
                    {row}
                  </ModelPreviewTooltip>
                );
              })
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ---------------------------------------------------------------------------
// Base-model filter chips — only buckets that appear in the option list are
// rendered, in their canonical order. Hidden entirely when only one bucket
// would show up (so VAE pickers / single-family setups stay uncluttered).
// ---------------------------------------------------------------------------

function BucketChips({
  presentBuckets, selected, onSelect, totalCount,
}: {
  presentBuckets: Map<BaseModelBucket, number>;
  selected: BaseModelBucket | 'all';
  onSelect: (b: BaseModelBucket | 'all') => void;
  totalCount: number;
}) {
  if (presentBuckets.size <= 1) return null;
  // Render in the canonical order from BASE_MODEL_BUCKETS — we can't import it
  // here because it's the same as the type union; iterate by the source list.
  const order: BaseModelBucket[] = [
    'SD 1.5', 'SD 2.x', 'SD 3.x', 'SDXL', 'Pony', 'Illustrious', 'NoobAI',
    'Flux', 'Cascade', 'PixArt', 'AuraFlow', 'Other', 'Unknown',
  ];
  return (
    <div className="-mx-0.5 flex flex-wrap gap-1">
      <Chip label="All" count={totalCount} active={selected === 'all'} onClick={() => onSelect('all')} />
      {order
        .filter((b) => presentBuckets.has(b))
        .map((b) => (
          <Chip
            key={b}
            label={b}
            count={presentBuckets.get(b) ?? 0}
            active={selected === b}
            onClick={() => onSelect(b)}
          />
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-server filter — one chip per configured server. Multi-select (any
// selected = OR). Empty selection = "All servers" (no filter applied).
// Only rendered when more than one server exists.
// ---------------------------------------------------------------------------

function ServerToggles({
  servers, selected, onToggle, onClear,
}: {
  servers: { id: string; name: string }[];
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const allActive = selected.length === 0;
  return (
    <div className="-mx-0.5 flex flex-wrap items-center gap-1">
      <Chip label="All servers" count={servers.length} active={allActive} onClick={onClear} />
      {servers.map((s) => (
        <Chip
          key={s.id}
          label={s.name || s.id.slice(0, 6)}
          active={!allActive && selected.includes(s.id)}
          onClick={() => onToggle(s.id)}
        />
      ))}
    </div>
  );
}

function Chip({ label, count, active, onClick }: {
  label: string; count?: number; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors',
        active
          ? 'border-accent bg-accent-soft text-accent-fg'
          : 'border-border-default text-fg-tertiary hover:border-border-strong hover:text-fg-secondary',
      )}
    >
      <span>{label}</span>
      {count !== undefined && (
        <span className={cn(
          'rounded px-1 text-[9px] tabular-nums',
          active ? 'bg-accent/30 text-accent-fg' : 'bg-bg-card-on text-fg-muted',
        )}>
          {count}
        </span>
      )}
    </button>
  );
}
