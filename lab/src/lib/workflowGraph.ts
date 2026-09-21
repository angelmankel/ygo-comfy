/**
 * ComfyUI editor-workflow ⇄ API-graph conversion, and the node/param schema behind it.
 *
 * VENDORED, not imported: a full copy of ~/Github/comfy-cloud-client/src/workflows.ts, which is a
 * Node library this browser bundle cannot reach. The file has no imports and touches no Node
 * globals, so it runs unchanged here. There is no sync back — if the original moves on, this copy
 * is re-taken deliberately.
 *
 * Studio needs three things from it:
 *   nodeSpec()     — one node class's inputs, with widget type, default and options. This is what
 *                    makes "expose every parameter on a loaded workflow" possible at all.
 *   editorToApi()  — the workflow a person saved in ComfyUI, turned into the graph /prompt wants.
 *   setWidgetValue() — write one parameter back into the editor workflow before converting.
 */

// API-format graph ⇄ editor-format workflow.
//
// The API format ({ "<id>": { class_type, inputs } }) is what /api/prompt
// takes. The editor format (LiteGraph JSON: nodes with pos/size/widgets_values,
// a links table) is what the ComfyUI editor loads and what the Comfy Cloud
// workflow store keeps. Converting between them needs `object_info`, because
// the editor stores widget VALUES in a positional array whose ORDER is the
// node definition's `input_order`, and the API format stores them by NAME.
//
// apiToEditor: lays the nodes out in columns by depth so the graph is readable
//              when it opens in the editor (no positions exist in API format).
// editorToApi: resolves Reroute / PrimitiveNode / bypassed nodes, drops Notes,
//              maps widgets_values back to input names, and reports the
//              SaveImage nodes (id → filename_prefix) so a pipeline can file
//              each output.

export type ObjectInfo = Record<string, any>;
export type ApiGraph = Record<string, unknown>;
export type ApiRef = [string, number];

export interface EditorInput { name: string; type: string; link: number | null; widget?: { name: string } }
export interface EditorOutput { name: string; type: string; links: number[] | null; slot_index?: number }
/** [id, origin node, origin slot, target node, target slot, type] */
export type EditorLink = [number, number, number, number, number, string];
export interface EditorNode {
  id: number;
  type: string;
  pos: [number, number];
  size: [number, number];
  flags: Record<string, unknown>;
  order: number;
  /** 0 always, 2 muted (never), 4 bypass. */
  mode: number;
  inputs: EditorInput[];
  outputs: EditorOutput[];
  properties: Record<string, unknown>;
  widgets_values?: unknown[];
  title?: string;
  color?: string;
  bgcolor?: string;
}
export interface EditorWorkflow {
  last_node_id: number;
  last_link_id: number;
  nodes: EditorNode[];
  links: EditorLink[];
  groups: unknown[];
  config: Record<string, unknown>;
  extra: Record<string, unknown>;
  version: number;
}

export interface ApiNode { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }

/** One entry of a node definition's input list, in `input_order` order. */
export interface InputSpec {
  name: string;
  /** Socket type (MODEL, IMAGE, …) or the widget kind (INT, FLOAT, STRING, BOOLEAN, COMBO). */
  type: string;
  /** Present for widget inputs. */
  widget?: { default: unknown; control: boolean; multiline: boolean; options?: unknown[] };
  optional: boolean;
}
export interface NodeSpec { inputs: InputSpec[]; outputs: { name: string; type: string }[]; displayName: string }

const WIDGET_TYPES = new Set(["INT", "FLOAT", "STRING", "BOOLEAN", "COMBO"]);
/** Editor-only node types that never reach the API. */
const VIRTUAL = new Set(["Note", "MarkdownNote", "PrimitiveNode", "Reroute"]);
const MODE_MUTED = 2, MODE_BYPASS = 4;

export const isRef = (v: unknown): v is ApiRef =>
  Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "number";

