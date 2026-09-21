import { useCallback } from 'react';
import { IconButton } from '@/components/ui/IconButton';
import { HeartIcon, InfiniteViewIcon, TrashIcon } from '@/components/ui/icons';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useShortcut, ShortcutPriority } from '@/hooks/useShortcut';
import { useStore } from '@/lib/store';
import { sendEntryToCanvas } from '@/features/canvas/sendEntryToCanvas';

/**
 * Right-slot actions for the generate top nav that act on whichever history
 * entry is currently shown on the stripped canvas (selected, else newest).
 * Lives inside <ConfirmProvider>, so useConfirm() is safe.
 */
export function GenerateNavActions() {
  const selectedEntry = useStore(s => s.selectedEntry);
  const newest = useStore(s => s.history[0] ?? null);
  const toggleHistoryLiked = useStore(s => s.toggleHistoryLiked);
  const removeHistoryEntry = useStore(s => s.removeHistoryEntry);
  const selectHistoryEntry = useStore(s => s.selectHistoryEntry);
  const confirm = useConfirm();
  const entry = selectedEntry ?? newest;
  const disabled = !entry;
  const liked = !!entry?.liked;

  const deleteCurrent = useCallback(async () => {
    if (!entry) return;
    const ok = await confirm({
      message: 'Delete this image?',
      confirmLabel: 'Delete',
      dontAskAgainKey: 'history.deleteEntry',
    });
    if (!ok) return;
    // Compute the neighbour we want to promote BEFORE removeHistoryEntry
    // rewrites the list — history is newest-first so the older entry
    // (idx + 1) slides into the deleted slot; fall back to the newer one
    // when the deleted entry was the oldest. Explicit select handles the
    // "viewing-newest-by-fallback, selectedEntry is null" case too.
    const list = useStore.getState().history;
    const idx = list.findIndex(h => h.id === entry.id);
    const neighbour = idx >= 0 ? (list[idx + 1] ?? list[idx - 1] ?? null) : null;
    removeHistoryEntry(entry.id);
    selectHistoryEntry(neighbour);
  }, [entry, confirm, removeHistoryEntry, selectHistoryEntry]);

  // Delete / Backspace fire the same flow as the trash button. skipTyping
  // protects all the prompt textareas; the fullscreen viewer + history panel
  // overlays sit at higher priority bands so they win when open.
  useShortcut(['Delete', 'Backspace'], (e) => {
    if (!entry) return;
    e.preventDefault();
    void deleteCurrent();
  }, { priority: ShortcutPriority.Global, when: () => !!entry });

  return (
    <>
      <IconButton
        aria-label="Send image to canvas"
        title="Send this image to the infinite canvas as a new image layer"
        onClick={() => { if (entry) void sendEntryToCanvas(entry); }}
        disabled={disabled}
        className="disabled:cursor-not-allowed disabled:opacity-40"
      >
        <InfiniteViewIcon size={16} />
      </IconButton>
      <IconButton
        state={liked ? 'on' : 'off'}
        aria-label={liked ? 'Unfavorite image' : 'Favorite image'}
        title={liked ? 'Unfavorite this image' : 'Favorite this image'}
        onClick={() => { if (entry) toggleHistoryLiked(entry.id); }}
        disabled={disabled}
        className="disabled:cursor-not-allowed disabled:opacity-40"
      >
        <HeartIcon size={16} filled={liked} />
      </IconButton>
      <IconButton
        aria-label="Delete image"
        title="Delete this image from history (Del)"
        onClick={() => { void deleteCurrent(); }}
        disabled={disabled}
        className="disabled:cursor-not-allowed disabled:opacity-40 hover:!text-status-err"
      >
        <TrashIcon size={16} />
      </IconButton>
    </>
  );
}
