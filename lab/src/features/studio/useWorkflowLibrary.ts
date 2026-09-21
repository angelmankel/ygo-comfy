/**
 * Keeps Studio in step with ComfyUI without ComfyUI knowing Studio exists.
 *
 * ComfyUI has no "workflow changed" event to subscribe to, so the only honest way to follow it is
 * to watch the userdata store it saves into. The list carries a modified time per file, which
 * makes the check cheap: poll the list, and only refetch a workflow when its own timestamp moves.
 * Save in ComfyUI, and the knobs here update a moment later.
 *
 * Polling pauses when the tab is hidden. A phone in a pocket should not be talking to a GPU.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { listSavedWorkflows, loadSavedWorkflow, type SavedWorkflow } from '@/lib/comfy';
import type { EditorWorkflowWithSubgraphs, ObjectInfo } from '@/lib/workflowGraph';
import { useStudio } from './studioStore';

const POLL_MS = 4000;

export interface WorkflowLibrary {
  workflows: SavedWorkflow[];
  loading: boolean;
  error: string | null;
  /** Load one by path, replacing whatever Studio has open. */
  open: (path: string) => Promise<void>;
  /** Force a list refresh now, rather than waiting for the next tick. */
  refresh: () => void;
}

export function useWorkflowLibrary(host: string | null, info: ObjectInfo | null): WorkflowLibrary {
  const [workflows, setWorkflows] = useState<SavedWorkflow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const loadWorkflow = useStudio(s => s.loadWorkflow);
  const openPath = useStudio(s => s.path);

  // Last modified time we have actually loaded, per path. A save in ComfyUI moves the server's
  // timestamp past ours, which is the signal to refetch.
  const loadedAt = useRef<Record<string, number>>({});

  const open = useCallback(async (path: string) => {
    if (!host || !info) return;
    setLoading(true);
    try {
      const wf = await loadSavedWorkflow(host, path) as EditorWorkflowWithSubgraphs;
      loadWorkflow(path, wf, info);
      const stamp = workflows.find(w => w.path === path)?.modified ?? Date.now();
      loadedAt.current[path] = stamp;
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [host, info, loadWorkflow, workflows]);

  // `open` changes identity whenever the list does, which would restart the poll loop on every
  // tick. The loop calls through a ref instead so its effect depends only on host/info.
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (!host || !info) return;
    let stopped = false;
    let timer: number | undefined;

    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === 'hidden') { schedule(); return; }
      try {
        const list = await listSavedWorkflows(host);
        if (stopped) return;
        setWorkflows(list);
        setError(null);
        // The open workflow was saved again in ComfyUI — pick up the new version.
        const cur = useStudio.getState().path;
        if (cur) {
          const row = list.find(w => w.path === cur);
          if (row && row.modified > (loadedAt.current[cur] ?? 0)) await openRef.current(cur);
        }
      } catch (err) {
        if (!stopped) setError(err instanceof Error ? err.message : String(err));
      }
      schedule();
    };
    const schedule = () => { if (!stopped) timer = window.setTimeout(tick, POLL_MS); };

    void tick();
    const onVisible = () => { if (document.visibilityState === 'visible') void tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [host, info, nonce]);

  // Reopen last session's workflow once the list and object_info are both in hand.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || openPath || !workflows.length || !info) return;
    const last = useStudio.getState().lastPath;
    if (last && workflows.some(w => w.path === last)) {
      restored.current = true;
      void openRef.current(last);
    }
  }, [workflows, info, openPath]);

  return { workflows, loading, error, open, refresh: () => setNonce(n => n + 1) };
}
