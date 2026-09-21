/**
 * Studio's own state: which saved workflow is loaded, what its knobs are set to, and which of them
 * are worth showing when the person just wants to make pictures.
 *
 * Deliberately separate from the generate view's store. That one owns a fixed pipeline described
 * by WorkflowState; this one owns "whatever graph you built in ComfyUI", and the two have almost
 * nothing in common beyond the server list. Keeping them apart is what lets Studio be rebuilt
 * without touching a working view.
 */
import { create } from 'zustand';
import type { EditorWorkflowWithSubgraphs, ObjectInfo } from '@/lib/workflowGraph';
import { readParams, randomSeed, type WorkflowParam } from './params';

/** Per-workflow choices survive reloads — re-picking exposed knobs every session would be absurd. */
const KEY = 'imagelab.studio.v1';

export type StudioMode = 'simple' | 'advanced';

interface Persisted {
  /** workflow path → the param ids chosen for simple mode, in display order. */
  exposed: Record<string, string[]>;
  /** workflow path → last values, so a workflow reopens where it was left. */
  values: Record<string, Record<string, unknown>>;
  lastPath: string | null;
  mode: StudioMode;
  /** Hide ComfyUI itself and live only in this UI. */
  focusMode: boolean;
}

const EMPTY: Persisted = { exposed: {}, values: {}, lastPath: null, mode: 'simple', focusMode: true };

function load(): Persisted {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    return raw ? { ...EMPTY, ...raw } : EMPTY;
  } catch { return EMPTY; }
}

interface StudioStore extends Persisted {
  /** The loaded workflow, as saved in ComfyUI. Null until one is picked. */
  workflow: EditorWorkflowWithSubgraphs | null;
  /** Path of the loaded workflow — the key everything per-workflow is stored under. */
  path: string | null;
  /** Every knob found on it. Recomputed whenever the workflow or object_info changes. */
  params: WorkflowParam[];
  error: string | null;

  loadWorkflow: (path: string, wf: EditorWorkflowWithSubgraphs, info: ObjectInfo) => void;
  setValue: (id: string, value: unknown) => void;
  resetValue: (id: string) => void;
  toggleExposed: (id: string) => void;
  setExposed: (ids: string[]) => void;
  setMode: (mode: StudioMode) => void;
  setFocusMode: (on: boolean) => void;
  setError: (error: string | null) => void;
  /** Values for the loaded workflow, falling back to each param's own value. */
  currentValues: () => Record<string, unknown>;
  /** Re-roll every seed-like knob. Called before each run unless the person pinned the seed. */
  rerollSeeds: () => void;
}

export const useStudio = create<StudioStore>((set, get) => {
  const persisted = load();
  const persist = () => {
    const { exposed, values, lastPath, mode, focusMode } = get();
    try { localStorage.setItem(KEY, JSON.stringify({ exposed, values, lastPath, mode, focusMode })); }
    catch { /* private mode, a quota, a blocked origin — none of it should break the app */ }
  };

  return {
    ...persisted,
    workflow: null,
    path: null,
    params: [],
    error: null,

    loadWorkflow: (path, wf, info) => {
      const params = readParams(wf, info);
      // Drop remembered values whose knob no longer exists: the workflow was edited in ComfyUI and
      // the old id would otherwise be written back into a node that has moved on.
      const live = new Set(params.map(p => p.id));
      const kept = Object.fromEntries(
        Object.entries(get().values[path] ?? {}).filter(([id]) => live.has(id)));
      const exposed = (get().exposed[path] ?? []).filter(id => live.has(id));
      set(s => ({
        workflow: wf, path, params, error: null, lastPath: path,
        values: { ...s.values, [path]: kept },
        exposed: { ...s.exposed, [path]: exposed },
      }));
      persist();
    },

    setValue: (id, value) => {
      const path = get().path;
      if (!path) return;
      set(s => ({ values: { ...s.values, [path]: { ...s.values[path], [id]: value } } }));
      persist();
    },

    resetValue: (id) => {
      const path = get().path;
      if (!path) return;
      set(s => {
        const next = { ...s.values[path] };
        delete next[id];
        return { values: { ...s.values, [path]: next } };
      });
      persist();
    },

    toggleExposed: (id) => {
      const path = get().path;
      if (!path) return;
      set(s => {
        const cur = s.exposed[path] ?? [];
        const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
        return { exposed: { ...s.exposed, [path]: next } };
      });
      persist();
    },

    setExposed: (ids) => {
      const path = get().path;
      if (!path) return;
      set(s => ({ exposed: { ...s.exposed, [path]: ids } }));
      persist();
    },

    setMode: (mode) => { set({ mode }); persist(); },
    setFocusMode: (focusMode) => { set({ focusMode }); persist(); },
    setError: (error) => set({ error }),

    currentValues: () => {
      const { params, values, path } = get();
      const saved = path ? values[path] ?? {} : {};
      const out: Record<string, unknown> = {};
      for (const p of params) out[p.id] = p.id in saved ? saved[p.id] : p.value;
      return out;
    },

    rerollSeeds: () => {
      const { params, path } = get();
      if (!path) return;
      const seeds = params.filter(p => p.seedLike && p.type === 'INT');
      if (!seeds.length) return;
      set(s => {
        const next = { ...s.values[path] };
        for (const p of seeds) next[p.id] = randomSeed();
        return { values: { ...s.values, [path]: next } };
      });
      persist();
    },
  };
});

/** The params to show in simple mode: the chosen ones, in the order they were chosen. */
export function exposedParams(params: WorkflowParam[], exposed: string[]): WorkflowParam[] {
  const byId = new Map(params.map(p => [p.id, p]));
  return exposed.map(id => byId.get(id)).filter((p): p is WorkflowParam => !!p);
}
