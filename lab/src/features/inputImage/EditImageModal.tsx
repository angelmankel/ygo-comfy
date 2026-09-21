import { useMemo, useRef, useState } from 'react';
import * as RPopover from '@radix-ui/react-popover';
import { Modal } from '@/components/modal';
import { useStore } from '@/lib/store';
import { runImageTool, removeBackgroundGraph } from '@/lib/imageJobs';
import {
  rotate90, flipHorizontal, flipVertical, invert,
  applyFilters, crop, cssFilterString, NEUTRAL_FILTERS, isNeutralFilters,
  resizeDataUrlForUpload, blobToImageState,
  type CssFilters, type CropRect,
} from './imageOps';
import { CropOverlay } from './CropOverlay';
import { cn } from '@/lib/cn';
import { Slider } from '@/components/ui/Slider';
import { CheckIcon, ChevronDownIcon, ResetIcon } from '@/components/ui/icons';
import type { InputImageState } from '@/lib/types';

type Props = {
  image: InputImageState;
  onClose: () => void;
};

type Mode = 'idle' | 'adjustments' | 'crop';

/** One entry in the in-modal edit-history stack. Each tool that mutates the
 *  image pushes a step here; the popover lets the user revert to any of
 *  them. Modal-local — closing and re-opening starts a fresh stack at the
 *  current `workflow.inputImage`. */
type HistoryStep = { state: InputImageState; label: string; at: number };

/**
 * Pre-generation image editor. Quick client-side ops (rotate, flip, invert,
 * crop, brightness/contrast/saturation/blur) bake immediately into a fresh
 * Canvas; Remove BG offloads to ComfyUI via `runImageTool` and swaps the
 * result back into the workflow's `inputImage`. Tools share the same image
 * state, so chaining works (crop → remove bg → adjust → ...).
 */
