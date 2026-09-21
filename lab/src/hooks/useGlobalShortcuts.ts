import { useStore } from '@/lib/store';
import { useCanvasStore } from '@/lib/canvasStore';
import { navigateLayerHistory } from '@/lib/layerHistory';
import { ROUND_ROBIN } from '@/lib/storage';
import { CANVAS_TOOLS } from '@/lib/canvasTools';
import { useShortcut, ShortcutPriority } from './useShortcut';

/**
 * App-wide keyboard shortcuts: Space toggles the fullscreen viewer, F toggles
 * browser fullscreen, Tab cycles the job-routing target (All / each server).
 * All bail while typing in a field; Space also yields to focused buttons/links
 * so it can still activate them.
 */
export function useGlobalShortcuts() {
  const toggleViewer = useStore(s => s.toggleViewer);
  const setRouting = useStore(s => s.setRouting);
  const servers = useStore(s => s.servers);
  const routing = useStore(s => s.routing);

  useShortcut('Space', (e) => {
    // Yield to focused buttons / links — Space activates them and we don't
    // want to fight that. Inputs are already filtered by skipTyping.
    const ae = document.activeElement as HTMLElement | null;
    if (ae && (ae.tagName === 'BUTTON' || ae.tagName === 'A' || ae.getAttribute('role') === 'button')) return;
    e.preventDefault();
    toggleViewer();
  }, { priority: ShortcutPriority.Global });

  useShortcut(['f', 'F'], (e) => {
    e.preventDefault();
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.();
  }, { priority: ShortcutPriority.Global });

  useShortcut('Tab', (e) => {
    const options = [ROUND_ROBIN, ...servers.map(s => s.id)];
    if (options.length < 2) return;
    e.preventDefault();
    const cur = options.indexOf(routing);
    setRouting(options[(cur + 1) % options.length]);
  }, { priority: ShortcutPriority.Global });

  // Canvas grid step adjustment — Unreal Engine 5 convention. Increments in
  // 64-unit steps to match SDXL native multiples. The store's adjustGridStep
  // clamps to [64, 1024].
  useShortcut('[', (e) => {
    e.preventDefault();
    useCanvasStore.getState().adjustGridStep(-64);
  }, { priority: ShortcutPriority.Global });
  useShortcut(']', (e) => {
    e.preventDefault();
    useCanvasStore.getState().adjustGridStep(64);
  }, { priority: ShortcutPriority.Global });

  // Photoshop-style tool hotkeys for the infinite canvas (#42). Each tool
  // declares its own single-letter shortcut (V = Move). Only active in
  // infinite mode — the tools concept doesn't exist in stripped mode.
  for (const tool of CANVAS_TOOLS) {
    const k = tool.shortcutKey;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useShortcut([k, k.toUpperCase()], (e) => {
      const cs = useCanvasStore.getState();
      if (cs.mainView !== 'canvas') return;
      e.preventDefault();
      cs.setActiveTool(tool.id);
    }, { priority: ShortcutPriority.Global });
  }

  // Per-layer history navigation. Fires only in infinite canvas mode with an
  // active layer — priority above HistoryPanel (Panel = 30) so the layer
  // takes precedence when applicable, but falls through to the History
  // panel's global history nav otherwise. Stripped mode shows the GLOBAL
  // selected entry, so arrow keys there must update the global selection
  // (HistoryPanel's binding), not silently shuffle some background layer.
  const layerActive = () =>
    useCanvasStore.getState().mainView === 'canvas'
    && useCanvasStore.getState().activeLayerId !== null;
  // Direction map: ← = older (forward in the newest-first list, +1 index);
  // → = newer (backward, -1 index). Matches the intuitive "rewind / advance"
  // semantics the user expects, not the raw index direction.
  useShortcut('ArrowLeft', (e) => {
    void navigateLayerHistory(1).then(consumed => {
      if (consumed) e.preventDefault();
    });
    // Synchronous return value: assume we'll consume so the History panel's
    // ArrowLeft binding doesn't double-fire. If navigateLayerHistory falls
    // through (no history), the user can click the History panel to navigate
    // — losing the auto-fallthrough is the trade-off for not awaiting IDB.
    return layerActive();
  }, { priority: ShortcutPriority.Panel + 5, when: layerActive });
  useShortcut('ArrowRight', (e) => {
    void navigateLayerHistory(-1).then(consumed => {
      if (consumed) e.preventDefault();
    });
    return layerActive();
  }, { priority: ShortcutPriority.Panel + 5, when: layerActive });
}
