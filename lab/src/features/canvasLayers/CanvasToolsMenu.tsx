/**
 * Canvas top-nav "Tools" menu — one-shot ComfyUI image manipulations targeted
 * at the active layer's currently-selected history image. Each entry is a
 * ToolGraphBuilder from `lib/imageJobs`; the runActiveLayerTool helper handles
 * server selection, blob fetch, queue, polling, and per-layer history stamp.
 */
import { useState, type ComponentType } from 'react';
import * as RPopover from '@radix-ui/react-popover';
import { useCanvasStore } from '@/lib/canvasStore';
import {
  blurGraph,
  invertGraph,
  removeBackgroundGraph,
  sharpenGraph,
  type ToolGraphBuilder,
} from '@/lib/imageJobs';
import { runActiveLayerTool } from './runLayerTool';
import {
  EraserIcon, SparkleIcon, TuneIcon, type IconProps,
} from '@/components/ui/icons';
import { cn } from '@/lib/cn';

type ToolEntry = {
  id: string;
  label: string;
  blurb: string;
  Icon: ComponentType<IconProps>;
  graph: ToolGraphBuilder;
};

const TOOLS: ToolEntry[] = [
  {
    id: 'remove-bg',
    label: 'Remove background',
    blurb: 'BRIA RMBG — cleanly cut out the subject.',
    Icon: EraserIcon,
    graph: removeBackgroundGraph,
  },
  {
    id: 'blur',
    label: 'Blur',
    blurb: 'Gaussian blur — soften the whole image.',
    Icon: SparkleIcon,
    graph: blurGraph,
  },
  {
    id: 'sharpen',
    label: 'Sharpen',
    blurb: 'Unsharp mask — pull out fine detail.',
    Icon: TuneIcon,
    graph: sharpenGraph,
  },
  {
    id: 'invert',
    label: 'Invert colors',
    blurb: 'Photographic negative.',
    Icon: SparkleIcon,
    graph: invertGraph,
  },
];

export function CanvasToolsMenu() {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const hasLayer = useCanvasStore(s => s.activeLayerId !== null);
  const activeLayer = useCanvasStore(s =>
    s.activeLayerId ? s.canvasLayers.find(l => l.id === s.activeLayerId) ?? null : null);
  const hasSource = !!activeLayer?.selectedHistoryId;

  const onRun = async (tool: ToolEntry) => {
    if (running) return;
    setRunning(tool.id);
    try {
      await runActiveLayerTool(tool.label, tool.graph);
    } finally {
      setRunning(null);
      setOpen(false);
    }
  };

  const disabled = !hasLayer || !hasSource;

  return (
    <RPopover.Root open={open} onOpenChange={setOpen}>
      <RPopover.Trigger asChild>
        <button
          type="button"
          title={disabled
            ? 'Select a layer with an image to run image tools.'
            : 'ComfyUI image tools (Remove BG, Blur, …)'}
          aria-label="Image tools"
          className={cn(
            'flex h-8 items-center gap-1 rounded-lg border bg-bg-elev/85 px-2 text-[12px] font-medium text-fg-tertiary shadow-sm backdrop-blur-md transition-colors',
            disabled
              ? 'cursor-not-allowed border-border-subtle opacity-50'
              : 'border-border-default hover:border-border-strong hover:text-fg-secondary',
          )}
          disabled={disabled}
        >
          <TuneIcon size={14} />
          <span>Tools</span>
        </button>
      </RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content
          align="center"
          sideOffset={8}
          className="z-50 w-[260px] overflow-hidden rounded-lg border border-border-default bg-bg-elev shadow-xl"
        >
          <div className="border-b border-border-subtle px-3 py-2 text-[10px] font-semibold uppercase tracking-section text-fg-tertiary">
            Image tools
          </div>
          <div className="p-1.5">
            {TOOLS.map(t => {
              const isRunning = running === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { void onRun(t); }}
                  disabled={!!running}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors',
                    running && !isRunning && 'opacity-50',
                    !running && 'hover:bg-bg-base/60',
                  )}
                >
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-bg-base/60 text-fg-tertiary">
                    {isRunning ? <Spinner /> : <t.Icon size={14} />}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[12px] font-medium text-fg-secondary">
                      {t.label}{isRunning ? '…' : ''}
                    </span>
                    <span className="text-[10.5px] leading-tight text-fg-tertiary">{t.blurb}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="border-t border-border-subtle bg-bg-base/40 px-3 py-1.5 text-[10px] text-fg-dim">
            Runs on the next round-robin server. Result stamps a new history entry.
          </div>
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" className="animate-spin" aria-hidden>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" fill="none" strokeDasharray="9 27" />
    </svg>
  );
}
