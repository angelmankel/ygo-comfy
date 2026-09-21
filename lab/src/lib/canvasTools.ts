/**
 * Infinite-canvas tool registry.
 *
 * Tools are plain data — id, label, icon, shortcut letter, cursor.
 * Adding a new tool means appending an entry to `CANVAS_TOOLS`; no edits
 * to canvasController or any UI layer required. Each tool can declare
 * optional pointer handlers (`onPointerDown` / `onPointerMove` /
 * `onPointerUp`) that the controller's dispatch layer prefers over its
 * defaults; for now only Move ships, and Move's "handler" is implicit
 * (the controller's existing pan/drag/resize behavior runs when no
 * tool-specific handler is registered).
 */
// Note: deliberately no import from '@/components/ui/icons' here — that
// module imports useStore (for icon-weight theming), which imports
// canvasStore, which imports this file. The resulting cycle would leave
// the icon component undefined at module-init time. Icons live in the
// toolbar UI's own id → component map instead (see CanvasToolbar.tsx).

export type CanvasToolId = 'move' | 'brush' | 'erase' | 'eyedropper' | 'select';

/**
 * Pointer-handler signature for tool-specific behavior. The controller
 * passes its own view + clientToWorld + world coords so tools don't have
 * to know about Pixi internals. Returning `'default'` (or omitting the
 * handler) tells the dispatcher to fall back to the built-in behavior.
 */
export type CanvasToolPointerCtx = {
  /** Native event — for button checks, modifier keys, etc. */
  event: PointerEvent;
  /** World coords of the pointer (post zoom/pan). */
  worldX: number;
  worldY: number;
};

export type CanvasTool = {
  id: CanvasToolId;
  label: string;
  /** Single-letter Photoshop-style hotkey (lowercase). */
  shortcutKey: string;
  /** CSS cursor name (e.g. 'grab', 'crosshair') for when this tool is active. */
  cursor: string;
  /** Optional tool-specific pointer handlers. When absent, the controller's
   *  default Move-style behavior runs. */
  onPointerDown?: (ctx: CanvasToolPointerCtx) => 'default' | 'handled';
  onPointerMove?: (ctx: CanvasToolPointerCtx) => 'default' | 'handled';
  onPointerUp?:   (ctx: CanvasToolPointerCtx) => 'default' | 'handled';
};

export const CANVAS_TOOLS: readonly CanvasTool[] = [
  {
    id: 'move',
    label: 'Move',
    shortcutKey: 'v',
    // Default cursor — the controller already switches to 'grab' during a
    // real pan via its own logic, so leaving 'default' here avoids fighting
    // it. Specialized tools (e.g. eyedropper) will pick their own.
    cursor: 'default',
  },
  {
    id: 'brush',
    label: 'Brush',
    shortcutKey: 'b',
    cursor: 'crosshair',
  },
  {
    id: 'erase',
    label: 'Erase',
    shortcutKey: 'e',
    cursor: 'crosshair',
  },
  {
    id: 'eyedropper',
    label: 'Eyedropper',
    shortcutKey: 'i',
    cursor: 'crosshair',
  },
  {
    id: 'select',
    label: 'Select',
    shortcutKey: 'm',
    cursor: 'crosshair',
  },
];

export const DEFAULT_CANVAS_TOOL: CanvasToolId = 'move';

export function findTool(id: CanvasToolId): CanvasTool | undefined {
  return CANVAS_TOOLS.find(t => t.id === id);
}

export function findToolByShortcut(key: string): CanvasTool | undefined {
  const k = key.toLowerCase();
  return CANVAS_TOOLS.find(t => t.shortcutKey === k);
}
