import { Modal } from '@/components/modal';
import { GalleryColumn } from './GalleryColumn';
import { MetadataColumn } from './MetadataColumn';
import { useModelMetadataStore } from './store';

/**
 * Concrete model-metadata modal — composes the generic <Modal> base with the
 * gallery + metadata columns.
 *
 * Mount this once near the app root; it shows itself whenever
 * `useModelMetadataStore.getState().open(entryId, civitaiModelId)` is called
 * (e.g. from a model tile's `onOpen`).
 */
export function ModelMetadataModal() {
  const open = useModelMetadataStore((s) => s.openEntryId != null);
  const close = useModelMetadataStore((s) => s.close);
  return (
    <Modal open={open} onClose={close} panelClassName="w-[min(1600px,96vw)]">
      <GalleryColumn />
      <MetadataColumn />
    </Modal>
  );
}
