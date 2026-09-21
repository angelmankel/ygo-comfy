import * as RPopover from '@radix-ui/react-popover';
import { cn } from '@/lib/cn';
import { CloseIcon, DownloadIcon } from '@/components/ui/icons';
import { useDownloadsStore, type DownloadRow } from './store';

/**
 * The downloads panel: a toolbar badge that opens a popover listing CivitAI
 * model downloads across every server, with live progress. Polling is driven
 * by `useDownloads`. The ✕ cancels an in-flight download (or dismisses a
 * finished/failed row) on its server.
 *
 * Downloads are fired at every online server, so the same model can appear
 * once per server — each row is tagged with where it's running.
 */
export function DownloadsButton() {
  const rows = useDownloadsStore((s) => s.rows);
  const cancel = useDownloadsStore((s) => s.cancel);
  const aggregate = useDownloadsStore((s) => s.aggregateProgress());

  // Newest first.
  const sorted = [...rows].sort((a, b) => b.started_at - a.started_at);
  const active = sorted.filter((r) => r.status === 'downloading').length;
  const hasError = sorted.some((r) => r.status === 'failed');

  return (
    <RPopover.Root>
      <RPopover.Trigger asChild>
        <button
          type="button"
          title={
            aggregate !== null
              ? `Downloads — ${Math.round(aggregate * 100)}% (${active} active)`
              : 'Show CivitAI downloads'
          }
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-default bg-bg-elev/80 px-2.5 backdrop-blur transition-colors hover:border-border-strong focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <DownloadIcon size={13} className="text-fg-dim" />
          <ProgressBadge
            count={active}
            progress={aggregate}
            tone={hasError ? 'error' : active > 0 ? 'accent' : 'idle'}
          />
        </button>
      </RPopover.Trigger>

      <RPopover.Portal>
        <RPopover.Content
          align="center"
          sideOffset={6}
          className="z-50 w-[420px] max-w-[92vw] overflow-hidden rounded-lg border border-border-default bg-bg-elev shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-section text-fg-tertiary">
              Downloads
            </span>
            <span className="text-[11px] text-fg-muted">
              {active > 0 ? `${active} active` : `${sorted.length} total`}
            </span>
          </div>

          {sorted.length === 0 ? (
            <div className="px-3 py-6 text-center text-[12px] italic text-fg-muted">
              No downloads
            </div>
          ) : (
            <ul className="max-h-[360px] overflow-y-auto p-1.5">
              {sorted.map((row) => (
                <DownloadRowItem key={row.rowId} row={row} onCancel={() => cancel(row)} />
              ))}
            </ul>
          )}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

/**
 * Circular count-badge with an outer progress arc. The arc tracks aggregate
 * download progress across all active downloads (Σ downloaded / Σ total) so
 * a glance at the toolbar tells you "how close everything is to done." When
 * idle (no active downloads) it falls back to a flat pill — same height, no
 * extra chrome — so the toolbar doesn't jump.
 */
function ProgressBadge({
  count, progress, tone,
}: { count: number; progress: number | null; tone: 'error' | 'accent' | 'idle' }) {
  // Flat pill when nothing's active — preserves the original look.
  if (progress === null) {
    return (
      <span
        className={cn(
          'flex h-4 min-w-4 items-center justify-center rounded px-1 text-[10px] font-semibold',
          tone === 'error' ? 'bg-status-err text-white'
            : tone === 'accent' ? 'bg-accent text-white'
            : 'bg-bg-base text-fg-secondary',
        )}
      >
        {count}
      </span>
    );
  }

  // SVG ring around the count. r=8 means a 16×16 inner; we render at 20×20
  // and absolutely-position the count to keep the toolbar slot at h-4 worth
  // of visual weight. stroke-dashoffset draws the progress arc.
  const SIZE = 20;
  const R = 8;
  const CIRC = 2 * Math.PI * R;
  const dash = CIRC * (1 - Math.max(0, Math.min(1, progress)));
  const trackClass =
    tone === 'error' ? 'stroke-status-err/25' : 'stroke-accent/20';
  const arcClass =
    tone === 'error' ? 'stroke-status-err' : 'stroke-accent';

  return (
    <span className="relative inline-flex h-5 w-5 items-center justify-center">
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="absolute inset-0 -rotate-90"
        aria-hidden
      >
        <circle
          cx={SIZE / 2} cy={SIZE / 2} r={R}
          fill="none" strokeWidth={2}
          className={trackClass}
        />
        <circle
          cx={SIZE / 2} cy={SIZE / 2} r={R}
          fill="none" strokeWidth={2} strokeLinecap="round"
          strokeDasharray={CIRC} strokeDashoffset={dash}
          className={cn(arcClass, 'transition-[stroke-dashoffset] duration-300 ease-out')}
        />
      </svg>
      <span className="relative text-[9px] font-semibold leading-none text-fg-secondary">
        {count}
      </span>
    </span>
  );
}

/** Per-second throughput, shown alongside the bytes counter while a file
 *  is in-flight. MB/s for anything ≥ 1 MB/s (the common case for fast NICs),
 *  KB/s below — keeps the number short. */
function fmtSpeed(bps: number): string {
  if (bps <= 0) return '';
  if (bps >= 1024 ** 2) return `${(bps / 1024 ** 2).toFixed(1)} MB/s`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${Math.round(bps)} B/s`;
}

function DownloadRowItem({ row, onCancel }: { row: DownloadRow; onCancel: () => void }) {
  const bps = useDownloadsStore((s) => s.bytesPerSecond(row.rowId));

  const dotClass =
    row.status === 'failed' ? 'bg-status-err'
    : row.status === 'completed' ? 'bg-green-500'
    : row.status === 'downloading' ? 'bg-yellow-400'
    : 'bg-fg-dim';

  const speed = row.status === 'downloading' ? fmtSpeed(bps) : '';
  const statusLabel =
    row.status === 'failed' ? (row.error || 'Failed')
    : row.status === 'completed' ? 'Done'
    : row.status === 'cancelled' ? 'Cancelled'
    : row.total_bytes > 0
      ? `${fmtBytes(row.downloaded_bytes)} / ${fmtBytes(row.total_bytes)} · ${row.percent}%${speed ? ` · ${speed}` : ''}`
      : speed ? `Starting… · ${speed}` : 'Starting…';

  const cancelLabel = row.status === 'downloading' ? 'Cancel download' : 'Dismiss';

  return (
    <li className="rounded-md px-2 py-2 hover:bg-bg-base/60">
      <div className="flex items-center gap-2">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', dotClass)} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] text-fg-secondary">{row.filename}</div>
          <div className="whitespace-normal break-words text-[10px] leading-snug text-fg-muted">
            {row.serverName} · {row.folder} · {statusLabel}
          </div>
        </div>
        <button
          type="button"
          aria-label={cancelLabel}
          title={cancelLabel}
          onClick={onCancel}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-muted transition-colors hover:bg-status-err/15 hover:text-status-err"
        >
          <CloseIcon size={12} />
        </button>
      </div>
      {row.status === 'downloading' && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-bg-base">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${row.total_bytes > 0 ? row.percent : 0}%` }}
          />
        </div>
      )}
    </li>
  );
}
