import type { ReactNode } from 'react';
import { Switch } from '@/components/ui/Switch';
import { useStore } from '@/lib/store';
import type { WorkflowLora } from '@/lib/types';
import { ModelCard, ParamSlider } from '../primitives';

/**
 * LoRA card — bypass toggle + strength + clip-strength, backed by one entry in
 * `workflow.loras`. Edits go straight through the global store's lora actions.
 */
export function LoraModel({
  lora,
  onOpen,
  previewUrl,
  editSlot,
}: {
  lora: WorkflowLora;
  onOpen?: () => void;
  /** CivitAI preview image, when resolved. */
  previewUrl?: string;
  /** Per-card edit trigger — typically a <ModelPicker> with a pencil icon. */
  editSlot?: ReactNode;
}) {
  const updateLora = useStore((s) => s.updateLora);
  const removeLora = useStore((s) => s.removeLora);
  return (
    <ModelCard kind="lora" onOpen={onOpen}>
      <ModelCard.Preview src={previewUrl} label="preview" />
      <ModelCard.Body>
        <ModelCard.Header
          title={lora.name}
          subtitle="LoRA"
          onRemove={() => removeLora(lora.id)}
          editSlot={editSlot}
        />
        <ModelCard.Params>
          <div className="flex items-center gap-2">
            <Switch
              size="sm"
              checked={lora.on}
              onCheckedChange={(on) => updateLora(lora.id, { on })}
              ariaLabel="Enable LoRA"
            />
            <span className="text-[11px] text-fg-muted">{lora.on ? 'Active' : 'Bypassed'}</span>
          </div>
          <ParamSlider
            kind="lora"
            label="Strength"
            min={-2}
            max={2}
            value={lora.strength}
            onValueChange={(v) => updateLora(lora.id, { strength: v })}
          />
          <ParamSlider
            kind="lora"
            label="Clip strength"
            min={-2}
            max={2}
            value={lora.clipStrength}
            onValueChange={(v) => updateLora(lora.id, { clipStrength: v })}
          />
        </ModelCard.Params>
      </ModelCard.Body>
    </ModelCard>
  );
}
