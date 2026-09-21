/**
 * Every knob on a loaded ComfyUI workflow, as a flat list.
 *
 * A workflow the person built in ComfyUI is a graph of nodes; each node class declares its inputs
 * in `/object_info`, and the ones that are widgets (INT, FLOAT, STRING, BOOLEAN, COMBO) are the
 * things a human actually turns. Pairing the saved graph with object_info gives the full set
 * without anyone writing it down — which is the whole point: change the workflow in ComfyUI and
 * the controls here change with it.
 *
 * Values live in the editor node's `widgets_values` array. That array is positional and counts
 * only widget inputs, in declaration order, so the index has to be computed from the spec rather
 * than guessed — and a widget that has been promoted to a socket (`input.widget` present with a
 * link) is no longer a knob at all, it is driven by another node.
 */
import {
  nodeSpec, setWidgetValue, flattenSubgraphs, editorToApi,
  type EditorNode, type EditorWorkflowWithSubgraphs, type ObjectInfo,
} from '@/lib/workflowGraph';

/** Node types that exist for the editor's benefit and never carry a real parameter. */
const NON_PARAM_NODES = new Set(['Note', 'MarkdownNote', 'Reroute', 'PrimitiveNode']);
const MODE_MUTED = 2, MODE_BYPASS = 4;

export type ParamType = 'INT' | 'FLOAT' | 'STRING' | 'BOOLEAN' | 'COMBO';

export interface WorkflowParam {
  /** Stable across reloads of the same workflow: this is the exposure key. */
  id: string;
  nodeId: number;
  /** The node's own title if it was renamed in ComfyUI, else the class's display name. */
  nodeLabel: string;
  nodeType: string;
  /** The input name, e.g. `steps`, `cfg`, `text`. */
  name: string;
  type: ParamType;
  value: unknown;
  default: unknown;
  options?: unknown[];
  multiline: boolean;
  min?: number;
  max?: number;
  step?: number;
  /** A seed-like widget: ComfyUI pairs it with a control_after_generate dropdown. */
  seedLike: boolean;
}

/** Raw min/max/step, which `nodeSpec` does not carry but a slider needs. */
function rangeOf(info: ObjectInfo, nodeType: string, name: string) {
  const def = info[nodeType];
  const spec = def?.input?.required?.[name] ?? def?.input?.optional?.[name];
  const o = Array.isArray(spec) ? (spec[1] as Record<string, unknown> | undefined) : undefined;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  return { min: num(o?.min), max: num(o?.max), step: num(o?.step) };
}

/**
 * Walk a workflow and return every widget on it.
 *
 * Muted and bypassed nodes are skipped: they contribute nothing to the run, so offering their
 * knobs would be offering controls that do nothing.
 */
export function readParams(wf: EditorWorkflowWithSubgraphs, info: ObjectInfo): WorkflowParam[] {
  const out: WorkflowParam[] = [];
  for (const node of wf.nodes ?? []) {
    if (NON_PARAM_NODES.has(node.type)) continue;
    if (node.mode === MODE_MUTED || node.mode === MODE_BYPASS) continue;
    const spec = nodeSpec(info, node.type);
    if (!spec) continue;                       // a custom node this server does not have installed

    const nodeLabel = node.title?.trim() || spec.displayName || node.type;
    // `widgets_values` indexes widget inputs only, in spec order — but a widget with
    // control_after_generate occupies TWO slots: its value, then the control mode ("randomize",
    // "increment", …). Reading one slot per input walks off by one from the first seed onward,
    // which showed up as steps reading "randomize" and cfg reading the step count. This is the
    // same advance `setWidgetValue` uses to write, and reader and writer must agree or a slider
    // silently edits the wrong field.
    let widgetIndex = 0;
    for (const input of spec.inputs) {
      if (!input.widget) continue;
      const slot = widgetIndex;
      widgetIndex += input.widget.control ? 2 : 1;
      // Promoted to a socket and wired: another node decides this, so it is not a knob.
      const asSocket = node.inputs?.find(i => i.name === input.name);
      if (asSocket && asSocket.link != null) continue;

      const raw = Array.isArray(node.widgets_values)
        ? (node.widgets_values as unknown[])[slot]
        : (node.widgets_values as Record<string, unknown> | undefined)?.[input.name];
      const { min, max, step } = rangeOf(info, node.type, input.name);
      out.push({
        id: `${node.id}:${input.name}`,
        nodeId: node.id,
        nodeLabel,
        nodeType: node.type,
        name: input.name,
        type: input.type as ParamType,
        value: raw ?? input.widget.default,
        default: input.widget.default,
        options: input.widget.options,
        multiline: input.widget.multiline,
        min, max, step,
        seedLike: input.widget.control,
      });
    }
  }
  return out;
}

/** Human label for a param, used everywhere it is shown. */
export const paramLabel = (p: WorkflowParam) => p.name.replace(/_/g, ' ');

/**
 * Write the current values back into the workflow and convert it to an API graph.
 *
 * `setWidgetValue` is used rather than poking `widgets_values` directly because it knows the same
 * index rules and coerces to the declared type — a slider handing "20" to an INT would otherwise
 * reach ComfyUI as a string.
 */
export function buildApiGraph(
  wf: EditorWorkflowWithSubgraphs,
  info: ObjectInfo,
  values: Record<string, unknown>,
): { graph: Record<string, unknown>; warnings: string[] } {
  // Deep copy: the loaded workflow is shared state and must survive being submitted.
  const copy: EditorWorkflowWithSubgraphs = JSON.parse(JSON.stringify(wf));
  const byId = new Map<number, EditorNode>((copy.nodes ?? []).map(n => [n.id, n]));
  const warnings: string[] = [];

  for (const [id, value] of Object.entries(values)) {
    const sep = id.indexOf(':');
    const node = byId.get(Number(id.slice(0, sep)));
    const name = id.slice(sep + 1);
    if (!node) { warnings.push(`${id}: node is no longer in the workflow`); continue; }
    if (!setWidgetValue(node, info, name, value)) warnings.push(`${id}: could not be set`);
  }

  // A workflow built with subgraphs has to be flattened before it means anything to /prompt.
  const flat = flattenSubgraphs(copy, info, { dropPreviews: true });
  const { graph, warnings: convWarnings } = editorToApi(flat, info);
  return { graph: graph as Record<string, unknown>, warnings: [...warnings, ...convWarnings] };
}

/** A fresh seed for every run, matching what ComfyUI's own "randomize" does. */
export const randomSeed = () => Math.floor(Math.random() * 1_000_000_000_000_000);
