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
import { subscribeComfy, type ComfyEvent } from '@/lib/comfyBus';
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
  /** 0..1 through the current node's steps, or null when nothing is sampling. */
  progress: number | null;
  /** The node ComfyUI is executing, as the workflow names it. */
  currentNode: string | null;
  /** Object URL of the latest live preview frame, or null. */
  preview: string | null;
  /** True while the socket for this host is up. */
  connected: boolean;
  /** Jobs waiting on this server, including other clients'. */
  queueRemaining: number;
}

const MAX_RESULTS = 60;
/** Safety net only: the socket drives everything, but a missed `executed` should not hang forever. */
const WATCHDOG_MS = 8000;

export function useStudioRun(host: string | null, info: ObjectInfo | null): StudioRun {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<StudioResult[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [currentNode, setCurrentNode] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [queueRemaining, setQueueRemaining] = useState(0);

  /** The prompt this hook is waiting on. Events for anything else belong to another client. */
  const waitingFor = useRef<string | null>(null);
  /** Node id → the workflow's own name for it, so progress can say "KSampler" not "5". */
  const nodeNames = useRef<Record<string, string>>({});
  /** Object URLs made for preview frames, revoked as they are replaced. */
  const previewUrl = useRef<string | null>(null);

  const clearPreview = useCallback(() => {
    if (previewUrl.current) { URL.revokeObjectURL(previewUrl.current); previewUrl.current = null; }
    setPreview(null);
  }, []);

  const finish = useCallback(() => {
    waitingFor.current = null;
    setBusy(false);
    setProgress(null);
    setCurrentNode(null);
    setStatus(null);
    clearPreview();
  }, [clearPreview]);

  // ── The socket ─────────────────────────────────────────────────────────
  // Everything the UI shows while a job runs comes from here. Polling /history could only ever
  // report that a run had finished; the socket reports each node starting, each sampler step, and
  // each image the moment it is written — which is the difference between a spinner and knowing
  // what the machine is doing.
  useEffect(() => {
    if (!host) { setConnected(false); return; }
    const onEvent = (ev: ComfyEvent) => {
      if ('promptId' in ev && ev.promptId && waitingFor.current && ev.promptId !== waitingFor.current) {
        return;                       // another client's job on the same server
      }
      switch (ev.type) {
        case 'status':
          return setQueueRemaining(ev.queueRemaining);

        case 'execution_start':
          setStatus('Running');
          return setProgress(null);

        case 'executing':
          if (ev.node == null) return;           // null means "this prompt is done"
          setCurrentNode(nodeNames.current[ev.node] ?? `node ${ev.node}`);
          return setProgress(null);

        case 'progress':
          return setProgress(ev.max > 0 ? ev.value / ev.max : null);

        case 'binary': {
          // A live preview frame. Swap the object URL and revoke the old one, or a long run leaks
          // one blob per step.
          const url = URL.createObjectURL(new Blob([ev.bytes as BlobPart], { type: ev.mime }));
          if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
          previewUrl.current = url;
          return setPreview(url);
        }

        case 'execution_success':
          // `executed` only fires for nodes that produced an output, so a workflow ending in a
          // node that saves nothing would leave the button spinning until the watchdog. This is
          // ComfyUI saying the whole prompt is done, which is the signal to trust.
          if (ev.promptId === waitingFor.current) finish();
          return;

        case 'executed': {
          if (!ev.images.length) return;
          const made = ev.images.map(img => ({
            url: viewUrl(img, host), filename: img.filename, promptId: ev.promptId, createdAt: Date.now(),
          }));
          // Images arrive per node as they are saved, so a workflow with several SaveImage nodes
          // shows each one as it lands rather than all of them at the end.
          setResults(prev => [...made, ...prev].slice(0, MAX_RESULTS));
          return;   // the run ends on execution_success, not on the first node that saved something
        }

        case 'execution_error':
          setError(ev.message);
          return finish();

        default:
          return;
      }
    };

    return subscribeComfy(host, {
      onOpen: () => setConnected(true),
      onClose: () => setConnected(false),
      onEvent,
    });
  }, [host, finish]);

  // Revoke the last preview URL when the hook goes away.
  useEffect(() => () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);

  const run = useCallback(async () => {
    const { workflow, rerollSeeds } = useStudio.getState();
    if (!host || !info || !workflow) return;

    setError(null);
    setBusy(true);
    setStatus('Queued');
    clearPreview();
    try {
      // A fresh seed per run is what anyone pressing Generate twice expects. ComfyUI's own
      // control_after_generate does this inside the editor; nothing does it for us out here.
      rerollSeeds();
      const { graph, warnings } = buildApiGraph(workflow, info, useStudio.getState().currentValues());
      if (warnings.length) setStatus(warnings[0]);

      // Name the nodes before submitting, so the very first `executing` can be described.
      nodeNames.current = Object.fromEntries(Object.entries(graph).map(([id, n]) => {
        const node = n as { class_type: string; _meta?: { title?: string } };
        return [id, node._meta?.title || node.class_type];
      }));

      const queued = await queueGraph(host, graph);
      if (!queued.ok) { setError(queued.error); setBusy(false); setStatus(null); return; }
      waitingFor.current = queued.promptId;

      // Watchdog. The socket should deliver everything, but a connection that drops mid-run would
      // otherwise leave the button disabled forever. One /history check settles it.
      const id = queued.promptId;
      const watchdog = setInterval(async () => {
        if (waitingFor.current !== id) { clearInterval(watchdog); return; }
        try {
          const res = await fetch(`${comfyHttpFor(host)}/history/${id}`);
          const rec = (await res.json())?.[id];
          if (!rec?.status?.completed) return;
          const found: StudioResult[] = [];
          for (const out of Object.values(rec.outputs ?? {}) as Array<{ images?: Array<{ filename: string; subfolder?: string; type?: string }> }>) {
            for (const img of out.images ?? []) {
              found.push({ url: viewUrl(img, host), filename: img.filename, promptId: id, createdAt: Date.now() });
            }
          }
          if (found.length) {
            setResults(prev => {
              const known = new Set(prev.map(r => r.url));
              const fresh = found.filter(f => !known.has(f.url));
              return fresh.length ? [...fresh, ...prev].slice(0, MAX_RESULTS) : prev;
            });
          }
          clearInterval(watchdog);
          finish();
        } catch { /* the socket is still the primary path */ }
      }, WATCHDOG_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
      setStatus(null);
    }
  }, [host, info, clearPreview, finish]);

  const cancel = useCallback(async () => {
    if (!host) return;
    try { await fetch(`${comfyHttpFor(host)}/interrupt`, { method: 'POST' }); } catch { /* best effort */ }
    finish();
  }, [host, finish]);

  return {
    run, cancel, busy, status, error, results, latest: results[0] ?? null,
    progress, currentNode, preview, connected, queueRemaining,
  };
}
