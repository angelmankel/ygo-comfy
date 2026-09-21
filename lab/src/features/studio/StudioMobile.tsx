/**
 * Studio on a phone.
 *
 * Three panes side by side — Workflows, Controls, Image — one on screen at a time, swiped
 * between. No drawers, no overlays, nothing that can cover anything else: the failure the
 * generate view had on a phone was two overlays fighting for the same pixels, and the way to not
 * have that bug is to not have overlays.
 *
 * Generate is pinned to the bottom of every pane. It is the one thing always worth reaching, and
 * it sits above the gesture bar rather than under it.
 *
 * Controller support is for a phone in a clip-on gamepad:
 *   A        generate            LB / RB   previous / next pane
 *   B        stop a running job  X         reroll every seed
 *   up/down  move between knobs  left/right nudge the selected knob
 * The selected knob is highlighted and scrolled to, so the stick alone can drive the whole view.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { ParamList, ResetAllButton, ResultView, WorkflowPicker } from './StudioPanels';
import { GenerateBar } from './StudioView';
import { exposedParams, useStudio } from './studioStore';
import { paramLabel, randomSeed, type WorkflowParam } from './params';
import { useGamepad, type PadButton } from './useGamepad';
import { useSwipe } from './useSwipe';
import type { useStudioRun } from './useStudioRun';
import type { useWorkflowLibrary } from './useWorkflowLibrary';

type Library = ReturnType<typeof useWorkflowLibrary>;
type Run = ReturnType<typeof useStudioRun>;

/**
 * Stable empties.
 *
 * A zustand selector is compared by reference. `s.exposed[path] ?? []` builds a new array on every
 * render, so the store reports a change every time, which re-renders, which builds another — React
 * error #185, "maximum update depth exceeded". Returning the same frozen empty breaks the cycle.
 */
const NO_IDS: string[] = [];
const NO_VALUES: Record<string, unknown> = {};

const PANES = ['workflows', 'controls', 'image'] as const;
type Pane = (typeof PANES)[number];
const PANE_LABEL: Record<Pane, string> = { workflows: 'Workflows', controls: 'Controls', image: 'Image' };

