import type { ServerInfo, WorkflowState } from './types';

/**
 * Resource-availability helpers. Each ComfyUI server reports its own set of
 * checkpoints / VAEs / LoRAs / etc. via `ServerInfo`; since the workflow is now
 * global, we need to know which server can actually run it.
 */

export type ResourceKind =
  | 'checkpoint' | 'vae' | 'lora' | 'upscale' | 'tag' | 'sampler' | 'scheduler';

/** Which `ServerInfo` list backs each resource kind. */
export const RESOURCE_LIST: Record<ResourceKind, keyof ServerInfo> = {
  checkpoint: 'models',
  vae: 'vaes',
  lora: 'loras',
  upscale: 'upscaleModels',
  tag: 'tagModels',
  sampler: 'samplers',
  scheduler: 'schedulers',
};

/** True if `info` has `name` available for `kind`. */
export function serverHasResource(
  info: ServerInfo | undefined,
  kind: ResourceKind,
  name: string,
): boolean {
  if (!info) return false;
  const list = info[RESOURCE_LIST[kind]];
  return Array.isArray(list) && list.includes(name);
}

/** Model-file resource kinds — the ones a CivitAI model could be. */
const MODEL_KINDS: ResourceKind[] = ['checkpoint', 'vae', 'lora'];

/**
 * Ids of every server whose model lists contain `name`. Matches across
 * checkpoint / VAE / LoRA lists, so the caller doesn't need to know the kind.
 */
export function serversWithModel(
  serverInfo: Record<string, ServerInfo>,
  name: string,
): string[] {
  if (!name) return [];
  return Object.keys(serverInfo).filter((id) =>
    MODEL_KINDS.some((kind) => serverHasResource(serverInfo[id], kind, name)),
  );
}

/**
 * Every resource the workflow needs that `info` doesn't have, as human labels.
 * An empty array means the workflow can run on that server.
 */
export function missingResources(workflow: WorkflowState, info: ServerInfo | undefined): string[] {
  if (!info) return ['server is offline'];
  const missing: string[] = [];
  const need = (kind: ResourceKind, name: string, label: string) => {
    if (name && !serverHasResource(info, kind, name)) missing.push(label);
  };
  for (const c of workflow.checkpoints) need('checkpoint', c.name, `checkpoint “${c.name}”`);
  need('vae', workflow.vae, `VAE “${workflow.vae}”`);
  for (const l of workflow.loras) {
    if (l.on) need('lora', l.name, `LoRA “${l.name}”`);
  }
  if (workflow.upscaleEnabled) need('upscale', workflow.upscaleModel, `upscale model “${workflow.upscaleModel}”`);
  need('sampler', workflow.sampler, `sampler “${workflow.sampler}”`);
  need('scheduler', workflow.scheduler, `scheduler “${workflow.scheduler}”`);
  // Each extra pass may pick its own sampler/scheduler — validate too.
  workflow.passes.forEach((p, i) => {
    if (p.sampler) need('sampler', p.sampler, `Pass ${i + 2} sampler “${p.sampler}”`);
    if (p.scheduler) need('scheduler', p.scheduler, `Pass ${i + 2} scheduler “${p.scheduler}”`);
  });
  return missing;
}
