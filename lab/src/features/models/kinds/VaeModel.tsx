import type { ReactNode } from 'react';
import { ModelCard } from '../primitives';

/**
 * VAE card — a single optional VAE override, backed by `workflow.vae`.
 * Removing it (`onRemove`) clears the override so the workflow falls back to
 * the checkpoint's built-in VAE.
 */
export function VaeModel({
  fileName,
  onRemove,
  onOpen,
  editSlot,
}: {
  fileName: string;
  onRemove: () => void;
  onOpen?: () => void;
  /** Per-card edit trigger — typically a <ModelPicker> with a pencil icon. */
  editSlot?: ReactNode;
}) {
  return (
    <ModelCard kind="vae" onOpen={onOpen}>
      <ModelCard.Body>
        <ModelCard.Header title={fileName} subtitle="VAE override" onRemove={onRemove} editSlot={editSlot} />
      </ModelCard.Body>
    </ModelCard>
  );
}
