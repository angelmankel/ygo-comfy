import { useStore } from '@/lib/store';
import { cn } from '@/lib/cn';

/**
 * Connection / generation status — just the indicator dot + the current
 * status text. The queue lives in its own `<QueueButton>` popover now, and the
 * prompt is no longer surfaced here.
 */
export function StatusPill() {
  const status = useStore(s => s.status);
  const dotClass =
    status.kind === 'error' ? 'bg-status-err text-status-err' :
    status.kind === 'busy'  ? 'bg-yellow-400 text-yellow-400' :
                              'bg-status-ok text-status-ok';
  // High-level label only — the detailed `status.text` was too long for the
  // header strip and changed every few seconds. Errors are the exception:
  // show the full message inline so the user doesn't need to hunt for it.
  const label =
    status.kind === 'error' ? (status.text || 'Error') :
    status.kind === 'busy'  ? 'Generating' :
                              'Connected';
  return (
    <div
      className={cn(
        'inline-flex h-7 items-center gap-2 rounded-md border border-border-default bg-bg-elev/80 px-2.5',
        status.kind === 'error' && 'max-w-[60ch]',
      )}
      title={status.text}
    >
      <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full dot-glow', dotClass)} />
      <span className={cn('text-[11px] font-medium text-fg-secondary', status.kind === 'error' && 'truncate')}>
        {label}
      </span>
    </div>
  );
}