/** Read one node class out of object_info into a flat, ordered spec. */
export function nodeSpec(info: ObjectInfo, classType: string): NodeSpec | undefined {
  const def = info[classType];
  if (!def) return undefined;
  const inputs: InputSpec[] = [];
  for (const group of ["required", "optional"] as const) {
    const defs = def.input?.[group] ?? {};
    const order: string[] = def.input_order?.[group] ?? Object.keys(defs);
    for (const name of order) {
      const spec = defs[name];
      if (!Array.isArray(spec)) continue;
      const [t, opts = {}] = spec as [unknown, Record<string, any>?];
      const o = opts ?? {};
      let type: string;
      let options: unknown[] | undefined;
      if (Array.isArray(t)) { type = "COMBO"; options = t; }
      else if (t === "COMBO") { type = "COMBO"; options = o.options ?? []; }
      else type = String(t);
      if (WIDGET_TYPES.has(type)) {
        const fallback = type === "COMBO" ? options?.[0] : type === "STRING" ? "" : type === "BOOLEAN" ? false : 0;
        inputs.push({
          name, type, optional: group === "optional",
          widget: { default: o.default ?? fallback, control: !!o.control_after_generate, multiline: !!o.multiline, options },
        });
      } else {
        inputs.push({ name, type, optional: group === "optional" });
      }
    }
  }
  const outTypes: unknown[] = def.output ?? [];
  const outNames: string[] = def.output_name ?? [];
  const outputs = outTypes.map((t, i) => ({ name: outNames[i] ?? String(t), type: Array.isArray(t) ? "COMBO" : String(t) }));
  return { inputs, outputs, displayName: def.display_name ?? classType };
}

function coerce(type: string, v: unknown): unknown {
  switch (type) {
    case "INT": return Math.round(Number(v));
    case "FLOAT": return Number(v);
    case "BOOLEAN": return typeof v === "string" ? v === "true" : Boolean(v);
    case "STRING": return v == null ? "" : String(v);
    default: return v;
  }
}

// ─── API → editor ───────────────────────────────────────────────────────────

export interface LayoutOptions {
  /** Horizontal gap between depth columns. */
  columnGap?: number;
  /** Vertical gap between nodes in a column. */
  rowGap?: number;
}

/**
 * Convert an API graph into an editor workflow. Node ids are kept when they
 * are integers (the Graph builder's "1", "2", …), so a round trip is stable.
 * Unknown node classes (not in `info`) still convert: a value that is a
 * ["id", slot] pair becomes a link, everything else a widget, in the order the
 * API graph lists them — but their widget ORDER may not match the editor's.
 */
