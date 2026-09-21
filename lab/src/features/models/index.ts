/**
 * The model component kit.
 *
 *   types.ts / kindMeta.ts  — model kinds + per-kind display metadata
 *   primitives/             — generic compound parts (ModelCard, ModelGroup, …)
 *   kinds/                  — concrete per-kind components (workflow-backed)
 *   ModelPicker.tsx         — searchable add/change popover
 *   ModelStack.tsx          — the composed Models section for the Parameters panel
 */
export * from './types';
export * from './kindMeta';
export * from './primitives';
export * from './kinds';
export { ModelPicker } from './ModelPicker';
export { ModelStack } from './ModelStack';
