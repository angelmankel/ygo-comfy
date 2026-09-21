/**
 * Model kinds the workflow currently supports. ControlNet (and checkpoint
 * merging) were prototyped in the design phase but aren't in the ComfyUI graph
 * yet — they'll be re-added here when the workflow gains them.
 */
export type ModelKind = 'checkpoint' | 'lora' | 'vae';