export function apiToEditor(graph: ApiGraph, info: ObjectInfo, layout: LayoutOptions = {}): EditorWorkflow {
  const ids = Object.keys(graph);
  const numeric = new Map<string, number>();
  let next = Math.max(0, ...ids.map((k) => (/^\d+$/.test(k) ? Number(k) : 0)));
  for (const id of ids) numeric.set(id, /^\d+$/.test(id) ? Number(id) : ++next);

  const nodes = new Map<string, EditorNode>();
  const links: EditorLink[] = [];
  const inputSpecs = new Map<string, InputSpec[]>();

  for (const id of ids) {
    const n = graph[id] as ApiNode;
    const spec = nodeSpec(info, n.class_type);
    const specs: InputSpec[] = spec?.inputs ?? Object.entries(n.inputs).map(([name, v]) => (
      isRef(v) ? { name, type: "*", optional: false } : { name, type: widgetKind(v), optional: false, widget: { default: v, control: false, multiline: false } }
    ));
    // Widget inputs the API graph sets but the spec does not know (e.g. an older object_info): keep them as widgets at the end.
    for (const [name, v] of Object.entries(n.inputs)) {
      if (!specs.some((s) => s.name === name)) {
        specs.push(isRef(v) ? { name, type: "*", optional: true } : { name, type: widgetKind(v), optional: true, widget: { default: v, control: false, multiline: false } });
      }
    }
    inputSpecs.set(id, specs);
    const inputs: EditorInput[] = [];
    const widgets_values: unknown[] = [];
    let multiline = false;
    for (const s of specs) {
      const v = n.inputs[s.name];
      if (s.widget) {
        inputs.push({ name: s.name, type: s.type, link: null, widget: { name: s.name } });
        widgets_values.push(v === undefined || isRef(v) ? s.widget.default : v);
        if (s.widget.control) widgets_values.push("fixed");
        if (s.widget.multiline) multiline = true;
      } else {
        inputs.push({ name: s.name, type: s.type, link: null });
      }
    }
    if (n.class_type === "LoadImage" || n.class_type === "LoadImageMask") widgets_values.push("image");   // the upload button's slot
    const outputs: EditorOutput[] = (spec?.outputs ?? []).map((o, i) => ({ name: o.name, type: o.type, links: [], slot_index: i }));
    const nWidgets = specs.filter((s) => s.widget).length;
    const nSockets = Math.max(specs.filter((s) => !s.widget).length, outputs.length);
    const width = multiline ? 400 : 315;
    const height = 30 + 20 * nSockets + 24 * nWidgets + (multiline ? 110 : 0) + 6;
    const node: EditorNode = {
      id: numeric.get(id)!, type: n.class_type, pos: [0, 0], size: [width, height], flags: {}, order: 0, mode: 0,
      inputs, outputs, properties: { "Node name for S&R": n.class_type }, widgets_values,
    };
    if (n._meta?.title) node.title = n._meta.title;
    nodes.set(id, node);
  }

  // Links. A link into a socket that the spec has no output for (unknown class) still gets a slot entry.
  for (const id of ids) {
    const n = graph[id] as ApiNode;
    const node = nodes.get(id)!;
    const specs = inputSpecs.get(id)!;
    specs.forEach((s, slot) => {
      const v = n.inputs[s.name];
      if (!isRef(v)) return;
      const [srcId, srcSlot] = v;
      const src = nodes.get(srcId);
      if (!src) throw new Error(`node ${id} input ${s.name} references missing node ${srcId}`);
      while (src.outputs.length <= srcSlot) src.outputs.push({ name: `out${src.outputs.length}`, type: "*", links: [], slot_index: src.outputs.length });
      const out = src.outputs[srcSlot];
      const type = s.type === "*" ? out.type : s.type;
      const linkId = links.length + 1;
      links.push([linkId, src.id, srcSlot, node.id, slot, type]);
      node.inputs[slot].link = linkId;
      (out.links ??= []).push(linkId);
    });
  }

  // Layout: depth = longest path from a source node; one column per depth.
  const preds = new Map<string, string[]>();
  for (const id of ids) {
    const n = graph[id] as ApiNode;
    preds.set(id, Object.values(n.inputs).filter(isRef).map((r) => r[0]));
  }
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const hit = depth.get(id);
    if (hit !== undefined) return hit;
    if (visiting.has(id)) throw new Error(`graph has a cycle through node ${id}`);
    visiting.add(id);
    const d = Math.max(-1, ...preds.get(id)!.map(depthOf)) + 1;
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  ids.forEach(depthOf);
  const columnGap = layout.columnGap ?? 80, rowGap = layout.rowGap ?? 40;
  const columns = new Map<number, string[]>();
  for (const id of ids) (columns.get(depth.get(id)!) ?? columns.set(depth.get(id)!, []).get(depth.get(id)!)!).push(id);
  let x = 60;
  let order = 0;
  for (const d of [...columns.keys()].sort((a, b) => a - b)) {
    let y = 60, widest = 0;
    for (const id of columns.get(d)!) {
      const node = nodes.get(id)!;
      node.pos = [x, y];
      node.order = order++;
      y += node.size[1] + rowGap;
      widest = Math.max(widest, node.size[0]);
    }
    x += widest + columnGap;
  }

  return {
    last_node_id: Math.max(0, ...[...nodes.values()].map((n) => n.id)),
    last_link_id: links.length,
    nodes: [...nodes.values()],
    links,
    groups: [],
    config: {},
    extra: { ds: { scale: 1, offset: [0, 0] } },
    version: 0.4,
  };
}

