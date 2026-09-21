import * as RSelect from '@radix-ui/react-select';
import { cn } from '@/lib/cn';
import { ChevronDownIcon } from '@/components/ui/icons';

/** An option may be a bare string (value === label) or an explicit value/label pair. */
type Option = string | { value: string; label: string };

type OptionState = {
  /** Render the option dimmed + unselectable. */
  disabled?: boolean;
  /** Native hover tooltip — e.g. which servers have a model. */
  title?: string;
};

type Props = {
  value: string;
  onValueChange: (v: string) => void;
  options: readonly Option[];
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  ariaLabel?: string;
  /** Per-option disabled/title state — used for resource availability. */
  getOptionState?: (value: string) => OptionState | undefined;
};

export function Select({
  value, onValueChange, options, placeholder, className, triggerClassName, ariaLabel, getOptionState,
}: Props) {
  // Normalize, and drop any option with an empty value — Radix's Select.Item
  // throws on an empty-string value, so a bad option must never reach it.
  const opts = options
    .map(o => (typeof o === 'string' ? { value: o, label: o } : o))
    .filter(o => o.value !== '');
  return (
    <RSelect.Root value={value} onValueChange={onValueChange}>
      <RSelect.Trigger
        aria-label={ariaLabel}
        className={cn(
          'flex min-h-[40px] flex-1 items-center justify-between gap-2 px-3 py-2',
          'bg-bg-input rounded-lg border border-border-default',
          'text-[13px] text-fg-secondary outline-none',
          'hover:border-border-strong focus-visible:border-accent',
          className,
          triggerClassName,
        )}
      >
        <RSelect.Value placeholder={placeholder} />
        <RSelect.Icon className="text-fg-muted"><ChevronDownIcon size={13} /></RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content
          position="popper"
          sideOffset={4}
          className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border-default bg-bg-elev shadow-xl"
        >
          <RSelect.Viewport className="p-1 max-h-[300px]">
            {opts.map(o => {
              const st = getOptionState?.(o.value);
              return (
                <RSelect.Item
                  key={o.value}
                  value={o.value}
                  disabled={st?.disabled}
                  title={st?.title}
                  className={cn(
                    'relative flex min-h-[36px] select-none items-center rounded-md px-2.5 py-1.5 text-[13px] text-fg-secondary',
                    'data-[highlighted]:bg-accent-soft data-[highlighted]:text-fg-primary',
                    'data-[state=checked]:text-accent-fg outline-none cursor-default',
                    'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40',
                  )}
                >
                  <RSelect.ItemText>{o.label}</RSelect.ItemText>
                </RSelect.Item>
              );
            })}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}