export function EditImageModal({ image, onClose }: Props) {
  const setWorkflow = useStore(s => s.setWorkflow);
  const setStatus = useStore(s => s.setStatus);
  const inputMaxSize = useStore(s => s.workflow.inputMaxSize);
  const peekNextServer = useStore(s => s.peekNextServer);

  // Modal-session history. The first entry is the image we were opened with
  // and is never mutated — that's what "Reset to original" jumps back to.
  // Lazy `useState` initialiser so the original is captured ONCE, regardless
  // of how many times the `image` prop changes via parent re-renders.
  const [history, setHistory] = useState<HistoryStep[]>(() => [
    { state: image, label: 'Original', at: Date.now() },
  ]);
  const [cursor, setCursor] = useState(0);
  const current = history[cursor];

  const [mode, setMode] = useState<Mode>('idle');
  const [filters, setFilters] = useState<CssFilters>(NEUTRAL_FILTERS);
  const [busy, setBusy] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);

  // Commit edited state up to the workflow store *and* push a new history
  // step. Doing this on every op (instead of waiting for a final "Apply")
  // means a server-side tool job can fail without leaving the user with
  // mismatched local state. Edits made after a revert truncate the tail of
  // the stack — standard undo behaviour.
  const commit = (next: InputImageState, label: string) => {
    setHistory(prev => {
      const truncated = prev.slice(0, cursor + 1);
      return [...truncated, { state: next, label, at: Date.now() }];
    });
    setCursor(c => c + 1);
    setWorkflow({ inputImage: next });
  };

  /** Jump to any earlier history step (no truncation here — only commits
   *  truncate, so the user can re-pick a later step until they edit again). */
  const revertTo = (idx: number) => {
    const step = history[idx];
    if (!step) return;
    setCursor(idx);
    setWorkflow({ inputImage: step.state });
  };

  const runClientOp = async (
    name: string,
    fn: (dataUrl: string) => Promise<{ dataUrl: string; width: number; height: number }>,
  ) => {
    if (busy) return;
    setBusy(name);
    try {
      const r = await fn(current.state.dataUrl);
      commit({ dataUrl: r.dataUrl, name: current.state.name, width: r.width, height: r.height }, name);
    } catch (err) {
      setStatus(`${name} failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleRotate = () => runClientOp('Rotate', d => rotate90(d, 1));
  const handleFlipH  = () => runClientOp('Flip H', flipHorizontal);
  const handleFlipV  = () => runClientOp('Flip V', flipVertical);
  const handleInvert = () => runClientOp('Invert', invert);
  const handleReset  = () => revertTo(0);

  const handleApplyFilters = async () => {
    if (isNeutralFilters(filters)) { setMode('idle'); return; }
    await runClientOp('Adjustments', d => applyFilters(d, filters));
    setFilters(NEUTRAL_FILTERS);
    setMode('idle');
  };

  const handleApplyCrop = async (rect: CropRect) => {
    await runClientOp('Crop', d => crop(d, rect));
    setMode('idle');
  };

  const handleRemoveBg = async () => {
    if (busy) return;
    const target = peekNextServer();
    if (!target) { setStatus('No server available to run Remove BG', 'error'); return; }
    setBusy('Remove BG');
    setStatus(`Removing background on ${target.name}…`, 'busy');
    try {
      const blob = await resizeDataUrlForUpload(current.state.dataUrl, Math.max(inputMaxSize, 1024));
      const out = await runImageTool(target.host, blob, current.state.name, removeBackgroundGraph);
      const next = await blobToImageState(out, current.state.name.replace(/\.[^.]+$/, '') + '-rmbg.png');
      commit(next, 'Remove BG');
      setStatus(`Background removed`, 'ok');
    } catch (err) {
      setStatus(`Remove BG failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  // Adjustments preview is applied via CSS filter so it's instant — only
  // baked into the actual image when the user hits Apply.
  const previewFilter = mode === 'adjustments' ? cssFilterString(filters) : 'none';

  return (
    <Modal open onClose={onClose} panelClassName="w-[min(1100px,95vw)] h-[min(720px,90vh)]">
      <div className="flex h-full w-full flex-col">
        <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-4 py-3">
          <span className="text-[12px] font-semibold uppercase tracking-section text-fg-secondary">
            Edit input image
          </span>
          <span className="font-mono text-[10px] text-fg-dim">{current.state.width}×{current.state.height}</span>
          {busy && (
            <span className="rounded bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent-fg">
              {busy}…
            </span>
          )}
          <div className="flex-1" />
          <Modal.Close />
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Preview */}
          <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-bg-base/40 p-4" ref={previewRef}>
            <div
              className="relative flex items-center justify-center"
              style={{
                aspectRatio: `${current.state.width} / ${current.state.height}`,
                maxWidth: '100%',
                maxHeight: '100%',
                width: `${current.state.width}px`,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={current.state.dataUrl}
                alt=""
                style={{ filter: previewFilter }}
                className="block h-full w-full select-none rounded-md object-contain shadow-lg"
                draggable={false}
              />
              {mode === 'crop' && (
                <CropOverlay
                  imageWidth={current.state.width}
                  imageHeight={current.state.height}
                  onApply={handleApplyCrop}
                  onCancel={() => setMode('idle')}
                />
              )}
            </div>
          </div>

          {/* Tools rail */}
          <div className="scroll-y flex w-[280px] shrink-0 flex-col gap-3 border-l border-border-subtle bg-bg-panel px-3.5 py-3.5">
            <ToolSection title="Quick">
              <div className="grid grid-cols-2 gap-1.5">
                <ToolButton label="Rotate 90°" onClick={handleRotate} disabled={!!busy} />
                <ToolButton label="Flip H"    onClick={handleFlipH}  disabled={!!busy} />
                <ToolButton label="Flip V"    onClick={handleFlipV}  disabled={!!busy} />
                <ToolButton label="Invert"    onClick={handleInvert} disabled={!!busy} />
              </div>
            </ToolSection>

            <ToolSection title="Crop">
              {mode === 'crop' ? (
                <button
                  type="button"
                  onClick={() => setMode('idle')}
                  className="h-8 w-full rounded-md border border-border-default bg-bg-elev px-2 text-[11px] font-medium text-fg-tertiary hover:border-border-strong"
                >
                  Cancel crop
                </button>
              ) : (
                <ToolButton label="Crop image" onClick={() => setMode('crop')} disabled={!!busy} variant="full" />
              )}
              <p className="text-[10px] leading-snug text-fg-dim">Drag corners to size, drag inside to move, then Apply.</p>
            </ToolSection>

            <ToolSection title="Adjustments">
              {mode === 'adjustments' ? (
                <>
                  <FilterRow label="Brightness" value={filters.brightness} min={0} max={2} step={0.01}
                    onChange={(v) => setFilters({ ...filters, brightness: v })} />
                  <FilterRow label="Contrast"   value={filters.contrast}   min={0} max={2} step={0.01}
                    onChange={(v) => setFilters({ ...filters, contrast: v })} />
                  <FilterRow label="Saturation" value={filters.saturation} min={0} max={2} step={0.01}
                    onChange={(v) => setFilters({ ...filters, saturation: v })} />
                  <FilterRow label="Blur"       value={filters.blur}       min={0} max={20} step={0.1}
                    onChange={(v) => setFilters({ ...filters, blur: v })} />
                  <div className="flex gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => { setFilters(NEUTRAL_FILTERS); setMode('idle'); }}
                      className="h-8 flex-1 rounded-md border border-border-default bg-bg-elev px-2 text-[11px] font-medium text-fg-tertiary hover:border-border-strong"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleApplyFilters}
                      disabled={!!busy}
                      className="h-8 flex-1 rounded-md bg-accent px-2 text-[11px] font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
                    >
                      Apply
                    </button>
                  </div>
                </>
              ) : (
                <ToolButton label="Open adjustments" onClick={() => setMode('adjustments')} disabled={!!busy} variant="full" />
              )}
            </ToolSection>

            <ToolSection title="AI">
              <ToolButton
                label={busy === 'Remove BG' ? 'Removing…' : 'Remove background'}
                onClick={handleRemoveBg}
                disabled={!!busy}
                variant="full"
              />
              <p className="text-[10px] leading-snug text-fg-dim">Runs as a separate ComfyUI job (BRIA RMBG). Replaces the current image with the result.</p>
            </ToolSection>

            <div className="flex-1" />

            <div className="flex flex-col gap-1.5">
              <div className="flex h-8 w-full overflow-hidden rounded-md border border-border-default bg-bg-elev">
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={!!busy || cursor === 0}
                  className="flex flex-1 items-center justify-center gap-1.5 px-2 text-[11px] font-medium text-fg-tertiary transition-colors hover:text-fg-secondary disabled:cursor-default disabled:opacity-50"
                >
                  <ResetIcon size={11} />
                  Reset to original
                </button>
                <RPopover.Root>
                  <RPopover.Trigger asChild>
                    <button
                      type="button"
                      disabled={!!busy || history.length < 2}
                      title="Version history"
                      aria-label="Version history"
                      className="flex w-8 shrink-0 items-center justify-center border-l border-border-default text-fg-tertiary transition-colors hover:bg-bg-base/40 hover:text-fg-secondary disabled:cursor-default disabled:opacity-50"
                    >
                      <ChevronDownIcon size={11} />
                    </button>
                  </RPopover.Trigger>
                  <RPopover.Portal>
                    <RPopover.Content
                      side="left"
                      align="end"
                      sideOffset={8}
                      className="z-[60] w-[260px] overflow-hidden rounded-lg border border-border-default bg-bg-elev shadow-xl"
                    >
                      <HistoryList history={history} cursor={cursor} onPick={revertTo} />
                    </RPopover.Content>
                  </RPopover.Portal>
                </RPopover.Root>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="h-9 w-full rounded-md bg-accent px-2 text-[12px] font-semibold text-white hover:bg-accent-hover"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function HistoryList({
  history, cursor, onPick,
}: {
  history: HistoryStep[];
  cursor: number;
  onPick: (idx: number) => void;
}) {
  // Newest-first reads better in a dropdown — but keep the underlying indexes
  // so onPick references the real history array.
  const reversed = useMemo(
    () => history.map((s, i) => ({ step: s, idx: i })).reverse(),
    [history],
  );
  return (
    <div className="flex flex-col">
      <div className="border-b border-border-subtle px-3 py-2 text-[10px] font-semibold uppercase tracking-section text-fg-tertiary">
        Version history
      </div>
      <div className="scroll-y max-h-[320px] p-1.5">
        {reversed.map(({ step, idx }) => {
          const active = idx === cursor;
          return (
            <RPopover.Close asChild key={`${step.at}-${idx}`}>
              <button
                type="button"
                onClick={() => onPick(idx)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition-colors',
                  active ? 'bg-accent-soft' : 'hover:bg-bg-base/60',
                )}
              >
                <img
                  src={step.state.dataUrl}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded border border-border-default object-cover"
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cn('truncate text-[12px] font-medium', active ? 'text-accent-fg' : 'text-fg-secondary')}>
                    {idx === 0 ? 'Original' : step.label}
                  </span>
                  <span className="font-mono text-[10px] text-fg-dim">
                    {step.state.width}×{step.state.height}
                    {idx > 0 && ` · step ${idx}`}
                  </span>
                </span>
                {active && <CheckIcon size={13} className="shrink-0 text-accent-fg" />}
              </button>
            </RPopover.Close>
          );
        })}
      </div>
    </div>
  );
}

function ToolSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-[10px] font-semibold uppercase tracking-section text-fg-dim">{title}</h3>
      {children}
    </section>
  );
}

function ToolButton({
  label, onClick, disabled, variant = 'compact',
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'compact' | 'full';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded-md border border-border-default bg-bg-elev px-2 text-[11px] font-medium text-fg-tertiary transition-colors hover:border-accent-hover hover:text-accent-fg disabled:opacity-50 disabled:cursor-not-allowed',
        variant === 'full' ? 'h-9 w-full' : 'h-8',
      )}
    >
      {label}
    </button>
  );
}

function FilterRow({
  label, value, min, max, step, onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[70px] shrink-0 text-[11px] text-fg-muted">{label}</span>
      <Slider value={value} onValueChange={onChange} min={min} max={max} step={step} ariaLabel={label} />
      <span className="w-10 shrink-0 text-right text-[11px] font-medium tabular-nums text-fg-secondary">
        {step >= 1 ? value.toFixed(0) : value.toFixed(2)}
      </span>
    </div>
  );
}
