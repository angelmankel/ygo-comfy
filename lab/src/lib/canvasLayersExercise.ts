/**
 * Dev-only manual smoke test for the canvas-layer store slice (#22).
 *
 * Walks the slice through its paces against a real IDB. Invoked from the
 * devtools console:
 *
 *     window.__exerciseCanvasLayers()
 *
 * Mirrors the existing `__exerciseCanvasStorage` from #21. Logs PASS / FAIL
 * with detail. Idempotent: cleans up after itself + restores prior in-memory
 * state, so it can be re-run repeatedly without leaking layers.
 */
import { useCanvasStore } from './canvasStore';
import { canvasStorage } from './canvasStorageInstance';

export async function exerciseCanvasLayers(): Promise<boolean> {
  const tag = '[exerciseCanvasLayers]';
  const fails: string[] = [];
  // Snapshot existing in-memory state so we can restore on completion.
  const before = {
    canvasLayers: useCanvasStore.getState().canvasLayers,
    activeLayerId: useCanvasStore.getState().activeLayerId,
  };

  try {
    // Start from a clean slate for the duration of the test.
    useCanvasStore.setState({ canvasLayers: [], activeLayerId: null, canvasLayersHydrated: true });

    const id1 = useCanvasStore.getState().addCanvasLayer({ type: 'empty', name: 'first' });
    const id2 = useCanvasStore.getState().addCanvasLayer({ type: 'empty', name: 'second' });
    const id3 = useCanvasStore.getState().addCanvasLayer({ type: 'empty', name: 'third' });

    let layers = useCanvasStore.getState().canvasLayers;
    if (layers.length !== 3) fails.push(`expected 3 layers after addCanvasLayer x3, got ${layers.length}`);
    if (useCanvasStore.getState().activeLayerId !== id3) fails.push(`activeLayerId should be the most recent (id3), got ${useCanvasStore.getState().activeLayerId}`);

    if (!(layers[0].zIndex < layers[1].zIndex && layers[1].zIndex < layers[2].zIndex)) {
      fails.push(`zIndex not ascending: ${layers.map(l => l.zIndex).join(',')}`);
    }

    // Reorder: move first to last.
    useCanvasStore.getState().reorderCanvasLayers(0, 2);
    layers = useCanvasStore.getState().canvasLayers;
    if (layers[2].id !== id1) fails.push(`after reorder(0,2), expected ${id1} at end, got ${layers[2].id}`);
    if (!(layers[0].zIndex < layers[1].zIndex && layers[1].zIndex < layers[2].zIndex)) {
      fails.push(`zIndex not rewritten ascending after reorder: ${layers.map(l => l.zIndex).join(',')}`);
    }

    // Rename id2.
    useCanvasStore.getState().updateCanvasLayer(id2, { name: 'renamed-middle' });
    layers = useCanvasStore.getState().canvasLayers;
    const renamed = layers.find(l => l.id === id2);
    if (renamed?.name !== 'renamed-middle') fails.push(`updateCanvasLayer rename failed: name=${renamed?.name}`);

    // Remove the middle layer (id2).
    useCanvasStore.getState().removeCanvasLayer(id2);
    layers = useCanvasStore.getState().canvasLayers;
    if (layers.length !== 2) fails.push(`expected 2 layers after remove, got ${layers.length}`);
    if (layers.some(l => l.id === id2)) fails.push('removed layer still present');

    // Give the fire-and-forget IDB writes a beat to land before we re-read.
    // (saveLayer is async; the store mutation returned synchronously.)
    await new Promise(r => setTimeout(r, 50));

    // Now re-hydrate from IDB and confirm we see the same two layers.
    await useCanvasStore.getState().initCanvasLayers();
    const hydrated = useCanvasStore.getState().canvasLayers;
    if (hydrated.length !== 2) fails.push(`hydration: expected 2 layers, got ${hydrated.length}`);
    const hydratedIds = new Set(hydrated.map(l => l.id));
    if (!(hydratedIds.has(id1) && hydratedIds.has(id3))) {
      fails.push(`hydration: missing expected ids; got ${[...hydratedIds].join(',')}`);
    }
    if (hydrated.length === 2 && hydrated[0].zIndex >= hydrated[1].zIndex) {
      fails.push(`hydration: zIndex not ascending: ${hydrated.map(l => l.zIndex).join(',')}`);
    }

    // Cleanup: drop the two survivors so the IDB doesn't leak across runs.
    await canvasStorage.deleteLayer(id1);
    await canvasStorage.deleteLayer(id3);
  } catch (err) {
    fails.push(`threw: ${String(err)}`);
  } finally {
    // Restore the user's pre-test layer state in memory.
    useCanvasStore.setState({
      canvasLayers: before.canvasLayers,
      activeLayerId: before.activeLayerId,
      canvasLayersHydrated: true,
    });
  }

  if (fails.length) {
    // eslint-disable-next-line no-console
    console.error(`${tag} FAIL`, fails);
    return false;
  }
  // eslint-disable-next-line no-console
  console.log(`${tag} PASS`);
  return true;
}

if (typeof window !== 'undefined') {
  (window as unknown as { __exerciseCanvasLayers?: typeof exerciseCanvasLayers }).__exerciseCanvasLayers =
    exerciseCanvasLayers;
}
