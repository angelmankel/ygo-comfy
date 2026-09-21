import { useCallback, useMemo, useRef, useState } from 'react';
import { registerCanvasController } from '@/lib/canvasContext';
import type { CanvasController } from '@/lib/canvasController';

/**
 * App owns the canvas controller because it provides the context. Returns a
 * memoised context value plus a ref kept in lockstep with the controller for
 * non-React consumers (and the global `registerCanvasController` slot).
 */
export function useCanvasControllerProvider() {
  const [controller, setControllerState] = useState<CanvasController | null>(null);
  const controllerRef = useRef<CanvasController | null>(null);
  const setController = useCallback((c: CanvasController | null) => {
    controllerRef.current = c;
    registerCanvasController(c);
    setControllerState(c);
  }, []);
  const value = useMemo(() => ({ controller, setController }), [controller, setController]);
  return { value, controllerRef };
}