function widgetKind(v: unknown): string {
  if (typeof v === "boolean") return "BOOLEAN";
  if (typeof v === "number") return Number.isInteger(v) ? "INT" : "FLOAT";
  return "STRING";
}

// ─── editor → API ───────────────────────────────────────────────────────────

export interface EditorToApiResult {
  graph: ApiGraph;
  /** SaveImage node id → filename_prefix, in graph order. */
  outputs: Record<string, string>;
  warnings: string[];
}

/**
 * Convert an editor workflow (as saved by the ComfyUI editor or the Comfy
 * Cloud workflow store) back into an API graph.
 *
 * - Note / MarkdownNote are dropped; Reroute is followed through; a
 *   PrimitiveNode feeding a widget becomes that widget's value.
 * - Muted nodes (mode 2) are dropped, and whatever they fed is left unconnected.
 * - Bypassed nodes (mode 4) pass their first input of the same type straight through.
 * - widgets_values are mapped to names via `input_order`; the extra
 *   "fixed"/"randomize" value after a seed widget is skipped.
 */
export function editorToApi(wf: EditorWorkflow, info: ObjectInfo): EditorToApiResult {
  const warnings: string[] = [];
  const byId = new Map<number, EditorNode>(wf.nodes.map((n) => [n.id, n]));
  const links = new Map<number, EditorLink>();
  for (const l of wf.links ?? []) {
    // Some frontends save links as objects instead of arrays.
    const arr = Array.isArray(l) ? l : Object.values(l as Record<string, unknown>) as EditorLink;
    links.set(arr[0], arr);
  }

  type Resolved = { ref: ApiRef } | { value: unknown } | null;
  const resolve = (linkId: number | null | undefined, seen = new Set<number>()): Resolved => {
    if (linkId == null) return null;
    const l = links.get(linkId);
    if (!l) { warnings.push(`link ${linkId} is missing from the links table`); return null; }
    if (seen.has(linkId)) { warnings.push(`link ${linkId} loops`); return null; }
    seen.add(linkId);
    const origin = byId.get(l[1]);
    if (!origin) { warnings.push(`link ${linkId} comes from missing node ${l[1]}`); return null; }
    const slot = l[2];
    if (origin.type === "Reroute") return resolve(origin.inputs?.[0]?.link, seen);
    if (origin.type === "PrimitiveNode") return { value: origin.widgets_values?.[0] };
    if (origin.mode === MODE_MUTED) return null;
    if (origin.mode === MODE_BYPASS) {
      const outType = origin.outputs?.[slot]?.type;
      const through = origin.inputs?.find((i) => i.link != null && i.type === outType) ?? origin.inputs?.[slot];
      return through ? resolve(through.link, seen) : null;
    }
    return { ref: [String(origin.id), slot] };
  };

  const graph: ApiGraph = {};
  const outputs: Record<string, string> = {};
  const ordered = [...wf.nodes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id - b.id);
  for (const node of ordered) {
    if (VIRTUAL.has(node.type) || node.mode === MODE_MUTED || node.mode === MODE_BYPASS) continue;
    const spec = nodeSpec(info, node.type);
    const inputs: Record<string, unknown> = {};
    const wv = node.widgets_values ?? [];
    let wi = 0;
    const linkOf = (name: string) => node.inputs?.find((i) => i.name === name)?.link;

    if (spec) {
      // Widget values are positional in the FILE's node version. Map them by the names the editor stored on the
      // node's inputs, so a backend whose node has an extra / missing widget (a different custom-node version)
      // still gets every value on the right input; a widget the file does not know takes the spec's default.
      const widgetInputs = (node.inputs ?? []).filter((i) => i.widget);
      const byName = new Map<string, unknown>();
      if (widgetInputs.length) {
        let k = 0;
        for (const i of widgetInputs) {
          byName.set(i.name, wv[k++]);
          if (spec.inputs.find((x) => x.name === i.name)?.widget?.control) k++;   // "fixed" / "randomize" after a seed
        }
      }
      for (const s of spec.inputs) {
        if (s.widget) {
          let raw: unknown;
          if (widgetInputs.length) raw = byName.get(s.name);
          else { raw = wv[wi++]; if (s.widget.control) wi++; }         // old files without widget inputs: positional
          const linked = resolve(linkOf(s.name));
          if (linked && "ref" in linked) inputs[s.name] = linked.ref;
          else if (linked && "value" in linked) inputs[s.name] = coerce(s.type, linked.value);
          else inputs[s.name] = coerce(s.type, raw === undefined ? s.widget.default : raw);
        } else {
          const r = resolve(linkOf(s.name));
          if (r && "ref" in r) inputs[s.name] = r.ref;
          else if (r && "value" in r) inputs[s.name] = r.value;
          else if (!s.optional) warnings.push(`${label(node)}: required input "${s.name}" is not connected`);
        }
      }
    } else {
      warnings.push(`${label(node)}: unknown node class, widget names guessed from the input list`);
      for (const i of node.inputs ?? []) {
        const r = resolve(i.link);
        if (r && "ref" in r) inputs[i.name] = r.ref;
        else if (r && "value" in r) inputs[i.name] = r.value;
        else if (i.widget) inputs[i.name] = wv[wi++];
      }
    }
    // Inputs the editor added that the spec does not list (dynamic inputs, newer node versions).
    for (const i of node.inputs ?? []) {
      if (i.name in inputs || (spec && spec.inputs.some((s) => s.name === i.name))) continue;
      const r = resolve(i.link);
      if (r && "ref" in r) inputs[i.name] = r.ref;
      else if (r && "value" in r) inputs[i.name] = r.value;
    }

    const id = String(node.id);
    const api: ApiNode = { class_type: node.type, inputs };
    if (node.title && node.title !== (spec?.displayName ?? node.type)) api._meta = { title: node.title };
    graph[id] = api;
    if (node.type === "SaveImage") outputs[id] = String(inputs.filename_prefix ?? "ComfyUI");
  }

  // Dangling references (into a node that was dropped as muted) would make /api/prompt reject the graph; say which.
  for (const [id, n] of Object.entries(graph)) {
    for (const [name, v] of Object.entries((n as ApiNode).inputs)) {
      if (isRef(v) && !graph[v[0]]) warnings.push(`node ${id} input ${name} points at node ${v[0]}, which is not in the graph`);
    }
  }
  return { graph, outputs, warnings };
}

