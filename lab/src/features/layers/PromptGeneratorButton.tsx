import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/lib/store';
import { compileLayers } from '@/lib/prompt';
import { generateLayerSet, type GenerateLayerSource } from '@/lib/venice';
import { useShortcut, ShortcutPriority } from '@/hooks/useShortcut';
import { CloseIcon, SparkleIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

/**
 * Header-level action in the Prompt tab: opens a popover with two modes for
 * synthesizing a fresh positive-layer set via Venice — "from an idea" (the
 * user types a theme) and "from the current final prompt" (we feed the
 * compiled positive string back to the model and ask for a richer breakdown).
 *
 * On success we wipe every positive layer and install the generated set in
 * their place. Negative layers are untouched (they're usually quality
 * boilerplate the user wants to keep across regenerations).
 */
export function PromptGeneratorButton() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const venice = useStore(s => s.venice);
  const disabled = !venice.apiKey;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        title={disabled
          ? 'Set a Venice API key in Settings → AI to enable prompt generation'
          : 'Generate a fresh set of prompt layers with AI'}
        className={cn(
          'flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium transition-colors',
          'text-fg-dim hover:bg-bg-elev hover:text-accent-fg',
          'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-dim',
        )}
        aria-label="Generate prompt with AI"
      >
        <SparkleIcon size={12} />
        Generate
      </button>
      {open && btnRef.current && (
        <PromptGeneratorPopover anchor={btnRef.current} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function PromptGeneratorPopover({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const layers = useStore(s => s.layers);
  const venice = useStore(s => s.venice);
  const replaceLayers = useStore(s => s.replaceLayers);

  const compiledPositive = useMemo(() => compileLayers(layers, 'positive'), [layers]);

  const [source, setSource] = useState<GenerateLayerSource>('idea');
  const [idea, setIdea] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Position: popover hangs from the trigger's right edge, flips to the left
  // side if there isn't room, vertically clamped to viewport.
  const r = anchor.getBoundingClientRect();
  const WIDTH = 340;
  const MARGIN = 8;
  const GAP = 6;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const flipLeft = vw - r.right - MARGIN < WIDTH + GAP && r.left - MARGIN >= WIDTH + GAP;
  const left = flipLeft
    ? r.left - GAP - WIDTH
    : Math.min(r.right + GAP, vw - WIDTH - MARGIN);
  const maxH = Math.max(260, vh - r.top - MARGIN);
  const top = Math.max(MARGIN, Math.min(r.top, vh - MARGIN - Math.min(maxH, vh - 2 * MARGIN)));

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-prompt-gen-popover]')) return;
      onClose();
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', onDocClick), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onDocClick);
    };
  }, [onClose]);

  useShortcut('Escape', () => {
    abortRef.current?.abort();
    onClose();
  }, { priority: ShortcutPriority.Drawer });

  const canRun = source === 'idea'
    ? idea.trim().length > 0
    : compiledPositive.trim().length > 0;

  const run = async () => {
    if (busy || !canRun) return;
    setError(null);
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const seed = source === 'idea' ? idea : compiledPositive;
      const items = await generateLayerSet({
        seed,
        source,
        settings: venice,
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      if (items.length === 0) {
        setError('AI returned no usable snippets — try rephrasing.');
        return;
      }
      replaceLayers('positive', items);
      onClose();
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  return createPortal(
    <div
      data-prompt-gen-popover
      style={{ left, top, width: WIDTH, maxHeight: maxH }}
      className="fixed z-50 flex flex-col rounded-xl border border-border-default bg-bg-elev shadow-2xl"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border-subtle px-3 py-2">
        <SparkleIcon size={13} className="text-accent-fg" />
        <span className="text-[11px] font-semibold uppercase tracking-section text-fg-secondary">
          Generate prompt
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-fg-dim hover:bg-bg-card hover:text-fg-secondary"
        >
          <CloseIcon size={12} />
        </button>
      </header>

      <div className="scroll-y flex min-h-0 flex-1 flex-col gap-3 p-3">
        <div role="tablist" className="flex rounded-md border border-border-default bg-bg-input p-0.5">
          <SourceTab active={source === 'idea'} onClick={() => setSource('idea')}>
            From idea
          </SourceTab>
          <SourceTab
            active={source === 'prompt'}
            onClick={() => setSource('prompt')}
            disabled={compiledPositive.trim().length === 0}
            disabledTitle="No compiled positive prompt yet — add some layers first"
          >
            From final prompt
          </SourceTab>
        </div>

        {source === 'idea' ? (
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-section text-fg-dim">Your idea</span>
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="cyberpunk sphinx at dusk, neon rain, …"
              rows={3}
              autoFocus
              className="w-full resize-none rounded-md border border-border-default bg-bg-input px-2.5 py-2 text-[12px] text-fg-secondary outline-none placeholder:text-fg-dim focus:border-accent"
            />
          </label>
        ) : (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-section text-fg-dim">Final prompt (input)</span>
            <pre className="max-h-[110px] overflow-y-auto whitespace-pre-wrap rounded-md border border-border-default bg-bg-input px-2.5 py-2 font-mono text-[10.5px] leading-relaxed text-fg-tertiary">
              {compiledPositive || '(empty)'}
            </pre>
          </div>
        )}

        <p className="text-[10.5px] leading-snug text-fg-muted">
          Replaces every <span className="font-semibold text-fg-tertiary">positive</span> layer with a fresh set.
          Negative layers stay untouched.
        </p>

        {error && (
          <div className="rounded-md border border-status-err/60 bg-status-err/15 px-2.5 py-1.5 text-[11px] text-status-err">
            {error}
          </div>
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border-subtle px-3 py-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="rounded-md border border-border-default bg-bg-elev px-2.5 py-1 text-[11px] font-medium text-fg-tertiary transition-colors hover:border-border-strong hover:text-fg-secondary disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={run}
          disabled={busy || !canRun}
          className="flex items-center gap-1.5 rounded-md border border-accent bg-accent px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SparkleIcon size={11} />
          {busy ? 'Generating…' : 'Generate'}
        </button>
      </footer>
    </div>,
    document.body,
  );
}

function SourceTab({
  active, onClick, disabled, disabledTitle, children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  disabledTitle?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledTitle : undefined}
      aria-pressed={active}
      className={cn(
        'flex-1 rounded px-2 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'bg-accent-soft text-accent-fg'
          : 'text-fg-tertiary hover:text-fg-secondary',
        disabled && 'cursor-not-allowed opacity-40 hover:text-fg-tertiary',
      )}
    >
      {children}
    </button>
  );
}
