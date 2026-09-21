import { useMemo, useState } from 'react';
import {
  DndContext, PointerSensor, useSensor, useSensors,
  closestCenter, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { LayerKind } from '@/lib/types';
import { useStore } from '@/lib/store';
import { useCollapsed } from '@/hooks/useCollapsed';
import { compileLayers } from '@/lib/prompt';
import { cn } from '@/lib/cn';
import {
  CheckIcon, ChevronDownIcon, ChevronRightIcon, CloseIcon, CopyIcon, PlusIcon,
  SearchIcon, SparkleIcon,
} from '@/components/ui/icons';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { LayerCard } from './LayerCard';
import { PromptGeneratorButton } from './PromptGeneratorButton';

type FilterKind = 'all' | 'positive' | 'negative';

/**
 * The unified Prompt tab. Replaces the old (FinalPromptArea +
 * positive-LayersSection + negative-LayersSection) stack with:
 *
 *   - A collapsible read-only "Final prompt" header (positive/negative tabs).
 *   - A sticky filter bar: All / Positive / Negative + search + Add + Library.
 *   - One scrolling list of layer cards. DnD is constrained per kind via
 *     separate SortableContexts.
 *
 * The AI generator + per-layer tweak + save-to-library actions are still
 * available (generator button lives in the AI toolbar; per-layer actions live
 * in each card's ⋯ menu) — no features removed, only repositioned.
 */
export function PromptStudio({ onOpenLibrary }: { onOpenLibrary: (kind: LayerKind) => void }) {
  const layers = useStore(s => s.layers);
  const addLayer = useStore(s => s.addLayer);
  const requestLayerFocus = useStore(s => s.requestLayerFocus);

  const [filter, setFilter] = useState<FilterKind>('all');
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  // For DnD we want stable references per-kind. Filtering by search is a
  // visual concern; DnD reorders the full list (cards hidden by search still
  // exist and stay in place).
  const positive = useMemo(() => layers.filter(l => l.kind === 'positive'), [layers]);
  const negative = useMemo(() => layers.filter(l => l.kind === 'negative'), [layers]);

  const matches = (l: { tag: string; text: string }) =>
    !q || l.tag.toLowerCase().includes(q) || l.text.toLowerCase().includes(q);

  const showPositive = filter !== 'negative';
  const showNegative = filter !== 'positive';

  const onAdd = () => {
    // "All" view defaults adds to positive; otherwise add to the visible kind.
    const kind: LayerKind = filter === 'negative' ? 'negative' : 'positive';
    requestLayerFocus(addLayer(kind));
  };

  // Auto-flip the filter to the kind the user pressed "Library" on.
  const openLibraryFor = (kind: LayerKind) => onOpenLibrary(kind);

  return (
    <div className="flex flex-col gap-3">
      <FinalPromptHeader />

      {/* Toolbar: filter + search + add + library + AI generate */}
      <div className="sticky top-0 z-10 -mx-3.5 flex flex-col gap-2 border-b border-border-subtle bg-bg-panel/95 px-3.5 pb-2.5 pt-1 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
          <FilterToggle filter={filter} onChange={setFilter} positiveCount={positive.length} negativeCount={negative.length} />
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onAdd}
              title="Add a blank layer"
              className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-border-default bg-bg-elev px-2.5 text-[12px] font-medium text-fg-secondary transition-colors hover:border-border-strong"
            >
              <PlusIcon size={12} />
              Add
            </button>
            <button
              type="button"
              onClick={() => openLibraryFor(filter === 'negative' ? 'negative' : 'positive')}
              title="Open the snippet library"
              className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-border-default bg-bg-elev px-2.5 text-[12px] font-medium text-fg-secondary transition-colors hover:border-border-strong"
            >
              <span aria-hidden>📚</span>
              Library
            </button>
            <PromptGeneratorButton />
          </div>
        </div>
        <div className="relative">
          <SearchIcon size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-dim" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your layers…"
            className="w-full rounded-md border border-border-default bg-bg-input pl-7 pr-7 py-1.5 text-[12px] text-fg-secondary placeholder:text-fg-dim outline-none focus:border-accent"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded text-fg-dim hover:text-fg-secondary"
            >
              <CloseIcon size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Layer lists. Per-kind SortableContext so dnd-kit never sees a
          cross-kind swap. When both groups are visible, render a subtle
          divider/heading between them so the boundary is obvious. */}
      <div className="flex flex-col gap-3">
        {showPositive && (
          <KindGroup
            kind="positive"
            label="Positive"
            layers={positive}
            visibleIds={new Set(positive.filter(matches).map(l => l.id))}
            query={q}
            onAdd={() => requestLayerFocus(addLayer('positive'))}
            onOpenLibrary={() => openLibraryFor('positive')}
            // Hide the per-group header when only one group is shown — the
            // filter buttons already tell the user what kind they're seeing.
            showHeader={filter === 'all'}
          />
        )}
        {showNegative && (
          <KindGroup
            kind="negative"
            label="Negative"
            layers={negative}
            visibleIds={new Set(negative.filter(matches).map(l => l.id))}
            query={q}
            onAdd={() => requestLayerFocus(addLayer('negative'))}
            onOpenLibrary={() => openLibraryFor('negative')}
            showHeader={filter === 'all'}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter toggle — segmented control
// ---------------------------------------------------------------------------

function FilterToggle({
  filter, onChange, positiveCount, negativeCount,
}: {
  filter: FilterKind;
  onChange: (f: FilterKind) => void;
  positiveCount: number;
  negativeCount: number;
}) {
  const opts: { id: FilterKind; label: string; count?: number }[] = [
    { id: 'all',      label: 'All',      count: positiveCount + negativeCount },
    { id: 'positive', label: 'Positive', count: positiveCount },
    { id: 'negative', label: 'Negative', count: negativeCount },
  ];
  return (
    <div role="tablist" className="inline-flex rounded-lg border border-border-default bg-bg-input p-0.5">
      {opts.map(o => {
        const active = filter === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.id)}
            className={cn(
              'flex h-7 items-center gap-1 rounded-md px-2.5 text-[11px] font-semibold transition-colors',
              active
                ? (o.id === 'negative' ? 'bg-coral-bg text-coral-fg' : o.id === 'positive' ? 'bg-accent text-white' : 'bg-bg-card text-fg-primary')
                : 'text-fg-muted hover:text-fg-secondary',
            )}
          >
            {o.label}
            {typeof o.count === 'number' && (
              <span className={cn(
                'rounded px-1 text-[10px] font-medium tabular-nums',
                active ? 'bg-black/10 text-current' : 'text-fg-dim',
              )}>
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One kind's layer list — optional heading + DnD context + empty state.
// ---------------------------------------------------------------------------

function KindGroup({
  kind, label, layers, visibleIds, query, onAdd, onOpenLibrary, showHeader,
}: {
  kind: LayerKind;
  label: string;
  layers: { id: string; kind: LayerKind; tag: string; text: string }[];
  visibleIds: Set<string>;
  query: string;
  onAdd: () => void;
  onOpenLibrary: () => void;
  showHeader: boolean;
}) {
  const reorderLayers = useStore(s => s.reorderLayers);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const onDragEnd = (e: DragEndEvent) => {
    const fromId = String(e.active.id);
    const toId = e.over ? String(e.over.id) : null;
    if (!toId) return;
    reorderLayers(kind, fromId, toId);
  };

  const visibleCount = layers.filter(l => visibleIds.has(l.id)).length;
  const hiddenBySearch = query && visibleCount < layers.length ? layers.length - visibleCount : 0;

  return (
    <section className="flex flex-col gap-2">
      {showHeader && (
        <div className="flex items-center gap-2 px-1">
          <span className={cn(
            'rounded-md px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-tag',
            kind === 'negative' ? 'bg-coral-bg text-coral-fg' : 'bg-accent-soft text-accent-fg',
          )}>
            {label}
          </span>
          <span className="text-[10px] text-fg-dim">{layers.length}</span>
          {hiddenBySearch > 0 && (
            <span className="text-[10px] text-fg-dim">· {hiddenBySearch} hidden by search</span>
          )}
        </div>
      )}

      {layers.length === 0 ? (
        <EmptyState kind={kind} onAdd={onAdd} onOpenLibrary={onOpenLibrary} />
      ) : visibleCount === 0 ? (
        <div className="rounded-lg border border-dashed border-border-default px-3 py-4 text-center text-[11px] italic text-fg-muted">
          No {kind} layers match “{query}”.
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={layers.map(l => l.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-1.5">
              {layers.map(l => visibleIds.has(l.id) && <LayerCard key={l.id} layer={l as Parameters<typeof LayerCard>[0]['layer']} />)}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </section>
  );
}

function EmptyState({ kind, onAdd, onOpenLibrary }: { kind: LayerKind; onAdd: () => void; onOpenLibrary: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-default px-4 py-5 text-center">
      <p className="text-[12px] text-fg-muted">
        No {kind} layers yet.
      </p>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onAdd}
          className="flex h-7 items-center gap-1 rounded-md border border-border-default bg-bg-elev px-2.5 text-[11.5px] font-medium text-fg-secondary hover:border-border-strong"
        >
          <PlusIcon size={11} />
          Add blank
        </button>
        <button
          type="button"
          onClick={onOpenLibrary}
          className="flex h-7 items-center gap-1 rounded-md border border-border-default bg-bg-elev px-2.5 text-[11.5px] font-medium text-fg-secondary hover:border-border-strong"
        >
          <span aria-hidden>📚</span>
          From library
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Final prompt header — collapsible, with positive/negative tab switcher and
// a single textarea body driven by the selected tab. Replaces the always-
// visible two-textarea stack that ate vertical space.
// ---------------------------------------------------------------------------

function FinalPromptHeader() {
  const layers = useStore(s => s.layers);
  const positive = useMemo(() => compileLayers(layers, 'positive'), [layers]);
  const negative = useMemo(() => compileLayers(layers, 'negative'), [layers]);

  const [collapsed, toggleCollapsed] = useCollapsed('promptStudio.finalPrompt', true);
  const [tab, setTab] = useState<'positive' | 'negative'>('positive');

  const text = tab === 'positive' ? positive : negative;
  const placeholder = tab === 'positive' ? '(no enabled positive layers)' : '(no enabled negative layers)';
  const { copy, isCopied } = useCopyToClipboard(1100);
  const copied = isCopied();

  return (
    <section className="flex flex-col gap-1.5 rounded-lg border border-border-subtle bg-bg-card/40">
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        className="flex items-center gap-2 px-2.5 py-2 text-left"
      >
        <span className="inline-flex h-3.5 w-3.5 items-center justify-center text-fg-muted">
          {collapsed ? <ChevronRightIcon size={11} /> : <ChevronDownIcon size={11} />}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-section text-fg-dim">Final prompt</span>
        <span className="text-[10px] text-fg-faint">compiled · read-only</span>
        {collapsed && (
          <span className="ml-auto flex items-center gap-1.5 text-[10.5px] text-fg-muted">
            <SparkleIcon size={11} className="text-accent-fg" />
            {positive ? positive.split(',').length : 0} pos · {negative ? negative.split(',').length : 0} neg
          </span>
        )}
      </button>
      {!collapsed && (
        <div className="flex flex-col gap-1.5 px-2.5 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-border-default bg-bg-input p-0.5">
              {(['positive', 'negative'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={cn(
                    'rounded-sm px-2 py-0.5 text-[10px] font-semibold uppercase tracking-tag transition-colors',
                    tab === t
                      ? (t === 'negative' ? 'bg-coral-bg text-coral-fg' : 'bg-accent text-white')
                      : 'text-fg-muted hover:text-fg-secondary',
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => { if (text) void copy(text); }}
              disabled={!text}
              className="ml-auto flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium text-fg-dim transition-colors hover:bg-bg-elev hover:text-fg-secondary disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-dim"
            >
              {copied ? <CheckIcon size={11} /> : <CopyIcon size={11} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className={cn(
            'max-h-[160px] overflow-auto whitespace-pre-wrap rounded-md border border-border-default bg-bg-input px-3 py-2 font-mono text-[11px] leading-relaxed',
            tab === 'negative' ? 'text-coral-fg' : 'text-accent-fg',
            !text && 'italic text-fg-dim',
          )}>
            {text || placeholder}
          </pre>
        </div>
      )}
    </section>
  );
}
