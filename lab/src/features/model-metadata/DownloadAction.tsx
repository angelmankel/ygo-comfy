import * as RPopover from '@radix-ui/react-popover';
import { cn } from '@/lib/cn';
import { useStore } from '@/lib/store';
import { serversWithModel } from '@/lib/routing';
import { useDownloadsStore } from '@/features/downloads';
import { DownloadIcon, CheckIcon, ChevronDownIcon } from '@/components/ui/icons';
import { primaryFile, type CivitaiModelVersion } from './civitai';

/**
 * Footer action for the metadata modal. Two parts:
 *
 *   ┌───────────────────────────────┬─────┐
 *   │  Download / Sync to N / On... │  ▼  │
 *   └───────────────────────────────┴─────┘
 *
 *   • Main button:   fires the "default" action — download on every online
 *                    server that doesn't have it (the round-robin sweet spot).
 *   • Chevron menu:  per-server list. Each row shows the server's current
 *                    state and lets you trigger a download against just that
 *                    one server — useful when you only want the model on
 *                    your fast box, or you're testing a pod.
 *
 * Per-server presence is matched by the version's primary file name against
 * each server's reported model lists — the same basis as <FileDetails>.
 */
export function DownloadAction({ version }: { version: CivitaiModelVersion }) {
  const servers = useStore((s) => s.servers);
  const serverInfo = useStore((s) => s.serverInfo);
  const rows = useDownloadsStore((s) => s.rows);
  const start = useDownloadsStore((s) => s.start);

  const fileName = primaryFile(version)?.name ?? '';
  const online = servers.filter((s) => serverInfo[s.id]);
  const haveIds = new Set(serversWithModel(serverInfo, fileName));
  const missing = online.filter((s) => !haveIds.has(s.id));
  // Per-server live download state — keyed by both versionId AND serverId so
  // a download running on server A doesn't make server B's row look busy.
  const isDownloadingOn = (serverId: string) =>
    rows.some(
      (r) => r.version_id === version.id && r.serverId === serverId && r.status === 'downloading',
    );
  const anyDownloading = rows.some(
    (r) => r.version_id === version.id && r.status === 'downloading',
  );

  const base =
    'inline-flex items-center gap-1.5 rounded-lg border border-border-default px-3.5 py-2 text-[12.5px] font-medium';

  if (online.length === 0) {
    return <span className={cn(base, 'text-fg-muted')}>No servers online</span>;
  }

  // Main-button label/state.
  let mainLabel: string;
  let mainDisabled = false;
  let mainAction: (() => void) | null = null;
  let mainTone: 'idle' | 'accent' | 'ok' = 'idle';
  if (anyDownloading) {
    mainLabel = 'Downloading…';
    mainDisabled = true;
    mainTone = 'idle';
  } else if (missing.length === 0) {
    mainLabel = 'On disk';
    mainDisabled = true;
    mainTone = 'ok';
  } else if (haveIds.size > 0) {
    mainLabel = `Sync to ${missing.length} server${missing.length === 1 ? '' : 's'}`;
    mainAction = () => void start(version.id, undefined, missing.map((s) => s.id));
    mainTone = 'accent';
  } else {
    mainLabel = 'Download';
    mainAction = () => void start(version.id);
    mainTone = 'idle';
  }

  return (
    <div className="inline-flex items-stretch">
      <button
        type="button"
        onClick={mainAction ?? undefined}
        disabled={mainDisabled}
        title={
          mainLabel.startsWith('Sync')
            ? `Missing on: ${missing.map((s) => s.name).join(', ')}`
            : undefined
        }
        className={cn(
          base,
          'rounded-r-none border-r-0 transition-colors',
          mainDisabled && 'cursor-default',
          !mainDisabled && 'hover:border-border-strong',
          mainTone === 'ok' && 'text-vae-fg',
          mainTone === 'accent' && 'text-accent-fg hover:text-accent-hover',
          mainTone === 'idle' && 'text-fg-secondary hover:text-fg-primary',
        )}
      >
        {mainTone === 'ok' ? <CheckIcon size={13} /> : <DownloadIcon size={13} />}
        {mainLabel}
      </button>

      <ServerDropdown
        servers={online}
        haveIds={haveIds}
        isDownloadingOn={isDownloadingOn}
        onPick={(serverId) => void start(version.id, undefined, [serverId])}
      />
    </div>
  );
}

/**
 * Split-button chevron. Opens a popover with one row per online server so
 * the user can fire a download at a specific box without disturbing the
 * others. Hides itself when there's only one server online — the main
 * button already does the right thing in that case.
 */
function ServerDropdown({
  servers, haveIds, isDownloadingOn, onPick,
}: {
  servers: { id: string; name: string }[];
  haveIds: Set<string>;
  isDownloadingOn: (id: string) => boolean;
  onPick: (id: string) => void;
}) {
  if (servers.length <= 1) {
    // Still render a disabled cap so the main button keeps its rounded edge.
    return (
      <span className="rounded-r-lg border border-l-0 border-border-default px-2 text-fg-dim opacity-50">
        <ChevronDownIcon size={12} />
      </span>
    );
  }
  return (
    <RPopover.Root>
      <RPopover.Trigger asChild>
        <button
          type="button"
          aria-label="Download to a specific server"
          title="Download to a specific server"
          className="inline-flex items-center justify-center rounded-r-lg border border-border-default bg-bg-elev px-2 text-fg-tertiary transition-colors hover:border-border-strong hover:text-fg-secondary"
        >
          <ChevronDownIcon size={12} />
        </button>
      </RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[260px] overflow-hidden rounded-lg border border-border-default bg-bg-elev shadow-xl"
        >
          <div className="border-b border-border-subtle px-3 py-2 text-[10px] font-semibold uppercase tracking-section text-fg-tertiary">
            Download to one server
          </div>
          <ul className="max-h-[280px] overflow-y-auto p-1.5">
            {servers.map((s) => {
              const has = haveIds.has(s.id);
              const busy = isDownloadingOn(s.id);
              const disabled = has || busy;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => !disabled && onPick(s.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors',
                      disabled
                        ? 'cursor-default text-fg-muted'
                        : 'text-fg-secondary hover:bg-bg-base/60 hover:text-fg-primary',
                    )}
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                      {has
                        ? <CheckIcon size={12} className="text-vae-fg" />
                        : busy
                          ? <DownloadIcon size={12} className="text-yellow-400 animate-pulse" />
                          : <DownloadIcon size={12} className="text-fg-tertiary" />}
                    </span>
                    <span className="flex-1 truncate">{s.name}</span>
                    <span className="text-[10px] text-fg-muted">
                      {has ? 'on disk' : busy ? 'downloading' : 'missing'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}
