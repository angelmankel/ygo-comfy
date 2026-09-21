import { createContext, useContext } from 'react';
import type { CanvasController } from './canvasController';

export type CanvasContextValue = {
  controller: CanvasController | null;
  setController: (c: CanvasController | null) => void;
};

export const CanvasContext = createContext<CanvasContextValue>({
  controller: null,
  setController: () => { /* noop */ },
});

export function useCanvas() {
  return useContext(CanvasContext);
}

/**
 * Module-level slot for non-React consumers (store actions, WS handlers) that
 * need to paint without taking on a React dependency. `<InfiniteCanvas>` and
 * App register the live controller here whenever it changes.
 */
let _registered: CanvasController | null = null;
export function registerCanvasController(c: CanvasController | null) { _registered = c; }
export function getCanvasController(): CanvasController | null { return _registered; }