export function StudioMobile({ library, run }: { library: Library; run: Run }) {
  const [pane, setPane] = useState<Pane>('controls');
  const mode = useStudio(s => s.mode);
  const setMode = useStudio(s => s.setMode);
  const params = useStudio(s => s.params);
  const path = useStudio(s => s.path);
  const exposedIds = useStudio(s => (s.path ? s.exposed[s.path] ?? NO_IDS : NO_IDS));
  const setValue = useStudio(s => s.setValue);
  const values = useStudio(s => (s.path ? s.values[s.path] ?? NO_VALUES : NO_VALUES));

  // A finished image is the thing you wanted to see, so show it without being asked.
  const lastResult = useRef<string | null>(null);
  useEffect(() => {
    if (run.latest && run.latest.url !== lastResult.current) {
      lastResult.current = run.latest.url;
      setPane('image');
    }
  }, [run.latest]);

  const step = useCallback((dir: 1 | -1) => {
    setPane(p => PANES[Math.min(PANES.length - 1, Math.max(0, PANES.indexOf(p) + dir))]);
  }, []);

  useSwipe(dir => step(dir === 'left' ? 1 : -1));

  // ── Controller ──────────────────────────────────────────────────────────
  // The knobs the stick can reach: whatever the current mode is showing.
  const reachable = useMemo(
    () => (mode === 'simple' ? exposedParams(params, exposedIds) : params),
    [mode, params, exposedIds],
  );
  const [cursor, setCursor] = useState(0);
  useEffect(() => { setCursor(c => Math.min(c, Math.max(0, reachable.length - 1))); }, [reachable.length]);

  const nudge = useCallback((p: WorkflowParam | undefined, dir: 1 | -1) => {
    if (!p) return;
    const cur = p.id in values ? values[p.id] : p.value;
    switch (p.type) {
      case 'BOOLEAN': return setValue(p.id, dir > 0);
      case 'COMBO': {
        const opts = (p.options ?? []).map(String);
        if (!opts.length) return;
        const i = Math.max(0, opts.indexOf(String(cur)));
        return setValue(p.id, opts[(i + dir + opts.length) % opts.length]);
      }
      case 'INT':
      case 'FLOAT': {
        if (p.seedLike) return setValue(p.id, randomSeed());
        const stepSize = p.step ?? (p.type === 'FLOAT' ? 0.05 : 1);
        const next = Number(cur ?? 0) + stepSize * dir;
        const clamped = Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, next));
        // Floating point drift turns 0.6 into 0.6000000000000001 after a few taps.
        return setValue(p.id, p.type === 'INT' ? Math.round(clamped) : Number(clamped.toFixed(4)));
      }
      default: return;
    }
  }, [values, setValue]);

  const onPress = useCallback((b: PadButton) => {
    switch (b) {
      case 'a':     if (!run.busy && path) void run.run(); break;
      case 'b':     if (run.busy) void run.cancel(); break;
      case 'x':     useStudio.getState().rerollSeeds(); break;
      case 'y':     setMode(useStudio.getState().mode === 'simple' ? 'advanced' : 'simple'); break;
      case 'lb':    step(-1); break;
      case 'rb':    step(1); break;
      case 'up':    setPane('controls'); setCursor(c => Math.max(0, c - 1)); break;
      case 'down':  setPane('controls'); setCursor(c => Math.min(reachable.length - 1, c + 1)); break;
      case 'left':  nudge(reachable[cursor], -1); break;
      case 'right': nudge(reachable[cursor], 1); break;
      default: break;
    }
  }, [run, path, step, reachable, cursor, nudge, setMode]);

  const padConnected = useGamepad({ onPress });

  // Keep the controller's selection on screen.
  const selectedRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (padConnected) selectedRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [cursor, padConnected]);

  const selected = reachable[cursor];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Pane tabs — the swipe is the fast way, these are the discoverable way. */}
      <div role="tablist" className="flex shrink-0 border-b border-border-subtle bg-bg-panel">
        {PANES.map(p => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={pane === p}
            onClick={() => setPane(p)}
            className={cn(
              'relative min-h-[44px] flex-1 text-[13px] font-medium transition-colors',
              pane === p ? 'text-fg-primary' : 'text-fg-muted',
            )}
          >
            {PANE_LABEL[p]}
            {pane === p && <span className="absolute inset-x-4 bottom-0 h-0.5 rounded-t-full bg-accent" />}
          </button>
        ))}
      </div>

      <div className="scroll-y min-h-0 flex-1 px-3 py-3">
        {pane === 'workflows' && (
          <div className="flex flex-col gap-3">
            <WorkflowPicker workflows={library.workflows} onOpen={p => { void library.open(p); setPane('controls'); }} onRefresh={library.refresh} large />
            {library.error && <p className="text-[12px] text-red-400">{library.error}</p>}
          </div>
        )}

        {pane === 'controls' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className="flex flex-1 overflow-hidden rounded-lg border border-border-subtle">
                {(['simple', 'advanced'] as const).map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={cn(
                      'min-h-[40px] flex-1 text-[13px] capitalize transition-colors',
                      mode === m ? 'bg-accent text-white' : 'text-fg-muted',
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <ResetAllButton />
            </div>
            {/* The controller's selection is drawn here rather than inside ParamList so the list
                stays the same component the desktop uses. */}
            <div className="relative">
              {padConnected && selected && (
                <div
                  ref={selectedRef}
                  className="pointer-events-none absolute -inset-x-2 rounded-lg ring-2 ring-accent/60"
                  style={{ top: 0, height: 0 }}
                  aria-hidden
                />
              )}
              <ParamList large />
            </div>
          </div>
        )}

        {pane === 'image' && (
          <div className="h-full min-h-[50vh]">
            <ResultView results={run.results} latest={run.latest} busy={run.busy} status={run.status} />
          </div>
        )}
      </div>

      {run.error && <p className="shrink-0 px-3 pb-1 text-[12px] text-red-400">{run.error}</p>}

      <div className="shrink-0 border-t border-border-subtle bg-bg-panel px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
        {padConnected && (
          <p className="pb-2 text-center text-[11px] text-fg-muted">
            {selected ? `▲▼ ${paramLabel(selected)} · ◀▶ adjust · ` : ''}A generate · X reseed · LB/RB pane
          </p>
        )}
        <GenerateBar run={run} large />
      </div>
    </div>
  );
}
