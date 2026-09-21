import { useStore } from '@/lib/store';
import { ResetIcon } from '@/components/ui/icons';

/**
 * Recall the selected image's saved workflow + prompt layers back into the
 * editor. Disabled when nothing is selected.
 */
export function RecallButton() {
  const selectedEntry = useStore(s => s.selectedEntry);
  const recallSelected = useStore(s => s.recallSelected);
  const disabled = !selectedEntry;

  return (
    <button
      type="button"
      onClick={() => recallSelected()}
      disabled={disabled}
      title={disabled
        ? 'Select an image to recall its parameters'
        : 'Recall this image’s workflow + prompt into the editor'}
      className="flex min-h-[36px] items-center gap-1.5 rounded-md border border-border-default bg-bg-elev/80 px-2.5 py-1 text-[11px] font-medium text-fg-secondary backdrop-blur transition-colors hover:border-border-strong focus:outline-none focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border-default"
    >
      <ResetIcon size={13} />
      Recall
    </button>
  );
}
