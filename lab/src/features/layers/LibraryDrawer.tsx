import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { DEFAULT_CATEGORY_ID } from '@/lib/storage';
import { brainstormSnippets, expandPromptFragment, type ExpandStyle } from '@/lib/venice';
import type { Snippet, LayerKind } from '@/lib/types';
import { cn } from '@/lib/cn';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import {
  CheckIcon, ChevronDownIcon, CloseIcon, CopyIcon,
  EditIcon, PlusIcon, SearchIcon, SparkleIcon, TrashIcon,
} from '@/components/ui/icons';
import { useShortcut, ShortcutPriority } from '@/hooks/useShortcut';

/**
 * The Snippet Library — one drawer that supersedes both the old AddLayerMenu
 * popover and SnippetLibraryModal. Slides over the left panel; the user can
 * browse, insert (one click), edit (expand a row), or batch-brainstorm via
 * Venice without leaving the panel.
 *
 * Layout:
 *   - Header: kind toggle (positive/negative) + close.
 *   - Search row with category chips (wrap; click chip to filter).
 *   - Pinned action: "Add blank layer" (always reachable).
 *   - Snippet list: compact rows. Click to insert. Hover: edit / delete /
 *     copy / AI rewrite. Click "edit" expands the row inline with full fields.
 *   - Footer toolbar: "+ New snippet" · "✨ Brainstorm" · gear (manage
 *     categories — opens an inline editor).
 *
 * Mounted by LeftPanel — drawer is positioned absolute inside the panel and
 * animates in from the right edge.
 */