const label = (n: EditorNode) => `node ${n.id} (${n.title ?? n.type})`;

// ─── Comfy Cloud workflow store ──────────────────────────────────────────────

export interface CloudWorkflow {
  id: string;
  name: string;
  latest_version: number;
  created_at: string;
  updated_at: string;
}

export interface CloudWorkflowContent {
  workflow: EditorWorkflow | null;
  version: number;
}

// ─── Subgraphs → flat ───────────────────────────────────────────────────────
//
// The editor stores subgraphs under `definitions.subgraphs`; a node whose
// `type` is a subgraph id is an instance. Inside a definition, links from
// node -10 are the instance's inputs and links into -20 are its outputs. An
// instance input that drives a widget inside and has no incoming link carries
// its value in the instance node's `widgets_values` (one entry per input that
// has a `widget`, in input order). The frontend flattens all of this before
// it queues a prompt; `flattenSubgraphs` does the same so `editorToApi` can
// run on a saved workflow with subgraphs (nested ones included).

export interface SubgraphLink { id: number; origin_id: number; origin_slot: number; target_id: number; target_slot: number; type: string }
export interface SubgraphDef {
  id: string; name: string;
  inputs: { id: string; name: string; type: string; linkIds: number[] }[];
  outputs: { id: string; name: string; type: string; linkIds: number[] }[];
  nodes: EditorNode[]; links: SubgraphLink[];
}
export interface EditorWorkflowWithSubgraphs extends EditorWorkflow { definitions?: { subgraphs?: SubgraphDef[] } }

