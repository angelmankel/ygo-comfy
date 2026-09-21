import { useCanvasStore } from '@/lib/canvasStore';
import { Field } from '@/components/ui/Field';
import { Slider } from '@/components/ui/Slider';

/**
 * Brush + erase settings panel. Sits next to the canvas toolbar whenever
 * Brush or Erase is the active tool. Rendered by CanvasToolbar so its
 * absolute positioning follows the toolbar's wrapper. Plain positioned
 * panel (not a Radix Popover) — we want it always-visible while the tool
 * is selected, no open/close state to manage.
 */
export function BrushSettingsPanel() {
  const activeTool = useCanvasStore(s => s.activeTool);
  const brush = useCanvasStore(s => s.brush);
  const setBrush = useCanvasStore(s => s.setBrush);

  if (activeTool !== 'brush' && activeTool !== 'erase') return null;
  const isErase = activeTool === 'erase';

  return (
    <div
      data-brush-cursor-surface="panel"
      // Anchored to the toolbar wrapper in CanvasToolbar (`relative`). 44px
      // = toolbar button width + gap, so the panel hugs the right edge.
      className="pointer-events-auto absolute left-[44px] top-0 w-[260px] rounded-xl border border-border-default bg-bg-elev/95 p-3 shadow-2xl backdrop-blur-md"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-section text-fg-dim">
          {isErase ? 'Erase' : 'Brush'}
        </div>
        <div className="text-[10.5px] font-mono text-fg-muted">
          {Math.round(brush.size)}px
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Field label="Size">
          <Slider
            value={brush.size}
            onValueChange={(v) => setBrush({ size: Math.round(v) })}
            min={1}
            max={512}
            step={1}
            ariaLabel="Brush size"
          />
        </Field>

        <Field label="Hardness">
          <Slider
            value={brush.hardness}
            onValueChange={(v) => setBrush({ hardness: v })}
            min={0}
            max={1}
            step={0.01}
            ariaLabel="Brush hardness"
          />
          <span className="w-10 shrink-0 text-right text-[12px] font-medium tabular-nums text-fg-secondary">
            {Math.round(brush.hardness * 100)}%
          </span>
        </Field>

        <Field label="Opacity">
          <Slider
            value={brush.opacity}
            onValueChange={(v) => setBrush({ opacity: v })}
            min={0}
            max={1}
            step={0.01}
            ariaLabel="Brush opacity"
          />
          <span className="w-10 shrink-0 text-right text-[12px] font-medium tabular-nums text-fg-secondary">
            {Math.round(brush.opacity * 100)}%
          </span>
        </Field>

        <Field label="Spacing">
          <Slider
            value={brush.spacing}
            onValueChange={(v) => setBrush({ spacing: v })}
            min={0.02}
            max={1}
            step={0.01}
            ariaLabel="Brush spacing"
          />
          <span className="w-10 shrink-0 text-right text-[12px] font-medium tabular-nums text-fg-secondary">
            {Math.round(brush.spacing * 100)}%
          </span>
        </Field>

        {/* Color picker lives in the toolbar's own circular swatch above
            the tool buttons — see CanvasToolbar's ColorPickerPanel. Keeps
            color globally accessible regardless of which brush mode is
            active. */}
      </div>
    </div>
  );
}
