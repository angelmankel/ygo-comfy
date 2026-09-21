/**
 * Raw `/object_info`, and running the loaded workflow.
 *
 * The generate view keeps a digest of object_info (sampler names, model lists) because that is all
 * its fixed pipeline needs. Studio needs the whole thing: it has to describe a node nobody
 * anticipated, so it holds the raw document and reads specs out of it on demand.
 *
 * Results are tracked here rather than through the generate view's history so the two can never
 * corrupt each other's state. Studio polls `/history` for the prompt it submitted and keeps every
 * image the run produced, newest first.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { comfyHttpFor, queueGraph, viewUrl } from '@/lib/comfy';
import type { ObjectInfo } from '@/lib/workflowGraph';
import { buildApiGraph } from './params';
import { useStudio } from './studioStore';

/** Raw object_info for a host, fetched once per host and kept for the session. */
const infoCache = new Map<string, ObjectInfo>();

export function useObjectInfo(host: string | null): { info: ObjectInfo | null; error: string | null } {
  const [info, setInfo] = useState<ObjectInfo | null>(host ? infoCache.get(host) ?? null : null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!host) { setInfo(null); return; }
    const cached = infoCache.get(host);
    if (cached) { setInfo(cached); return; }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${comfyHttpFor(host)}/object_info`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json() as ObjectInfo;
        infoCache.set(host, json);
        if (!cancelled) { setInfo(json); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [host]);

  return { info, error };
}

export interface StudioResult {
  url: string;
  filename: string;
  promptId: string;
  createdAt: number;
}

export interface StudioRun {
  run: () => Promise<void>;
  cancel: () => Promise<void>;
  busy: boolean;
  status: string | null;
  error: string | null;
  results: StudioResult[];
  /** Newest result, or null before anything has finished. */
  latest: StudioResult | null;
}

const POLL_MS = 1200;
const MAX_RESULTS = 60;

export function useStudioRun(host: string | null, info: ObjectInfo | null): StudioRun {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<StudioResult[]>([]);
  const abort = useRef(false);

  const run = useCallback(async () => {
    const { workflow, rerollSeeds } = useStudio.getState();
    if (!host || !info || !workflow) return;

    setError(null);
    setBusy(true);
    abort.current = false;
    try {
      // A fresh seed per run is what anyone pressing Generate twice expects. ComfyUI's own
      // control_after_generate does this inside the editor; nothing does it for us out here.
      rerollSeeds();
      const { graph, warnings } = buildApiGraph(workflow, info, useStudio.getState().currentValues());
      if (warnings.length) setStatus(warnings[0]);

      const queued = await queueGraph(host, graph);
      if (!queued.ok) { setError(queued.error); setBusy(false); return; }

      setStatus('Queued');
      const { promptId } = queued;
      // Poll the history for this prompt. The websocket would be faster, but it is owned by the
      // generate view's connection and sharing it would couple the two views together.
      for (;;) {
        if (abort.current) { setStatus('Cancelled'); break; }
        await new Promise(r => setTimeout(r, POLL_MS));
        const res = await fetch(`${comfyHttpFor(host)}/history/${promptId}`);
        const hist = await res.json();
        const rec = hist?.[promptId];
        if (!rec) { setStatus('Running'); continue; }
        if (rec.status?.status_str === 'error') {
          const msg = (rec.status.messages ?? [])
            .find((m: [string, { exception_message?: string }]) => m[0] === 'execution_error');
          setError(msg?.[1]?.exception_message ?? 'The workflow failed to execute');
          break;
        }
        if (!rec.status?.completed) { setStatus('Running'); continue; }

        const found: StudioResult[] = [];
        for (const out of Object.values(rec.outputs ?? {}) as Array<{ images?: Array<{ filename: string; subfolder?: string; type?: string }> }>) {
          for (const img of out.images ?? []) {
            found.push({ url: viewUrl(img, host), filename: img.filename, promptId, createdAt: Date.now() });
          }
        }
        if (!found.length) { setError('The run finished but produced no image — is there a SaveImage node?'); break; }
        setResults(prev => [...found, ...prev].slice(0, MAX_RESULTS));
        setStatus(null);
        break;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [host, info]);

  const cancel = useCallback(async () => {
    abort.current = true;
    if (!host) return;
    try { await fetch(`${comfyHttpFor(host)}/interrupt`, { method: 'POST' }); } catch { /* best effort */ }
  }, [host]);

  return { run, cancel, busy, status, error, results, latest: results[0] ?? null };
}
