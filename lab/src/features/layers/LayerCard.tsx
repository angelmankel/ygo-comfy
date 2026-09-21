import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useFlash } from '@/hooks/useFlash';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Layer } from '@/lib/types';
import { useStore } from '@/lib/store';
import { useCollapsed } from '@/hooks/useCollapsed';
import { Slider } from '@/components/ui/Slider';
import { cn } from '@/lib/cn';
import {
  CheckIcon, CopyIcon, MoreIcon, SparkleIcon, StarIcon, TrashIcon,
} from '@/components/ui/icons';
import { tweakPromptFragment } from '@/lib/venice';
import { useShortcut, ShortcutPriority } from '@/hooks/useShortcut';

/**
 * A single prompt layer row. Two display modes:
 *
 *   - Compact (default) — single line: drag · on-dot · tag · text preview ·
 *     weight pill · ⋯ menu. Click the row body to expand.
 *   - Expanded           — tag input + auto-growing textarea + weight slider.
 *
 * Everything except the inline editors lives behind a ⋯ overflow menu so the
 * common case shows almost no chrome.
 */

function DragDots() {
  return (
    <svg viewBox="0 0 8 12" width="11" height="16" aria-hidden className="shrink-0 text-handle">
      <g fill="currentColor">
        <circle cx="1.5" cy="1.5" r="1" />
        <circle cx="6.5" cy="1.5" r="1" />
        <circle cx="1.5" cy="6"   r="1" />
        <circle cx="6.5" cy="6"   r="1" />
        <circle cx="1.5" cy="10.5" r="1" />
        <circle cx="6.5" cy="10.5" r="1" />
      </g>
    </svg>
  );
}

const accentByKind = {
  positive: { chipBg: 'bg-accent-soft', chipFg: 'text-accent-fg', borderL: 'border-l-accent', dot: 'bg-accent', dotOff: 'bg-bg-input ring-1 ring-inset ring-border-strong' },
  negative: { chipBg: 'bg-coral-bg',    chipFg: 'text-coral-fg', borderL: 'border-l-coral-fg', dot: 'bg-coral-fg', dotOff: 'bg-bg-input ring-1 ring-inset ring-border-strong' },
} as const;

