/**
 * Studio — build the workflow in ComfyUI, drive it from here.
 *
 * A second UI beside the generate view, not a replacement for it. The generate view knows one
 * pipeline very well; Studio knows none, and reads whatever workflow it is given. The two share
 * components, the server list and the comfy client, and share no state at all.
 *
 * Focus mode is the reason it exists: once the few controls that matter are pinned, ComfyUI is
 * hidden and what is left is a picture, some knobs and a button. That mode is the default on a
 * phone, where a node graph was never going to be usable anyway.
 */
import { useMemo } from 'react';
import { useStore } from '@/lib/store';
import { useCanvasStore } from '@/lib/canvasStore';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { cn } from '@/lib/cn';
import { ParamList, ResetAllButton, ResultView, WorkflowPicker } from './StudioPanels';
import { StudioMobile } from './StudioMobile';
import { useObjectInfo, useStudioRun } from './useStudioRun';
import { useWorkflowLibrary } from './useWorkflowLibrary';
import { useStudio } from './studioStore';

/** The host Studio talks to: the server the person last chose, else the first enabled one. */
export function useStudioHost(): string | null {
  const servers = useStore(s => s.servers);
  const pinned = useCanvasStore(s => s.comfyServerId);
  const server = servers.find(s => s.id === pinned && s.enabled !== false)
    ?? servers.find(s => s.enabled !== false)
    ?? servers[0];
  return server?.host ?? null;
}

export function StudioView() {
  const host = useStudioHost();
  const isDesktop = useIsDesktop();
  const { info, error: infoError } = useObjectInfo(host);
  const library = useWorkflowLibrary(host, info);
  const run = useStudioRun(host, info);

  if (!host) {
    return <Dead title="No ComfyUI server" body="Add one in Settings, then come back." />;
  }
  if (infoError) {
    return <Dead title="Cannot reach ComfyUI" body={infoError} />;
  }
  if (!info) {
    return <Dead title="Reading the server…" body="Fetching the node catalogue." />;
  }

  return isDesktop
    ? <StudioDesktop library={library} run={run} host={host} />
    : <StudioMobile library={library} run={run} host={host} />;
}

type Library = ReturnType<typeof useWorkflowLibrary>;
type Run = ReturnType<typeof useStudioRun>;

function StudioDesktop({ library, run, host }: { library: Library; run: Run; host: string | null }) {
  const mode = useStudio(s => s.mode);
  const setMode = useStudio(s => s.setMode);
  const focusMode = useStudio(s => s.focusMode);
  const setFocusMode = useStudio(s => s.setFocusMode);
  const path = useStudio(s => s.path);
  const setMainView = useCanvasStore(s => s.setMainView);
  const paramCount = useStudio(s => s.params.length);

  return (
    <div className="flex h-full min-h-0">
      {/* Workflows */}
      <aside className="flex w-[260px] shrink-0 flex-col gap-3 border-r border-border-subtle p-3">
        <header className="flex items-center justify-between">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-fg-muted">Workflows</h2>
          <button type="button" onClick={library.refresh} className="text-[11px] text-accent">Refresh</button>
        </header>
        <div className="scroll-y min-h-0 flex-1">
          <WorkflowPicker workflows={library.workflows} onOpen={library.open} onRefresh={library.refresh} />
        </div>
        <footer className="flex flex-col gap-2 border-t border-border-subtle pt-3">
          <label className="flex items-center justify-between gap-2 text-[12px] text-fg-secondary">
            <span>Focus mode</span>
            <input
              type="checkbox"
              checked={focusMode}
              onChange={e => setFocusMode(e.target.checked)}
              className="h-4 w-4 accent-[var(--accent,#4F8AFF)]"
            />
          </label>
          <p className="text-[11px] leading-snug text-fg-muted">
            Hides ComfyUI from the sidebar so this is the only place to be.
          </p>
          {!focusMode && (
            <button
              type="button"
              onClick={() => setMainView('comfy')}
              className="rounded-lg border border-border-subtle py-2 text-[12px] text-fg-secondary hover:text-fg-primary"
            >
              Open ComfyUI
            </button>
          )}
        </footer>
      </aside>

      {/* Image */}
      <main className="flex min-w-0 flex-1 flex-col gap-3 p-3">
        <ResultView
          results={run.results}
          latest={run.latest}
          busy={run.busy}
          status={run.status}
          progress={run.progress}
          currentNode={run.currentNode}
          preview={run.preview}
          queueRemaining={run.queueRemaining}
        />
        {run.error && <p className="shrink-0 text-[12px] text-red-400">{run.error}</p>}
      </main>

      {/* Controls */}
      <aside className="flex w-[380px] shrink-0 flex-col border-l border-border-subtle">
        <header className="flex shrink-0 items-center gap-2 border-b border-border-subtle p-3">
          <div className="flex overflow-hidden rounded-lg border border-border-subtle">
            {(['simple', 'advanced'] as const).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  'px-3 py-1.5 text-[12px] capitalize transition-colors',
                  mode === m ? 'bg-accent text-white' : 'text-fg-muted hover:text-fg-secondary',
                )}
              >
                {m}
              </button>
            ))}
          </div>
          <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-[11px] text-fg-muted">
            <span
              title={run.connected ? 'Live — connected to ComfyUI' : 'Socket down'}
              className={cn('h-1.5 w-1.5 shrink-0 rounded-full', run.connected ? 'bg-emerald-400' : 'bg-red-400')}
            />
            {path ? `${paramCount} control${paramCount === 1 ? '' : 's'}` : 'nothing open'}
          </span>
          <ResetAllButton />
        </header>

        <div className="scroll-y min-h-0 flex-1 px-3 py-3">
          <ParamList host={host} />
        </div>

        <footer className="shrink-0 border-t border-border-subtle p-3">
          <GenerateBar run={run} />
        </footer>
      </aside>
    </div>
  );
}

export function GenerateBar({ run, large }: { run: Run; large?: boolean }) {
  const path = useStudio(s => s.path);
  const disabled = !path || run.busy;
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        // The sidebar's view switcher is also called "Generate". Distinct labels keep the two
        // apart for a screen reader, and for anything driving the UI by name.
        aria-label="Generate image"
        onClick={() => void run.run()}
        disabled={disabled}
        className={cn(
          'flex flex-1 items-center justify-center rounded-lg bg-accent font-semibold text-white transition-opacity',
          large ? 'h-14 text-[16px]' : 'h-11 text-[14px]',
          disabled && 'opacity-40',
        )}
      >
        {run.busy ? (run.status ?? 'Working…') : 'Generate'}
      </button>
      {run.busy && (
        <button
          type="button"
          onClick={() => void run.cancel()}
          className={cn(
            'shrink-0 rounded-lg border border-border-subtle px-4 text-fg-secondary',
            large ? 'h-14 text-[15px]' : 'h-11 text-[13px]',
          )}
        >
          Stop
        </button>
      )}
    </div>
  );
}

function Dead({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
      <p className="text-[14px] font-medium text-fg-secondary">{title}</p>
      <p className="text-[12.5px] text-fg-muted">{body}</p>
    </div>
  );
}

/** Memo-friendly export used by the sidebar to decide whether to offer ComfyUI at all. */
export function useFocusMode() {
  const focusMode = useStudio(s => s.focusMode);
  const isDesktop = useIsDesktop();
  // On a phone, focus mode is the point: a node graph on a 412px screen is not a thing anyone
  // wants, so ComfyUI stays hidden there regardless of the stored preference.
  return useMemo(() => (isDesktop ? focusMode : true), [focusMode, isDesktop]);
}