type Src = { node: number; slot: number } | { value: unknown } | null;

/** Set widget `name` on a flat node (positional widgets_values, control_after_generate aware). */
export function setWidgetValue(node: EditorNode, info: ObjectInfo, name: string, value: unknown): boolean {
  const spec = nodeSpec(info, node.type);
  const wv = (node.widgets_values ??= []);
  if (spec) {
    let i = 0;
    for (const s of spec.inputs) {
      if (!s.widget) continue;
      if (s.name === name) { wv[i] = value; return true; }
      i += s.widget.control ? 2 : 1;
    }
    return false;
  }
  const widgets = node.inputs.filter((x) => x.widget);
  const k = widgets.findIndex((x) => x.name === name);
  if (k < 0) return false;
  wv[k] = value; return true;
}

/** Value of instance input `k` from the instance node's widgets_values (undefined when that input is not a widget). */
function instanceWidgetValue(inst: EditorNode, k: number): unknown {
  const widgets = inst.inputs.map((x, i) => ({ x, i })).filter(({ x }) => x.widget);
  const pos = widgets.findIndex(({ i }) => i === k);
  return pos < 0 ? undefined : inst.widgets_values?.[pos];
}

/**
 * Write widget `name` of `node` into widgets_values at the position the FILE's node version uses (the order of the
 * node's widget inputs), not the backend spec's: a backend whose node has an extra widget (another custom-node
 * version) would otherwise shift every later value. Falls back to the spec order for files without widget inputs.
 */
function setWidgetByInputs(node: EditorNode, info: ObjectInfo, name: string, value: unknown): void {
  const widgets = (node.inputs ?? []).filter((i) => i.widget);
  const at = widgets.findIndex((i) => i.name === name);
  if (at < 0) { setWidgetValue(node, info, name, value); return; }
  const spec = nodeSpec(info, node.type);
  let k = 0;
  for (let i = 0; i < at; i++) { k++; if (spec?.inputs.find((s) => s.name === widgets[i].name)?.widget?.control) k++; }   // a seed carries "fixed"/"randomize" after it
  (node.widgets_values ??= [])[k] = value;
}