export function LibraryDrawer({ open, initialKind, onClose }: {
  open: boolean;
  initialKind: LayerKind;
  onClose: () => void;
}) {
  const addLayer = useStore(s => s.addLayer);
  const requestLayerFocus = useStore(s => s.requestLayerFocus);
  const insertSnippet = useStore(s => s.insertSnippetAsLayer);
  const removeLayersFromSnippet = useStore(s => s.removeLayersFromSnippet);
  const snippets = useStore(s => s.snippets);
  const categories = useStore(s => s.snippetCategories);
  const layers = useStore(s => s.layers);
  const addSnippet = useStore(s => s.addSnippet);
  const updateSnippet = useStore(s => s.updateSnippet);
  const removeSnippet = useStore(s => s.removeSnippet);
  const addCategory = useStore(s => s.addSnippetCategory);
  const updateCategory = useStore(s => s.updateSnippetCategory);
  const removeCategory = useStore(s => s.removeSnippetCategory);
  const venice = useStore(s => s.venice);

  const [kind, setKind] = useState<LayerKind>(initialKind);
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');  // '' = all
  const [editingId, setEditingId] = useState<string | null>(null);
  const [brainstormOpen, setBrainstormOpen] = useState(false);
  const [manageCats, setManageCats] = useState(false);

  useShortcut('Escape', () => { if (open) onClose(); }, { priority: ShortcutPriority.Drawer });

  const library = useMemo(() => snippets.filter(s => s.kind === kind), [snippets, kind]);

  // Only show categories that actually contain snippets for this kind so the
  // chip row stays signal-rich.
  const activeCategories = useMemo(() => {
    const ids = new Set(library.map(s => s.categoryId));
    return categories.filter(c => ids.has(c.id));
  }, [library, categories]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return library.filter(s => {
      if (categoryId && s.categoryId !== categoryId) return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q)
        || s.text.toLowerCase().includes(q)
        || s.tag.toLowerCase().includes(q);
    });
  }, [library, categoryId, query]);

  const activeSnippetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const l of layers) if (l.originSnippetId) ids.add(l.originSnippetId);
    return ids;
  }, [layers]);

  const onAddBlank = () => {
    const id = addLayer(kind);
    requestLayerFocus(id);
    onClose();
  };

  const onInsert = (s: Snippet) => {
    if (activeSnippetIds.has(s.id)) {
      removeLayersFromSnippet(s.id);
    } else {
      insertSnippet(s.id);
    }
  };

  const onNewSnippet = () => {
    const id = addSnippet({
      name: 'New snippet',
      tag: '',
      text: '',
      weight: 1.0,
      kind,
      categoryId: categoryId || DEFAULT_CATEGORY_ID,
    });
    setEditingId(id);
  };

  // Mount only when open — keeping the drawer in the tree with `pointer-events:
  // none` was leaving an invisible-but-real overlay over the panel that broke
  // both scrolling and clicks in some browsers. A pure mount/unmount sidesteps
  // every CSS / paint edge case here; we trade the slide-in animation for
  // reliability.
  if (!open) return null;

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-bg-panel">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-bg-panel px-3.5 py-2.5">
        <span aria-hidden className="text-[14px]">📚</span>
        <span className="text-[12.5px] font-semibold text-fg-primary">Snippet library</span>
        <div className="ml-auto flex items-center gap-2">
          <KindToggle kind={kind} onChange={setKind} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close library"
            className="flex h-7 w-7 items-center justify-center rounded-md text-fg-dim transition-colors hover:bg-bg-elev hover:text-fg-secondary"
          >
            <CloseIcon size={13} />
          </button>
        </div>
      </header>

      {/* Search */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-border-subtle bg-bg-panel px-3.5 py-2.5">
        <div className="relative">
          <SearchIcon size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-dim" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${kind} snippets…`}
            autoFocus
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
        {activeCategories.length > 0 && (
          <div className="-mx-0.5 flex flex-wrap gap-1">
            <CategoryChip label="All" active={categoryId === ''} onClick={() => setCategoryId('')} />
            {activeCategories.map(c => (
              <CategoryChip
                key={c.id}
                label={c.icon ? `${c.icon} ${c.name}` : c.name}
                active={categoryId === c.id}
                onClick={() => setCategoryId(c.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Pinned blank action */}
      <div className="shrink-0 px-3.5 pt-2.5">
        <button
          type="button"
          onClick={onAddBlank}
          className="flex w-full items-center gap-2 rounded-lg border border-accent/40 bg-accent-soft/50 px-2.5 py-2 text-left transition-colors hover:border-accent hover:bg-accent-soft"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-white">
            <PlusIcon size={13} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] font-semibold text-fg-primary">Add blank layer</span>
            <span className="block text-[10.5px] text-fg-muted">Start a fresh {kind} layer</span>
          </span>
        </button>
      </div>

      {/* Brainstorm panel — collapsed by default */}
      {brainstormOpen && (
        <BrainstormPanel
          kind={kind}
          categoryName={categories.find(c => c.id === (categoryId || DEFAULT_CATEGORY_ID))?.name || 'Uncategorized'}
          hasKey={!!venice.apiKey}
          onClose={() => setBrainstormOpen(false)}
          onResult={(phrases) => {
            for (const text of phrases) {
              addSnippet({
                name: text.split(',')[0].slice(0, 36) || 'Idea',
                tag: '',
                text,
                weight: 1.0,
                kind,
                categoryId: categoryId || DEFAULT_CATEGORY_ID,
              });
            }
          }}
          onBrainstorm={(theme, signal) =>
            brainstormSnippets(theme, kind, categories.find(c => c.id === categoryId)?.name || 'Uncategorized', venice, signal)
          }
        />
      )}

      {manageCats && (
        <CategoryManager
          categories={categories}
          onAdd={addCategory}
          onRename={updateCategory}
          onDelete={(id, count) => {
            if (categoryId === id) setCategoryId('');
            removeCategory(id);
            void count;
          }}
          onClose={() => setManageCats(false)}
        />
      )}

      {/* Snippet list */}
      <div className="scroll-y min-h-0 flex-1 px-2 py-2">
        {library.length === 0 ? (
          <EmptyState kind={kind} />
        ) : filtered.length === 0 ? (
          <p className="px-3 py-4 text-[11.5px] italic text-fg-muted">No matches for that filter.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {filtered.map(s => (
              <SnippetRow
                key={s.id}
                snippet={s}
                category={categories.find(c => c.id === s.categoryId)}
                categories={categories}
                active={activeSnippetIds.has(s.id)}
                editing={editingId === s.id}
                onToggleEdit={() => setEditingId(editingId === s.id ? null : s.id)}
                onInsert={() => onInsert(s)}
                onUpdate={(patch) => updateSnippet(s.id, patch)}
                onDelete={() => removeSnippet(s.id)}
                veniceReady={!!venice.apiKey}
                onVeniceRewrite={async (style) => {
                  const next = await expandPromptFragment(s.text, s.kind, style, venice);
                  updateSnippet(s.id, { text: next });
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer toolbar */}
      <footer className="flex shrink-0 items-center gap-1.5 border-t border-border-subtle bg-bg-panel px-3 py-2">
        <button
          type="button"
          onClick={onNewSnippet}
          className="flex h-8 items-center gap-1 rounded-md border border-border-default bg-bg-elev px-2.5 text-[11.5px] font-medium text-fg-secondary hover:border-border-strong"
        >
          <PlusIcon size={11} />
          New snippet
        </button>
        <button
          type="button"
          onClick={() => setBrainstormOpen(o => !o)}
          disabled={!venice.apiKey}
          title={venice.apiKey ? 'Brainstorm new snippets with AI' : 'Set a Venice API key in Settings → AI'}
          className={cn(
            'flex h-8 items-center gap-1 rounded-md border px-2.5 text-[11.5px] font-medium transition-colors',
            brainstormOpen
              ? 'border-accent bg-accent-soft text-accent-fg'
              : 'border-border-default bg-bg-elev text-fg-secondary hover:border-border-strong',
            !venice.apiKey && 'cursor-not-allowed opacity-40',
          )}
        >
          <SparkleIcon size={11} />
          Brainstorm
        </button>
        <div className="ml-auto">
          <button
            type="button"
            onClick={() => setManageCats(m => !m)}
            className={cn(
              'flex h-8 items-center gap-1 rounded-md px-2.5 text-[11px] font-medium transition-colors',
              manageCats ? 'bg-bg-elev text-fg-primary' : 'text-fg-tertiary hover:bg-bg-elev hover:text-fg-secondary',
            )}
          >
            Categories
          </button>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kind toggle
// ---------------------------------------------------------------------------

function KindToggle({ kind, onChange }: { kind: LayerKind; onChange: (k: LayerKind) => void }) {
  return (
    <div className="inline-flex rounded-md border border-border-default bg-bg-input p-0.5">
      {(['positive', 'negative'] as LayerKind[]).map(k => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={cn(
            'rounded-sm px-2 py-0.5 text-[10px] font-semibold uppercase tracking-tag transition-colors',
            kind === k
              ? (k === 'positive' ? 'bg-accent text-white' : 'bg-coral-bg text-coral-fg')
              : 'text-fg-muted hover:text-fg-secondary',
          )}
        >
          {k}
        </button>
      ))}
    </div>
  );
}

function CategoryChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2 py-0.5 text-[10.5px] font-medium transition-colors',
        active
          ? 'border-accent bg-accent-soft text-accent-fg'
          : 'border-border-default text-fg-tertiary hover:border-border-strong hover:text-fg-secondary',
      )}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Snippet row — compact by default; expands in-place when editing.
// ---------------------------------------------------------------------------

function SnippetRow({
  snippet, category, categories, active, editing, onToggleEdit, onInsert, onUpdate, onDelete,
  veniceReady, onVeniceRewrite,
}: {
  snippet: Snippet;
  category: { id: string; name: string; icon?: string } | undefined;
  categories: ReturnType<typeof useStore.getState>['snippetCategories'];
  active: boolean;
  editing: boolean;
  onToggleEdit: () => void;
  onInsert: () => void;
  onUpdate: (patch: Partial<Omit<Snippet, 'id'>>) => void;
  onDelete: () => void;
  veniceReady: boolean;
  onVeniceRewrite: (style: ExpandStyle) => Promise<void>;
}) {
  const [name, setName] = useState(snippet.name);
  const [text, setText] = useState(snippet.text);
  const [tag, setTag] = useState(snippet.tag);
  const [weight, setWeight] = useState(String(snippet.weight));
  const [busy, setBusy] = useState<ExpandStyle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setName(snippet.name), [snippet.name]);
  useEffect(() => setText(snippet.text), [snippet.text]);
  useEffect(() => setTag(snippet.tag), [snippet.tag]);
  useEffect(() => setWeight(String(snippet.weight)), [snippet.weight]);

  const commitName = () => { if (name !== snippet.name) onUpdate({ name: name.trim() || 'Untitled' }); };
  const commitText = () => { if (text !== snippet.text) onUpdate({ text }); };
  const commitTag = () => { if (tag !== snippet.tag) onUpdate({ tag }); };
  const commitWeight = () => {
    const w = Number(weight);
    if (Number.isFinite(w) && Math.abs(w - snippet.weight) > 0.0001) onUpdate({ weight: Math.max(0, Math.min(2, w)) });
    else setWeight(String(snippet.weight));
  };

  const runVenice = async (style: ExpandStyle) => {
    setBusy(style); setError(null);
    try { await onVeniceRewrite(style); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  return (
    <div className={cn(
      'group flex flex-col rounded-md border bg-bg-card transition-colors',
      active ? 'border-accent shadow-[0_0_0_1px_rgba(79,138,255,0.25)]' : 'border-border-default',
    )}>
      <div className="flex items-center gap-1 px-1.5 py-1.5">
        <button
          type="button"
          onClick={onInsert}
          title={active ? 'Currently in your layers — click to remove' : 'Insert as a new layer'}
          aria-label={active ? 'Remove from layers' : 'Insert as layer'}
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors',
            active
              ? (snippet.kind === 'positive' ? 'bg-accent text-white' : 'bg-coral-bg text-coral-fg')
              : 'text-fg-dim hover:bg-bg-elev hover:text-accent-fg',
          )}
        >
          {active ? <CheckIcon size={13} /> : <PlusIcon size={13} />}
        </button>

        <button
          type="button"
          onClick={onToggleEdit}
          className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded px-1 py-0.5 text-left"
        >
          <span className="flex w-full items-center gap-1.5">
            <span className="min-w-0 truncate text-[12px] font-semibold text-fg-secondary">{snippet.name}</span>
            {category && (
              <span className="shrink-0 rounded bg-bg-elev px-1.5 py-px text-[9px] font-medium uppercase tracking-tag text-fg-muted">
                {category.icon ? `${category.icon} ${category.name}` : category.name}
              </span>
            )}
          </span>
          {snippet.text && (
            <span className="line-clamp-1 w-full text-[10.5px] text-fg-muted">{snippet.text}</span>
          )}
        </button>

        <button
          type="button"
          onClick={onToggleEdit}
          aria-label={editing ? 'Collapse' : 'Edit snippet'}
          title={editing ? 'Collapse' : 'Edit'}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-fg-dim opacity-0 transition-opacity hover:bg-bg-elev hover:text-fg-secondary group-hover:opacity-100 group-focus-within:opacity-100"
        >
          {editing ? <ChevronDownIcon size={11} /> : <EditIcon size={12} />}
        </button>
      </div>

      {editing && (
        <div className="flex flex-col gap-2 border-t border-border-subtle px-3 pb-2.5 pt-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              else if (e.key === 'Escape') { setName(snippet.name); }
            }}
            className="w-full rounded-md border border-border-default bg-bg-input px-2 py-1 text-[12.5px] font-semibold text-fg-primary outline-none focus:border-accent"
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commitText}
            rows={2}
            spellCheck={false}
            placeholder="prompt fragment…"
            className="w-full resize-y rounded-md border border-border-default bg-bg-input px-2.5 py-1.5 text-[12px] text-fg-secondary placeholder:text-fg-dim outline-none focus:border-accent"
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-tag text-fg-dim">Tag</span>
              <input
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                onBlur={commitTag}
                placeholder="—"
                className="w-20 rounded border border-border-default bg-bg-input px-1.5 py-0.5 text-[11px] text-fg-secondary placeholder:text-fg-dim outline-none focus:border-accent"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-tag text-fg-dim">Weight</span>
              <input
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                onBlur={commitWeight}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                inputMode="decimal"
                className="w-12 rounded border border-border-default bg-bg-input px-1.5 py-0.5 text-right text-[11px] tabular-nums text-fg-secondary outline-none focus:border-accent"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-tag text-fg-dim">Cat</span>
              <select
                value={snippet.categoryId}
                onChange={(e) => onUpdate({ categoryId: e.target.value })}
                className="rounded border border-border-default bg-bg-input px-1.5 py-0.5 text-[11px] text-fg-secondary outline-none focus:border-accent"
              >
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ${c.name}` : c.name}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => { if (text && navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {}); }}
              title="Copy text"
              aria-label="Copy text"
              className="flex h-7 w-7 items-center justify-center rounded-md text-fg-dim hover:bg-bg-elev hover:text-fg-secondary"
            >
              <CopyIcon size={12} />
            </button>
            {(['improve', 'expand', 'shorten'] as ExpandStyle[]).map(style => (
              <button
                key={style}
                type="button"
                onClick={() => runVenice(style)}
                disabled={!veniceReady || busy !== null}
                title={veniceReady ? `Rewrite via AI (${style})` : 'Set a Venice API key in Settings → AI'}
                className={cn(
                  'flex h-7 items-center gap-1 rounded-md border px-2 text-[10px] font-semibold uppercase tracking-tag transition-colors',
                  veniceReady
                    ? 'border-border-default bg-bg-input text-accent-fg hover:border-accent'
                    : 'border-border-default bg-bg-input text-fg-faint',
                  busy === style && 'animate-pulse',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                <SparkleIcon size={9} />
                {style}
              </button>
            ))}
            <button
              type="button"
              onClick={onDelete}
              title="Delete snippet"
              aria-label="Delete snippet"
              className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-fg-dim hover:bg-bg-elev hover:text-status-err"
            >
              <TrashIcon size={12} />
            </button>
          </div>
          {error && (
            <div className="rounded border border-status-err/30 bg-status-err/10 px-2 py-1 text-[11px] text-status-err">{error}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Brainstorm panel — inline, shows when toggled from footer.
// ---------------------------------------------------------------------------

function BrainstormPanel({
  kind, categoryName, hasKey, onClose, onResult, onBrainstorm,
}: {
  kind: LayerKind;
  categoryName: string;
  hasKey: boolean;
  onClose: () => void;
  onResult: (phrases: string[]) => void;
  onBrainstorm: (theme: string, signal: AbortSignal) => Promise<string[]>;
}) {
  const [theme, setTheme] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async () => {
    if (busy) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true); setError(null);
    try {
      const phrases = await onBrainstorm(theme, ac.signal);
      if (ac.signal.aborted) return;
      onResult(phrases);
      setTheme('');
    } catch (e) {
      if (ac.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-3.5 mt-2 flex shrink-0 flex-col gap-1.5 rounded-md border border-accent/40 bg-accent-soft/40 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <SparkleIcon size={11} className="text-accent-fg" />
        <span className="text-[10.5px] font-semibold uppercase tracking-section text-accent-fg">Brainstorm</span>
        <span className="text-[10px] text-fg-muted">→ {kind} · {categoryName}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close brainstorm"
          className="ml-auto flex h-5 w-5 items-center justify-center rounded text-fg-dim hover:text-fg-secondary"
        >
          <CloseIcon size={10} />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <input
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void run(); }}
          placeholder={hasKey ? 'Theme / vibe…' : 'Add a Venice API key first'}
          disabled={!hasKey || busy}
          className="min-w-0 flex-1 rounded border border-border-default bg-bg-input px-2 py-1 text-[11.5px] text-fg-secondary placeholder:text-fg-dim outline-none focus:border-accent disabled:opacity-50"
        />
        <button
          type="button"
          onClick={run}
          disabled={!hasKey || busy}
          className="flex shrink-0 items-center gap-1 rounded-md border border-accent bg-accent px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Thinking…' : 'Run 6'}
        </button>
      </div>
      {error && <div className="rounded border border-status-err/30 bg-status-err/10 px-2 py-1 text-[11px] text-status-err">{error}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category manager — inline editor for category list.
// ---------------------------------------------------------------------------

function CategoryManager({
  categories, onAdd, onRename, onDelete, onClose,
}: {
  categories: ReturnType<typeof useStore.getState>['snippetCategories'];
  onAdd: (name: string) => string;
  onRename: (id: string, patch: { name?: string; icon?: string }) => void;
  onDelete: (id: string, count: number) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const confirm = useConfirm();

  const commitRename = () => {
    if (renamingId) onRename(renamingId, { name: renameDraft });
    setRenamingId(null); setRenameDraft('');
  };

  return (
    <div className="mx-3.5 mt-2 flex shrink-0 flex-col gap-1.5 rounded-md border border-border-default bg-bg-card px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-section text-fg-dim">Categories</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ml-auto flex h-5 w-5 items-center justify-center rounded text-fg-dim hover:text-fg-secondary"
        >
          <CloseIcon size={10} />
        </button>
      </div>
      <div className="flex flex-col gap-0.5">
        {categories.map(c => {
          const isProtected = c.id === DEFAULT_CATEGORY_ID;
          if (renamingId === c.id) {
            return (
              <input
                key={c.id}
                autoFocus
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  else if (e.key === 'Escape') { setRenamingId(null); setRenameDraft(''); }
                }}
                onBlur={commitRename}
                className="rounded border border-accent bg-bg-input px-1.5 py-0.5 text-[12px] text-fg-secondary outline-none"
              />
            );
          }
          return (
            <div key={c.id} className="group flex items-center gap-1.5 rounded px-1.5 py-0.5">
              <span className="text-[12px] text-fg-secondary">{c.icon ? `${c.icon} ` : ''}{c.name}</span>
              {!isProtected && (
                <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => { setRenamingId(c.id); setRenameDraft(c.name); }}
                    aria-label="Rename"
                    className="flex h-5 w-5 items-center justify-center rounded text-fg-dim hover:text-fg-secondary"
                  >
                    <EditIcon size={10} />
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (await confirm(`Move snippets to Uncategorized and delete "${c.name}"?`)) {
                        onDelete(c.id, 0);
                      }
                    }}
                    aria-label="Delete"
                    className="flex h-5 w-5 items-center justify-center rounded text-fg-dim hover:text-status-err"
                  >
                    <TrashIcon size={10} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              onAdd(draft.trim());
              setDraft('');
            }
          }}
          placeholder="New category…"
          className="min-w-0 flex-1 rounded border border-border-default bg-bg-input px-1.5 py-0.5 text-[11.5px] text-fg-secondary placeholder:text-fg-dim outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => { if (draft.trim()) { onAdd(draft.trim()); setDraft(''); } }}
          className="flex h-6 items-center gap-1 rounded border border-border-default bg-bg-elev px-2 text-[10.5px] font-medium text-fg-secondary hover:border-border-strong"
        >
          <PlusIcon size={10} />
          Add
        </button>
      </div>
    </div>
  );
}

function EmptyState({ kind }: { kind: LayerKind }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-default p-8 text-center">
      <span className="text-[20px]">📭</span>
      <p className="text-[12px] text-fg-tertiary">No {kind} snippets yet.</p>
      <p className="text-[10.5px] text-fg-muted">Use “New snippet” or “Brainstorm” below — or click ⭐ on a layer to save it here.</p>
    </div>
  );
}

