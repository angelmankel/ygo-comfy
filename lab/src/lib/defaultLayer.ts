/**
 * Fresh-layer construction for the canvas-layer system (epic #18).
 *
 * Pure helper — no IDB, no Zustand. The store's `addCanvasLayer` action is
 * the single caller that wraps this with persistence + state updates.
 *
 * The dev-only `__exerciseCanvasLayers` smoke test lives in a separate file
 * (`canvasLayersExercise.ts`) so this module can stay free of any `store`
 * import — which would create a `store -> defaultLayer -> store` cycle.
 */
import type { CanvasLayer, CanvasLayerType } from './types';
import { defaultLayers, defaultWorkflow, uid } from './storage';

export type MakeDefaultLayerInput = {
  /**
   * @deprecated Layer types collapsed in #38. New layers always get
   * `'from-canvas'` as a no-op-on-read placeholder.
   */
  type?: CanvasLayerType;
  bounds?: Partial<{ x: number; y: number; w: number; h: number }>;
  name?: string;
  /** Count of existing canvas layers — used for the default `"Layer N"` name. */
  layerCount: number;
  /** zIndex to assign — picked by the caller from the current max + 1. */
  zIndex: number;
};

export function makeDefaultLayer(input: MakeDefaultLayerInput): CanvasLayer {
  const bx = input.bounds ?? {};
  return {
    id: uid(),
    type: input.type ?? 'from-canvas',
    name: input.name?.trim() || `Layer ${input.layerCount + 1}`,
    bounds: {
      x: bx.x ?? 0,
      y: bx.y ?? 0,
      w: bx.w ?? 1024,
      h: bx.h ?? 1024,
    },
    zIndex: input.zIndex,
    visible: true,
    locked: false,
    workflow: defaultWorkflow(),
    layers: defaultLayers(),
    background: { kind: 'transparent' },
    createdAt: Date.now(),
  };
}
