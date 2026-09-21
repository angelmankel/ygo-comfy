import type { ReactNode } from 'react';
import { ModelCard, Chip } from '../primitives';

/**
 * Checkpoint card — one entry in `workflow.checkpoints`. The first (`isBase`)
 * provides CLIP + VAE; the rest are merged into it. Merge ratios live in
 * <CheckpointMergeBox>, so this card stays identity-only.
 */
export function CheckpointModel({
  fileName,
  isBase,
  onRemove,
  onOpen,
  previewUrl,
  editSlot,
}: {
  fileName: string;
  isBase?: boolean;
  onRemove?: () => void;
  onOpen?: () => void;
  /** CivitAI preview image, when resolved. */
  previewUrl?: string;
  /** Per-card edit trigger — typically a <ModelPicker> with a pencil icon. */
  editSlot?: ReactNode;
}) {
  return (
    <ModelCard kind="checkpoint" onOpen={onOpen}>
      <ModelCard.Preview src={previewUrl} label="preview" />
      <ModelCard.Body>
        <ModelCard.Header
          title={fileName}
          subtitle={isBase ? 'Base checkpoint' : 'Merged checkpoint'}
          onRemove={onRemove}
          editSlot={editSlot}
        />
        {isBase && (
          <ModelCard.Params>
            <div className="flex">
              <Chip tone="accent">Base · provides CLIP + VAE</Chip>
            </div>
          </ModelCard.Params>
        )}
      </ModelCard.Body>
    </ModelCard>
  );
}
