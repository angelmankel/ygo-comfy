/**
 * The pieces both Studio shells are built from: the workflow picker, the knob list, and the image
 * area. Keeping them here means the phone and the desktop show the same thing arranged
 * differently, rather than being two implementations that drift apart.
 */
import type { SavedWorkflow } from '@/lib/comfy';
import { cn } from '@/lib/cn';
import { IconButton } from '@/components/ui/IconButton';
import { ResetIcon } from '@/components/ui/icons';
import { ParamField } from './ParamField';
import { paramLabel, type WorkflowParam } from './params';
import { exposedParams, useStudio } from './studioStore';

/**
 * Stable empties.
 *
 * A zustand selector is compared by reference. `s.exposed[path] ?? []` builds a new array on every
 * render, so the store reports a change every time, which re-renders, which builds another — React
 * error #185, "maximum update depth exceeded". Returning the same frozen empty breaks the cycle.
 */
const NO_IDS: string[] = [];
const NO_VALUES: Record<string, unknown> = {};

/** Pick which saved ComfyUI workflow to drive. */
export function WorkflowPicker({
  workflows, onOpen, onRefresh, large,
}: {
  workflows: SavedWorkflow[];
  onOpen: (path: string) => void;
  onRefresh: () => void;
  large?: boolean;
}) {
  const path = useStudio(s => s.path);

  if (!workflows.length) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border-subtle p-4 text-center">
        <p className="text-[13px] font-medium text-fg-secondary">No saved workflows yet</p>
        <p className="text-[12px] text-fg-muted">
          Build one in ComfyUI and save it. It shows up here on its own, a moment later.
        </p>
        <button type="button" onClick={onRefresh} className="mt-1 text-[12px] text-accent">
          Look again
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {workflows.map(w => (
        <button
          key={w.path}
          type="button"
          onClick={() => onOpen(w.path)}
          className={cn(
            'flex items-center justify-between gap-2 rounded-lg px-3 text-left transition-colors',
            large ? 'min-h-[48px] text-[14px]' : 'min-h-[40px] text-[13px]',
            w.path === path
              ? 'bg-accent/15 text-fg-primary ring-1 ring-accent/40'
              : 'text-fg-secondary hover:bg-bg-hover',
          )}
        >
          <span className="truncate">{w.name}</span>
          {w.path === path && <span className="shrink-0 text-[11px] text-accent">open</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * The knobs.
 *
 * In simple mode this is only what the person chose to expose — the point of the whole view: a
 * workflow with ninety widgets reduced to the four that matter today. In advanced mode it is
 * everything, grouped by the node it came from, each with a pin that adds it to simple mode.
 */
export function ParamList({ large }: { large?: boolean }) {
  const params = useStudio(s => s.params);
  const path = useStudio(s => s.path);
  const mode = useStudio(s => s.mode);
  const exposedIds = useStudio(s => (s.path ? s.exposed[s.path] ?? NO_IDS : NO_IDS));
  const values = useStudio(s => (s.path ? s.values[s.path] ?? NO_VALUES : NO_VALUES));
  const setValue = useStudio(s => s.setValue);
  const resetValue = useStudio(s => s.resetValue);
  const toggleExposed = useStudio(s => s.toggleExposed);

  if (!path) return <Hint>Pick a workflow to see its controls.</Hint>;
  if (!params.length) return <Hint>This workflow has no adjustable inputs.</Hint>;

  const valueOf = (p: WorkflowParam) => (p.id in values ? values[p.id] : p.value);

  if (mode === 'simple') {
    const shown = exposedParams(params, exposedIds);
    if (!shown.length) {
      return (
        <Hint>
          Nothing is pinned yet. Switch to Advanced and pin the few controls you want here.
        </Hint>
      );
    }
    return (
      <div className="flex flex-col gap-1">
        {shown.map(p => (
          <ParamField
            key={p.id}
            param={p}
            value={valueOf(p)}
            onChange={v => setValue(p.id, v)}
            onReset={() => resetValue(p.id)}
            large={large}
          />
        ))}
      </div>
    );
  }

  // Advanced: every knob, grouped by node, in graph order.
  const groups: { nodeId: number; label: string; items: WorkflowParam[] }[] = [];
  for (const p of params) {
    const last = groups[groups.length - 1];
    if (last && last.nodeId === p.nodeId) last.items.push(p);
    else groups.push({ nodeId: p.nodeId, label: p.nodeLabel, items: [p] });
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map(g => (
        <section key={g.nodeId} className="flex flex-col gap-1">
          <h3 className="flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
            <span className="truncate">{g.label}</span>
            <span className="shrink-0 font-normal normal-case tracking-normal opacity-60">#{g.nodeId}</span>
          </h3>
          {g.items.map(p => (
            <div key={p.id} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <ParamField
                  param={p}
                  value={valueOf(p)}
                  onChange={v => setValue(p.id, v)}
                  onReset={() => resetValue(p.id)}
                  large={large}
                />
              </div>
              <button
                type="button"
                onClick={() => toggleExposed(p.id)}
                aria-pressed={exposedIds.includes(p.id)}
                title={exposedIds.includes(p.id) ? 'Remove from the simple view' : 'Show this in the simple view'}
                className={cn(
                  'mt-6 h-9 w-9 shrink-0 rounded-lg border text-[15px] leading-none transition-colors',
                  exposedIds.includes(p.id)
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-border-subtle text-fg-muted hover:text-fg-secondary',
                )}
              >
                {exposedIds.includes(p.id) ? '★' : '☆'}
              </button>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

/** The most recent image, plus everything else this session produced. */
export function ResultView({
  results, latest, busy, status,
}: {
  results: { url: string; filename: string }[];
  latest: { url: string } | null;
  busy: boolean;
  status: string | null;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-bg-base">
        {latest ? (
          <img src={latest.url} alt="Latest generation" className="max-h-full max-w-full object-contain" />
        ) : (
          <p className="px-6 text-center text-[13px] italic text-fg-muted">
            {busy ? (status ?? 'Working…') : 'No image yet — press Generate.'}
          </p>
        )}
        {busy && latest && (
          <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-accent/10">
            <div className="animate-view-loading h-full w-1/3 bg-gradient-to-r from-transparent via-accent to-transparent" />
          </div>
        )}
      </div>
      {results.length > 1 && (
        <div className="scroll-x-thin flex shrink-0 gap-2 pb-1">
          {results.map(r => (
            <img
              key={r.url}
              src={r.url}
              alt={r.filename}
              className="h-16 w-16 shrink-0 rounded-md object-cover ring-1 ring-border-subtle"
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Reset every knob on the open workflow back to what ComfyUI saved. */
export function ResetAllButton() {
  const path = useStudio(s => s.path);
  const params = useStudio(s => s.params);
  const resetValue = useStudio(s => s.resetValue);
  if (!path || !params.length) return null;
  return (
    <IconButton
      aria-label="Reset every control"
      title="Back to the values saved in ComfyUI"
      onClick={() => params.forEach(p => resetValue(p.id))}
    >
      <ResetIcon size={15} />
    </IconButton>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="px-1 py-6 text-center text-[13px] text-fg-muted">{children}</p>;
}

export { paramLabel };
