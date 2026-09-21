/**
 * Singleton entry point for canvas persistence. Future store code should
 * import `canvasStorage` from here, never `idbCanvasStorage` directly —
 * keeping the impl swappable (e.g. a future `RemoteCanvasStorage` for
 * cross-device sync, or a stub in tests).
 */
import { createIDBCanvasStorage } from './idbCanvasStorage';
import type { CanvasStorage } from './canvasStorage';

export const canvasStorage: CanvasStorage = createIDBCanvasStorage();
