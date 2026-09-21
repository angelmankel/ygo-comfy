import * as RPopover from '@radix-ui/react-popover';
import { useStore } from '@/lib/store';
import { cn } from '@/lib/cn';
import { CloseIcon } from '@/components/ui/icons';
import type { Job } from '@/lib/types';

/**
 * The generation queue: a toolbar badge that opens a popover listing jobs
 * across every server, with live status + progress. Jobs persist in IndexedDB,
 * so this survives a refresh; completed jobs drop off on their own, errored
 * ones stay until dismissed. The ✕ cancels the job on its ComfyUI server
 * (interrupt if running, dequeue if pending) and removes it here.
 */
export function QueueButton() {
  const jobs = useStore(s => s.jobs);
  const servers = useStore(s => s.servers);
  const cancelJob = useStore(s => s.cancelJob);

  // Newest first, across all servers.
  const sorted = [...jobs].sort((a, b) => b.createdAt - a.createdAt);
  const count = sorted.length;
  const hasError = sorted.some(j => j.status === 'error');
  const serverName = (id: string) => servers.find(sv => sv.id === id)?.name ?? '?';

  return (
    <RPopover.Root>
      <RPopover.Trigger asChild>
        <button
          type="button"
          title="Show the generation queue"
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-default bg-bg-elev/80 px-2.5 backdrop-blur transition-colors hover:border-border-strong focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <span className="text-[8px] font-semibold uppercase tracking-section text-fg-dim">
            Queue
          </span>
          <span
            className={cn(
              'flex h-4 min-w-4 items-center justify-center rounded px-1 text-[10px] font-semibold',
              hasError ? 'bg-status-err text-white'
                : count > 0 ? 'bg-accent text-white'
                : 'bg-bg-base text-fg-secondary',
            )}
          >
            {count}
          </span>
        </button>
      </RPopover.Trigger>

      <RPopover.Portal>
        <RPopover.Content
          align="center"
          sideOffset={6}
          className="z-50 w-[320px] overflow-hidden rounded-lg border border-border-default bg-bg-elev shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-section text-fg-tertiary">
              Queue
            </span>
            <span className="text-[11px] text-fg-muted">
              {count} job{count === 1 ? '' : 's'}
            </span>
          </div>

          {count === 0 ? (
            <div className="px-3 py-6 text-center text-[12px] italic text-fg-muted">
              No active jobs
            </div>
          ) : (
            <ul className="max-h-[320px] overflow-y-auto p-1.5">
              {sorted.map(job => (
                <JobRow
                  key={job.id}
                  job={job}
                  serverName={serverName(job.serverId)}
                  onCancel={() => cancelJob(job.id)}
                />
              ))}
            </ul>
          )}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

function JobRow({
  job, serverName, onCancel,
}: {
  job: Job;
  serverName: string;
  onCancel: () => void;
}) {
  const pct = job.progress && job.progress.max > 0
    ? Math.round((job.progress.value / job.progress.max) * 100)
    : null;

  const nodeCounter = job.totalNodes
    ? `${Math.min(job.executedNodes ?? 0, job.totalNodes)}/${job.totalNodes}`
    : null;

  const runningLabel = job.node
    ? `Running · ${nodeCounter ? `node ${nodeCounter} · ` : ''}${job.node}`
    : 'Running';
  const statusLabel =
    job.status === 'error' ? (job.error || 'Failed')
    : job.status === 'running' ? runningLabel
    : 'Queued';

  const dotClass =
    job.status === 'error' ? 'bg-status-err'
    : job.status === 'running' ? 'bg-yellow-400'
    : 'bg-fg-dim';

  const cancelLabel =
    job.status === 'running' ? 'Interrupt job'
    : job.status === 'queued' ? 'Remove from queue'
    : 'Dismiss job';

  return (
    <li className="rounded-md px-2 py-2 hover:bg-bg-base/60">
      <div className="flex items-center gap-2">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', dotClass)} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] text-fg-secondary">
            {job.positive || '(no prompt)'}
          </div>
          <div
            className={cn('text-[10px] text-fg-muted', job.status === 'error' ? 'whitespace-pre-wrap break-words' : 'truncate')}
            title={job.status === 'error' ? statusLabel : undefined}
          >
            {serverName} · #{job.id.slice(0, 6)} · {statusLabel}
            {pct !== null ? ` · ${pct}%` : ''}
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
      {job.status === 'running' && pct !== null && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-bg-base">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
    </li>
  );
}