export function LayerCard({ layer }: { layer: Layer }) {
  const update = useStore(s => s.updateLayer);
  const removeLayer = useStore(s => s.removeLayer);
  const duplicateLayer = useStore(s => s.duplicateLayer);
  const addSnippet = useStore(s => s.addSnippet);
  const venice = useStore(s => s.venice);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: layer.id,
    data: { kind: layer.kind },
  });

  const [collapsed, , setCollapsed] = useCollapsed(`layer:${layer.id}`, true);

  const [tagDraft, setTagDraft] = useState(layer.tag);
  const [textDraft, setTextDraft] = useState(layer.text);
  const [saved, flashSaved] = useFlash(1200);
  useEffect(() => setTagDraft(layer.tag), [layer.tag]);
  useEffect(() => setTextDraft(layer.text), [layer.text]);

  // Auto-grow the textarea when expanded.
  const taRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el || collapsed) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [textDraft, collapsed]);

  // One-shot focus + scroll when a freshly inserted layer asks for it.
  const pendingFocusLayerId = useStore(s => s.pendingFocusLayerId);
  const consumeLayerFocus = useStore(s => s.consumeLayerFocus);
  useEffect(() => {
    if (pendingFocusLayerId !== layer.id) return;
    setCollapsed(false);
    // Wait one tick for the textarea to mount.
    const id = requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      consumeLayerFocus();
    });
    return () => cancelAnimationFrame(id);
  }, [pendingFocusLayerId, layer.id, consumeLayerFocus, setCollapsed]);

  const accent = accentByKind[layer.kind];
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : layer.on ? 1 : 0.55,
  };

  const saveToLibrary = () => {
    addSnippet({
      name: layer.tag.trim() || layer.text.trim().slice(0, 28) || 'Snippet',
      tag: layer.tag,
      text: layer.text,
      weight: layer.weight,
      kind: layer.kind,
      categoryId: 'uncategorized',
    });
    flashSaved();
  };

  const previewText = layer.text.trim() || (layer.kind === 'positive' ? '(empty positive layer)' : '(empty negative layer)');

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group flex flex-col rounded-lg border border-l-[3px] bg-bg-card transition-colors',
        layer.on ? 'border-border-default' : 'border-border-subtle',
        accent.borderL,
      )}
    >
      {/* Header — compact row, always visible */}
      <div className="flex items-center gap-1.5 px-1.5 py-1.5">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          title="Drag to reorder"
          className="flex h-8 w-5 shrink-0 cursor-grab touch-none items-center justify-center text-handle hover:text-fg-tertiary active:cursor-grabbing"
        >
          <DragDots />
        </button>

        <button
          type="button"
          onClick={() => update(layer.id, { on: !layer.on })}
          aria-label={layer.on ? 'Disable layer' : 'Enable layer'}
          title={layer.on ? 'Layer is on — click to disable' : 'Layer is off — click to enable'}
          className="flex h-8 w-6 shrink-0 items-center justify-center"
        >
          <span className={cn(
            'inline-block h-2.5 w-2.5 rounded-full transition-colors',
            layer.on ? accent.dot : accent.dotOff,
          )} />
        </button>

        {/* Click body to expand. Layered button so the row reads as one target. */}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 pr-1 text-left"
        >
          {layer.tag.trim() && (
            <span className={cn(
              'shrink-0 rounded-md px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-tag',
              layer.on ? accent.chipBg : 'bg-bg-input',
              layer.on ? accent.chipFg : 'text-fg-muted',
            )}>
              {layer.tag.trim()}
            </span>
          )}
          {collapsed && (
            <span className={cn(
              'min-w-0 flex-1 truncate text-[12px]',
              layer.text.trim() ? 'text-fg-secondary' : 'text-fg-dim italic',
            )}>
              {previewText}
            </span>
          )}
          {!collapsed && !layer.tag.trim() && (
            <span className="text-[10px] font-semibold uppercase tracking-section text-fg-dim">
              Layer
            </span>
          )}
        </button>

        <WeightPill
          value={layer.weight}
          onChange={(v) => update(layer.id, { weight: v })}
          accent={layer.kind === 'negative' ? 'coral' : 'accent'}
        />

        <OverflowMenu
          layer={layer}
          venice={venice}
          onDuplicate={() => duplicateLayer(layer.id)}
          onSaveToLibrary={saveToLibrary}
          saved={saved}
          onTweakResult={(text) => update(layer.id, { text })}
        />

        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); removeLayer(layer.id); }}
          aria-label="Delete layer"
          title="Delete layer"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-dim transition-colors hover:bg-status-err/15 hover:text-status-err"
        >
          <TrashIcon size={13} />
        </button>
      </div>

      {/* Expanded body */}
      {!collapsed && (
        <div className="flex flex-col gap-2 px-3 pb-2.5 pt-0.5">
          <input
            value={tagDraft}
            spellCheck={false}
            onChange={(e) => setTagDraft(e.target.value)}
            onBlur={() => { if (tagDraft !== layer.tag) update(layer.id, { tag: tagDraft }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            placeholder="tag (optional)"
            className="w-full rounded-md border border-border-default bg-bg-input px-2 py-1 text-[10.5px] font-semibold uppercase tracking-tag text-fg-secondary placeholder:text-fg-dim placeholder:normal-case outline-none focus:border-accent"
          />
          <textarea
            ref={taRef}
            value={textDraft}
            spellCheck={false}
            rows={1}
            placeholder="prompt fragment…"
            onChange={(e) => setTextDraft(e.target.value)}
            onBlur={() => { if (textDraft !== layer.text) update(layer.id, { text: textDraft }); }}
            className="w-full resize-none overflow-hidden rounded-lg border border-border-default bg-bg-input px-3 py-2 text-[13px] leading-relaxed text-fg-secondary placeholder:text-fg-dim outline-none focus:border-accent"
          />
          <div className="flex items-center gap-2.5">
            <span className="text-[10px] font-semibold uppercase tracking-section text-fg-dim">Weight</span>
            <Slider
              value={layer.weight}
              onValueChange={(v) => update(layer.id, { weight: Math.round(v * 100) / 100 })}
              min={0}
              max={2}
              step={0.05}
              ariaLabel="Layer weight"
            />
            <span className="w-11 text-right text-[12px] font-semibold tabular-nums text-fg-secondary">
              {layer.weight.toFixed(2)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weight pill — click to open a tiny inline slider popover. Cheaper than
// always showing the slider in compact mode but still gives one-click access.
// ---------------------------------------------------------------------------

function WeightPill({ value, onChange, accent }: {
  value: number;
  onChange: (v: number) => void;
  accent: 'accent' | 'coral';
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const isOne = Math.abs(value - 1) < 0.005;
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Adjust weight"
        aria-label={`Layer weight ${value.toFixed(2)}`}
        className={cn(
          'flex h-7 shrink-0 items-center justify-center rounded-md px-1.5 text-[10.5px] font-semibold tabular-nums transition-colors',
          'border border-transparent hover:border-border-default',
          isOne ? 'text-fg-dim' : accent === 'coral' ? 'text-coral-fg' : 'text-accent-fg',
        )}
      >
        {value.toFixed(2)}
      </button>
      {open && btnRef.current && (
        <WeightPopover anchor={btnRef.current} value={value} onChange={onChange} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function WeightPopover({ anchor, value, onChange, onClose }: {
  anchor: HTMLElement;
  value: number;
  onChange: (v: number) => void;
  onClose: () => void;
}) {
  const r = anchor.getBoundingClientRect();
  const WIDTH = 220;
  const MARGIN = 8;
  const vw = window.innerWidth;
  const left = Math.min(Math.max(MARGIN, r.right - WIDTH), vw - WIDTH - MARGIN);
  const top = r.bottom + 6;

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-weight-popover]')) return;
      if (target === anchor || anchor.contains(target!)) return;
      onClose();
    };
    const id = setTimeout(() => document.addEventListener('mousedown', onDocClick), 0);
    return () => { clearTimeout(id); document.removeEventListener('mousedown', onDocClick); };
  }, [anchor, onClose]);

  useShortcut('Escape', onClose, { priority: ShortcutPriority.Drawer });

  return createPortal(
    <div
      data-weight-popover
      style={{ left, top, width: WIDTH }}
      className="fixed z-50 flex items-center gap-2 rounded-xl border border-border-default bg-bg-elev p-2.5 shadow-2xl"
    >
      <Slider
        value={value}
        onValueChange={(v) => onChange(Math.round(v * 100) / 100)}
        min={0}
        max={2}
        step={0.05}
        ariaLabel="Layer weight"
      />
      <span className="w-10 text-right text-[12px] font-semibold tabular-nums text-fg-secondary">
        {value.toFixed(2)}
      </span>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Overflow menu — Duplicate / Tweak with AI / Save to library / Delete
// ---------------------------------------------------------------------------

function OverflowMenu({
  layer, venice, onDuplicate, onSaveToLibrary, saved, onTweakResult,
}: {
  layer: Layer;
  venice: ReturnType<typeof useStore.getState>['venice'];
  onDuplicate: () => void;
  onSaveToLibrary: () => void;
  saved: boolean;
  onTweakResult: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tweakOpen, setTweakOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const veniceReady = !!venice.apiKey;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        title="More…"
        aria-label="More actions"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-dim transition-colors hover:bg-bg-elev hover:text-fg-secondary"
      >
        <MoreIcon size={15} />
      </button>
      {open && btnRef.current && (
        <MenuPopover
          anchor={btnRef.current}
          onClose={() => setOpen(false)}
          items={[
            { label: 'Duplicate', icon: <CopyIcon size={13} />, onClick: onDuplicate },
            {
              label: 'Tweak with AI…',
              icon: <SparkleIcon size={13} />,
              onClick: () => setTweakOpen(true),
              disabled: !veniceReady,
              disabledTitle: 'Set a Venice API key in Settings → AI',
            },
            {
              label: saved ? 'Saved' : 'Save to library',
              icon: saved ? <CheckIcon size={13} /> : <StarIcon size={13} />,
              onClick: onSaveToLibrary,
            },
          ]}
        />
      )}
      {tweakOpen && (
        <TweakDialog
          layer={layer}
          venice={venice}
          onClose={() => setTweakOpen(false)}
          onApply={onTweakResult}
        />
      )}
    </>
  );
}

type MenuItem =
  | { divider: true }
  | { label: string; icon?: React.ReactNode; onClick: () => void; disabled?: boolean; disabledTitle?: string; danger?: boolean };

function MenuPopover({ anchor, onClose, items }: {
  anchor: HTMLElement;
  onClose: () => void;
  items: MenuItem[];
}) {
  const r = anchor.getBoundingClientRect();
  const WIDTH = 200;
  const MARGIN = 8;
  const vw = window.innerWidth;
  const left = Math.min(Math.max(MARGIN, r.right - WIDTH), vw - WIDTH - MARGIN);
  const top = r.bottom + 4;

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-layer-menu]')) return;
      if (target === anchor || anchor.contains(target!)) return;
      onClose();
    };
    const id = setTimeout(() => document.addEventListener('mousedown', onDocClick), 0);
    return () => { clearTimeout(id); document.removeEventListener('mousedown', onDocClick); };
  }, [anchor, onClose]);

  useShortcut('Escape', onClose, { priority: ShortcutPriority.Drawer });

  return createPortal(
    <div
      data-layer-menu
      style={{ left, top, width: WIDTH }}
      className="fixed z-50 flex flex-col rounded-xl border border-border-default bg-bg-elev py-1 shadow-2xl"
    >
      {items.map((it, i) => {
        if ('divider' in it) {
          return <div key={i} className="my-1 h-px bg-border-subtle" />;
        }
        return (
          <button
            key={i}
            type="button"
            onClick={() => { if (!it.disabled) { it.onClick(); onClose(); } }}
            disabled={it.disabled}
            title={it.disabled ? it.disabledTitle : undefined}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors',
              it.danger
                ? 'text-fg-secondary hover:bg-status-err/15 hover:text-status-err'
                : 'text-fg-secondary hover:bg-bg-card-on',
              it.disabled && 'cursor-not-allowed text-fg-faint hover:bg-transparent hover:text-fg-faint',
            )}
          >
            <span className="text-fg-dim">{it.icon}</span>
            <span className="flex-1">{it.label}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Tweak dialog — moved from the standalone LayerTweakButton so the row stays
// uncluttered. Same Venice call, same Enter-to-apply shortcut.
// ---------------------------------------------------------------------------

function TweakDialog({ layer, venice, onClose, onApply }: {
  layer: Layer;
  venice: ReturnType<typeof useStore.getState>['venice'];
  onClose: () => void;
  onApply: (text: string) => void;
}) {
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-tweak-dialog]')) return;
      onClose();
    };
    const id = setTimeout(() => document.addEventListener('mousedown', onDocClick), 0);
    return () => { clearTimeout(id); document.removeEventListener('mousedown', onDocClick); };
  }, [onClose]);

  useShortcut('Escape', () => { abortRef.current?.abort(); onClose(); }, { priority: ShortcutPriority.Drawer });

  const canRun = instruction.trim().length > 0;
  const run = async () => {
    if (busy || !canRun) return;
    setError(null);
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const next = await tweakPromptFragment({
        text: layer.text,
        instruction,
        kind: layer.kind,
        settings: venice,
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      const trimmed = next.trim();
      if (!trimmed) { setError('AI returned an empty rewrite — try a different instruction.'); return; }
      onApply(trimmed);
      onClose();
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Tweak failed');
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <div data-tweak-dialog className="flex w-[min(95vw,420px)] flex-col rounded-xl border border-border-default bg-bg-elev shadow-2xl">
        <header className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5">
          <SparkleIcon size={13} className="text-accent-fg" />
          <span className="text-[12px] font-semibold uppercase tracking-section text-fg-secondary">Tweak layer</span>
          <span className="ml-auto truncate text-[10.5px] text-fg-muted">{layer.tag.trim() || layer.text.slice(0, 32) || 'untitled'}</span>
        </header>
        <div className="flex flex-col gap-2 p-4">
          <input
            autoFocus
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void run(); } }}
            placeholder="make this darker / brighter colors / shorter…"
            className="w-full rounded-md border border-border-default bg-bg-input px-2.5 py-1.5 text-[12.5px] text-fg-secondary outline-none placeholder:text-fg-dim focus:border-accent"
          />
          <p className="text-[10.5px] leading-snug text-fg-muted">
            Rewrites this layer only. Press Enter to apply.
          </p>
          {error && (
            <div className="rounded-md border border-status-err/60 bg-status-err/15 px-2.5 py-1.5 text-[11px] text-status-err">{error}</div>
          )}
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-border-subtle px-4 py-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border-default bg-bg-elev px-3 py-1 text-[11px] font-medium text-fg-tertiary hover:border-border-strong hover:text-fg-secondary disabled:opacity-40"
          >Cancel</button>
          <button
            type="button"
            onClick={run}
            disabled={busy || !canRun}
            className="flex items-center gap-1.5 rounded-md border border-accent bg-accent px-3 py-1 text-[11px] font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <SparkleIcon size={11} />
            {busy ? 'Applying…' : 'Apply'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
