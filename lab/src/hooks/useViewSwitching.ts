import { useEffect, useState } from 'react';
import { useCanvasStore } from '@/lib/canvasStore';

/**
 * Drives the brief loading veil + animate-view-in keyed wrapper around the
 * main view. Re-keys when the user swaps ComfyUI servers without leaving the
 * comfy view so the iframe remounts.
 */
export function useViewSwitching() {
  const mainView = useCanvasStore(s => s.mainView);
  const comfyServerId = useCanvasStore(s => s.comfyServerId);
  const viewKey = mainView === 'comfy' ? `comfy:${comfyServerId ?? 'none'}` : mainView;

  const [isSwitching, setIsSwitching] = useState(false);
  useEffect(() => {
    setIsSwitching(true);
    const t = setTimeout(() => setIsSwitching(false), 260);
    return () => clearTimeout(t);
  }, [viewKey]);

  return { mainView, viewKey, isSwitching };
}
