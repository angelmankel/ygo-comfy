import { useStore } from '@/lib/store';
import { viewUrl } from '@/lib/comfy';
import { DownloadIcon } from '@/components/ui/icons';
import { IconButton } from '@/components/ui/IconButton';

/**
 * Top-nav action: download the currently-selected image to disk. Disabled
 * whenever nothing is explicitly selected (matching RecallButton's gating)
 * — falling back to the newest entry would make "Download" silently save
 * a different image than the user thinks they're acting on.
 *
 * Pulls the blob through fetch + createObjectURL rather than relying on
 * `<a download>`, because the `download` attribute is ignored on cross-
 * origin URLs (the ComfyUI host is a different origin from the app).
 */
export function DownloadSelectedButton() {
  const selectedEntry = useStore(s => s.selectedEntry);
  const servers = useStore(s => s.servers);
  const disabled = !selectedEntry;

  const onClick = async () => {
    if (!selectedEntry) return;
    const host = servers.find(s => s.id === selectedEntry.serverId)?.host;
    if (!host) return;
    try {
      const url = viewUrl(selectedEntry, host);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const obj = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = obj;
      a.download = selectedEntry.filename || `imagelab-${selectedEntry.id}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(obj), 1000);
    } catch (err) {
      console.warn('[DownloadSelectedButton] failed', err);
    }
  };

  return (
    <IconButton
      aria-label="Download image"
      title={disabled ? 'Select an image to download' : 'Download this image'}
      onClick={onClick}
      disabled={disabled}
      className="disabled:cursor-not-allowed disabled:opacity-40"
    >
      <DownloadIcon size={16} />
    </IconButton>
  );
}
