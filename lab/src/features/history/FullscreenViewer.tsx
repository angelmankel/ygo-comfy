import { useMemo } from 'react';
import { viewUrl } from '@/lib/comfy';
import { useStore } from '@/lib/store';
import { FullscreenImage, type FullscreenItem } from '@/components/FullscreenImage';
import type { HistoryEntry } from '@/lib/types';

type Props = {
  list: HistoryEntry[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
};

/**
 * History-flavored fullscreen viewer — adapts each `HistoryEntry` into a
 * generic `FullscreenItem`, then renders <FullscreenImage> with an info
 * sidebar showing the entry's metadata. The slideshow play/pause state is
 * shared with the model-metadata modal via localStorage.
 */
export function FullscreenViewer({ list, index, onIndexChange, onClose }: Props) {
  const servers = useStore(s => s.servers);
  const viewerInfoOpen = useStore(s => s.viewerInfoOpen);
  const playing = useStore(s => s.slideshowPlaying);
  const setPlaying = useStore(s => s.setSlideshowPlaying);

  const items = useMemo<FullscreenItem[]>(() =>
    list.map(e => ({
      key: e.id,
      url: viewUrl(e, servers.find(s => s.id === e.serverId)?.host ?? ''),
    })),
  [list, servers]);

  const entry = list[index];
  if (!entry) return null;

  return (
    <FullscreenImage
      items={items}
      index={index}
      onIndexChange={onIndexChange}
      onClose={onClose}
      playing={playing}
      onPlayingChange={setPlaying}
      initialInfoOpen={viewerInfoOpen}
      infoSlot={<EntryInfo entry={entry} serverName={servers.find(s => s.id === entry.serverId)?.name || '—'} />}
    />
  );
}

function EntryInfo({ entry, serverName }: { entry: HistoryEntry; serverName: string }) {
  return (
    <dl className="flex flex-col gap-3">
      <Meta label="Created" value={new Date(entry.createdAt).toLocaleString()} />
      <Meta label="Model" value={entry.model || '—'} />
      <Meta label="Seed" value={String(entry.seed)} mono />
      <Meta label="Server" value={serverName} />
      <Meta label="Filename" value={entry.subfolder ? `${entry.subfolder}/${entry.filename}` : entry.filename} mono />
      <Meta label="Prompt ID" value={entry.promptId} mono />
      <Meta label="Positive" value={entry.positive || '—'} block />
      <Meta label="Negative" value={entry.negative || '—'} block />
    </dl>
  );
}

function Meta({ label, value, mono, block }: { label: string; value: string; mono?: boolean; block?: boolean }) {
  return (
    <div className={block ? 'flex flex-col gap-1' : 'flex items-baseline justify-between gap-3'}>
      <dt className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-white/45">{label}</dt>
      <dd
        className={`text-[12px] text-white/85 ${mono ? 'font-mono' : ''} ${
          block ? 'whitespace-pre-wrap break-words' : 'truncate text-right'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
