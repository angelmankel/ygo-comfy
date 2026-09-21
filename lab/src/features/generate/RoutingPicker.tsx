import * as RPopover from '@radix-ui/react-popover';
import { useStore } from '@/lib/store';
import { ROUND_ROBIN } from '@/lib/storage';
import { cn } from '@/lib/cn';
import { ChevronDownIcon, CheckIcon } from '@/components/ui/icons';

/**
 * Routing-target picker — chevron button + popover listing every routing
 * choice (round-robin + each server). Shared by `<GenerateButton>` (the
 * full-width panel button) and `<GenerateWidget>` (the compact floating
 * one). The `variant` prop controls the trigger's sizing so each call site
 * gets a button that visually matches its siblings.
 */
type Variant = 'lg' | 'sm';
type Align = 'start' | 'end';

export function RoutingPicker({ variant, align }: { variant: Variant; align: Align }) {
  const routing = useStore(s => s.routing);
  const servers = useStore(s => s.servers);
  const serverInfo = useStore(s => s.serverInfo);
  const setRouting = useStore(s => s.setRouting);

  const routingLabel = routing === ROUND_ROBIN
    ? (variant === 'lg' ? 'All servers' : 'All')
    : servers.find(s => s.id === routing)?.name ?? 'Server';

  // Trigger sizing differs between the two call sites; the popover body is
  // identical so it lives here once.
  const triggerCls = variant === 'lg'
    ? 'px-2.5'
    : 'min-h-[36px] px-2';
  const labelMax = variant === 'lg' ? 'max-w-[78px]' : 'max-w-[64px]';
  const chevron = variant === 'lg' ? 12 : 10;

  return (
    <RPopover.Root>
      <RPopover.Trigger asChild>
        <button
          type="button"
          title={`Job routing: ${routingLabel}`}
          aria-label={`Job routing: ${routingLabel}`}
          className={cn(
            'flex items-center gap-1 border-l border-white/20 bg-accent text-white transition-colors hover:bg-accent-hover',
            triggerCls,
          )}
        >
          <span className={cn('truncate text-[10px] font-medium', labelMax)}>{routingLabel}</span>
          <ChevronDownIcon size={chevron} />
        </button>
      </RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content
          align={align}
          sideOffset={6}
          className="z-50 w-[248px] overflow-hidden rounded-lg border border-border-default bg-bg-elev shadow-xl"
        >
          <div className="border-b border-border-subtle px-3 py-2 text-[10px] font-semibold uppercase tracking-section text-fg-tertiary">
            Queue jobs on
          </div>
          <div className="p-1.5">
            <RoutingOption
              label="All servers"
              hint="round-robin"
              active={routing === ROUND_ROBIN}
              onSelect={() => setRouting(ROUND_ROBIN)}
            />
            {servers.map(s => (
              <RoutingOption
                key={s.id}
                label={s.name}
                hint={s.host}
                online={!!serverInfo[s.id]}
                active={routing === s.id}
                onSelect={() => setRouting(s.id)}
              />
            ))}
          </div>
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

function RoutingOption({
  label, hint, online, active, onSelect,
}: {
  label: string;
  hint?: string;
  online?: boolean;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <RPopover.Close asChild>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
          active ? 'bg-accent-soft' : 'hover:bg-bg-base/60',
        )}
      >
        {online !== undefined && (
          <span
            className={cn('h-1.5 w-1.5 shrink-0 rounded-full', online ? 'bg-status-ok' : 'bg-fg-dim')}
            title={online ? 'Online' : 'Offline'}
          />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn('truncate text-[12px]', active ? 'text-accent-fg' : 'text-fg-secondary')}>
            {label}
          </span>
          {hint && <span className="truncate font-mono text-[9px] text-fg-dim">{hint}</span>}
        </span>
        {active && <CheckIcon size={13} className="shrink-0 text-accent-fg" />}
      </button>
    </RPopover.Close>
  );
}
