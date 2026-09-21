import { useEffect, useRef, useState, type ComponentType } from 'react';
import { useCanvasStore } from '@/lib/canvasStore';
import { CANVAS_TOOLS, type CanvasToolId } from '@/lib/canvasTools';
import {
  MoveToolIcon, BrushIcon, EraserIcon, EyedropperIcon, FitViewIcon, type IconProps,
} from '@/components/ui/icons';
import { BrushSettingsPanel } from './BrushSettingsPopover';
import { cn } from '@/lib/cn';

/**
 * Color-swatch button — circular, shows current brush color. Click opens
 * the browser's native color picker directly (via a hidden <input
 * type="color"> we click() programmatically). No intermediate popover, no
 * extra clicks.
 */
function ColorSwatch({ color, onChange }: { color: string; onChange: (c: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        title={`Brush color (${color})`}
        aria-label="Brush color"
        className="pointer-events-auto h-9 w-9 rounded-full border-2 border-border-strong shadow-lg transition-colors hover:border-fg-secondary"
        style={{ backgroundColor: color }}
      />
      <input
        ref={inputRef}
        type="color"
        value={color}
        onInput={(e) => onChange((e.target as HTMLInputElement).value)}
        onChange={(e) => onChange((e.target as HTMLInputElement).value)}
        // Visually hidden but kept in flow so click() works in every
        // browser (some require a non-display:none input).
        className="pointer-events-none absolute left-0 top-0 h-9 w-9 cursor-pointer opacity-0"
        aria-hidden
      />
    </div>
  );
}

const TOOL_ICONS: Record<CanvasToolId, ComponentType<IconProps>> = {
  move: MoveToolIcon,
  brush: BrushIcon,
  erase: EraserIcon,
  eyedropper: EyedropperIcon,
  // Reuse FitView (frame-corners glyph) — visually matches a marquee rect.
  select: FitViewIcon,
};

/** Tools whose icon button can toggle a settings popover when re-clicked. */
const HAS_SETTINGS: ReadonlySet<CanvasToolId> = new Set(['brush', 'erase']);

/**
 * Floating tool palette for the infinite canvas. Reads its button list
 * from `CANVAS_TOOLS`. The first slot is the brush-color swatch — a
 * circular button that opens a color-picker popover, separate from the
 * tool-specific settings panel.
 */
export function CanvasToolbar() {
  const mainView = useCanvasStore(s => s.mainView);
  const activeTool = useCanvasStore(s => s.activeTool);
  const setActiveTool = useCanvasStore(s => s.setActiveTool);
  const brushColor = useCanvasStore(s => s.brush.color);
  const setBrush = useCanvasStore(s => s.setBrush);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const prevToolRef = useRef(activeTool);
  useEffect(() => {
    if (prevToolRef.current !== activeTool) {
      prevToolRef.current = activeTool;
      setSettingsOpen(false);
    }
  }, [activeTool]);

  if (mainView !== 'canvas') return null;

  const handleToolClick = (id: CanvasToolId) => {
    if (id !== activeTool) {
      setActiveTool(id);
      setSettingsOpen(false);
      return;
    }
    if (HAS_SETTINGS.has(id)) setSettingsOpen(o => !o);
  };

  return (
    <div className="relative flex flex-col gap-1">
      {settingsOpen && <BrushSettingsPanel />}

      <ColorSwatch color={brushColor} onChange={(c) => setBrush({ color: c })} />
      {/* Thin separator between color and tools */}
      <div className="my-0.5 h-px self-stretch bg-border-subtle/50" />

      {CANVAS_TOOLS.map(tool => {
        const active = tool.id === activeTool;
        const Icon = TOOL_ICONS[tool.id];
        return (
          <button
            key={tool.id}
            type="button"
            onClick={() => handleToolClick(tool.id)}
            title={`${tool.label} (${tool.shortcutKey.toUpperCase()})`}
            aria-label={tool.label}
            aria-pressed={active}
            className={cn(
              'pointer-events-auto flex h-9 w-9 items-center justify-center rounded-lg border backdrop-blur-md shadow-lg transition-colors',
              active
                ? 'border-accent bg-accent text-white'
                : 'border-border-default bg-bg-elev/85 text-fg-tertiary hover:border-border-strong hover:text-fg-secondary',
            )}
          >
            <Icon size={16} />
          </button>
        );
      })}
    </div>
  );
}

