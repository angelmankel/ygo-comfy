import type { Layer, LayerKind } from './types';

/**
 * Flatten enabled layers of one kind into a comma-joined prompt string.
 * Non-1.0 weights wrap their fragment in `(text:weight)` syntax.
 */
export function compileLayers(layers: Layer[], kind: LayerKind): string {
  return layers
    .filter(l => l.kind === kind && l.on && l.text.trim())
    .map(l => {
      const t = l.text.trim();
      return Math.abs(l.weight - 1.0) < 0.001 ? t : `(${t}:${l.weight.toFixed(2)})`;
    })
    .join(', ');
}