export function flattenSubgraphs(wf: EditorWorkflowWithSubgraphs, info: ObjectInfo, opts: { dropPreviews?: boolean } = {}): EditorWorkflow {
  const defs = new Map<string, SubgraphDef>((wf.definitions?.subgraphs ?? []).map((d) => [d.id, d]));
  if (!defs.size) return wf;
  const allNodes = [...wf.nodes, ...[...defs.values()].flatMap((d) => d.nodes)];
  let nextId = Math.max(0, ...allNodes.map((n) => n.id)) + 1;
  const outNodes: EditorNode[] = [];
  const outLinks: EditorLink[] = [];
  const asObjects = (links: (EditorLink | SubgraphLink)[]): SubgraphLink[] =>
    links.map((l) => Array.isArray(l) ? { id: l[0], origin_id: l[1], origin_slot: l[2], target_id: l[3], target_slot: l[4], type: l[5] } : l);

  interface Scope {
    nodes: Map<number, EditorNode>;            // original nodes of this scope by original id
    links: SubgraphLink[];
    flat: Map<number, EditorNode>;             // original id → flat copy (real nodes only)
    instances: Map<number, Instance>;          // original id → expanded instance
    external: (slot: number) => Src;           // what -10/slot means here
  }
  interface Instance { outputs: (slot: number) => Src }

  const sourceOf = (scope: Scope, originId: number, slot: number): Src => {
    if (originId === -10) return scope.external(slot);
    const n = scope.nodes.get(originId);
    if (!n) return null;
    if (defs.has(n.type)) return expand(scope, n).outputs(slot);
    const flat = scope.flat.get(originId);
    return flat ? { node: flat.id, slot } : null;
  };

  /** Source feeding input `k` of instance node `inst` living in `scope`. */
  const inputSource = (scope: Scope, inst: EditorNode, k: number): Src => {
    const l = scope.links.find((x) => x.target_id === inst.id && x.target_slot === k);
    if (l) return sourceOf(scope, l.origin_id, l.origin_slot);
    const v = instanceWidgetValue(inst, k);
    return v === undefined ? null : { value: v };
  };

  const expandCache = new Map<EditorNode, Instance>();
  const expand = (outer: Scope, inst: EditorNode): Instance => {
    const hit = expandCache.get(inst);
    if (hit) return hit;
    const def = defs.get(inst.type)!;
    const scope: Scope = { nodes: new Map(def.nodes.map((n) => [n.id, n])), links: asObjects(def.links), flat: new Map(), instances: new Map(), external: (k) => inputSource(outer, inst, k) };
    const outputs = new Map<number, Src>();
    const instance: Instance = { outputs: (slot) => outputs.has(slot) ? outputs.get(slot)! : (() => {
      const l = scope.links.find((x) => x.target_id === -20 && x.target_slot === slot);
      const s = l ? sourceOf(scope, l.origin_id, l.origin_slot) : null;
      outputs.set(slot, s); return s;
    })() };
    expandCache.set(inst, instance);
    materialize(scope, `${inst.title ?? def.name} / `);
    return instance;
  };

  /** Copy the real nodes of a scope into the flat graph and wire their inputs. */
  const materialize = (scope: Scope, titlePrefix: string) => {
    for (const n of scope.nodes.values()) {
      if (defs.has(n.type)) continue;
      const copy: EditorNode = { ...structuredClone(n), id: nextId++, inputs: n.inputs.map((i) => ({ ...i, link: null })), outputs: n.outputs.map((o) => ({ ...o, links: [] })) };
      if (titlePrefix) copy.title = `${titlePrefix}${n.title ?? n.type}`;
      scope.flat.set(n.id, copy); outNodes.push(copy);
    }
    for (const n of scope.nodes.values()) {
      if (defs.has(n.type)) continue;
      const flat = scope.flat.get(n.id)!;
      for (const l of scope.links.filter((x) => x.target_id === n.id)) {
        const src = sourceOf(scope, l.origin_id, l.origin_slot);
        const input = flat.inputs[l.target_slot];
        if (!src || !input) continue;
        if ("value" in src) { setWidgetByInputs(flat, info, input.name, src.value); continue; }
        const id = outLinks.length + 1;
        outLinks.push([id, src.node, src.slot, flat.id, l.target_slot, l.type]);
        input.link = id;
      }
    }
  };

  const root: Scope = { nodes: new Map(wf.nodes.map((n) => [n.id, n])), links: asObjects(wf.links), flat: new Map(), instances: new Map(), external: () => null };
  materialize(root, "");
  for (const n of wf.nodes) if (defs.has(n.type)) expand(root, n);   // instances nobody reads still run (their SaveImage nodes)

  let nodes = outNodes, links = outLinks;
  if (opts.dropPreviews) {
    const drop = new Set(nodes.filter((n) => n.type === "PreviewImage" || n.type === "PreviewAny").map((n) => n.id));
    nodes = nodes.filter((n) => !drop.has(n.id));
    links = links.filter((l) => !drop.has(l[3]) && !drop.has(l[1]));
  }
  return { ...wf, nodes, links, last_node_id: nextId - 1, last_link_id: links.length, definitions: undefined } as EditorWorkflow;
}
