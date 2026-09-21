/**
 * Keeps ComfyUI loaded once it has been opened.
 *
 * The comfy view used to be an ordinary branch of MainView, so leaving it unmounted the iframe and
 * coming back rebuilt ComfyUI from nothing — 14.7 MB over 119 requests, every single time, because
 * ComfyUI serves its bundle with `Cache-Control: no-store`. nginx now lets the hashed bundle be
 * cached, which fixes a reload; this fixes the switch, by never tearing the frame down at all.
 *
 * It lives outside MainView's `animate-view-in` wrapper, which is keyed by view and therefore
 * remounts its whole subtree on every switch. Hidden with `display: none`, which keeps the
 * document, its websocket and the graph the person had open — an iframe is not reloaded by being
 * hidden. One frame is kept per server actually visited, so a two-server setup does not pay for
 * the one it never looks at.
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { useCanvasStore } from '@/lib/canvasStore';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useFocusMode } from '@/features/studio/StudioView';
import { ComfyView } from './ComfyView';

export function ComfyLayer() {
  const mainView = useCanvasStore(s => s.mainView);
  const activeId = useCanvasStore(s => s.comfyServerId);
  const servers = useStore(s => s.servers);
  const isDesktop = useIsDesktop();
  const focusMode = useFocusMode();

  /** Servers whose ComfyUI has been mounted. Once in, a server stays warm for the session. */
  const [mounted, setMounted] = useState<string[]>([]);
  const preloaded = useRef(false);

  // Mount the active server the first time it is opened.
  useEffect(() => {
    if (mainView !== 'comfy' || !activeId) return;
    setMounted(m => (m.includes(activeId) ? m : [...m, activeId]));
  }, [mainView, activeId]);

  /**
   * Warm the first server in the background, so even the first visit is instant.
   *
   * Only where ComfyUI is actually reachable from the UI: focus mode hides it, and on a phone it
   * is always hidden, so downloading its frontend there would spend someone's data on a view they
   * cannot open. Deferred until the app is idle so it never competes with the first render.
   */
  useEffect(() => {
    if (preloaded.current || focusMode || !isDesktop) return;
    const first = servers.find(s => s.enabled !== false);
    if (!first) return;
    preloaded.current = true;
    // requestIdleCallback where it exists (not in Safari), a plain timer otherwise.
    type IdleWindow = Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const w = window as IdleWindow;
    const warm = () => setMounted(m => (m.includes(first.id) ? m : [...m, first.id]));
    const id = w.requestIdleCallback ? w.requestIdleCallback(warm, { timeout: 8000 }) : window.setTimeout(warm, 4000);
    return () => { if (w.cancelIdleCallback) w.cancelIdleCallback(id); else clearTimeout(id); };
  }, [servers, focusMode, isDesktop]);

  // Drop a frame whose server has been removed or disabled, so it stops holding a socket open.
  useEffect(() => {
    setMounted(m => m.filter(id => servers.some(s => s.id === id && s.enabled !== false)));
  }, [servers]);

  if (!mounted.length) return null;

  return (
    <>
      {mounted.map(id => {
        const visible = mainView === 'comfy' && activeId === id;
        return (
          <div
            key={id}
            // `display: none` rather than unmounting: the iframe's document, its websocket and the
            // graph in progress all survive. `inert` stops a hidden frame taking focus or taps.
            style={{ display: visible ? 'block' : 'none' }}
            {...(!visible ? { inert: '' as unknown as boolean } : {})}
            aria-hidden={!visible}
            className="absolute inset-0 z-[5]"
          >
            <ComfyView serverId={id} />
          </div>
        );
      })}
    </>
  );
}
