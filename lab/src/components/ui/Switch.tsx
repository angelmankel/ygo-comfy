import * as RSwitch from '@radix-ui/react-switch';
import { cn } from '@/lib/cn';

type Props = {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  size?: 'sm' | 'md';
  ariaLabel?: string;
  className?: string;
};

export function Switch({ checked, onCheckedChange, size = 'md', ariaLabel, className }: Props) {
  const dims =
    size === 'sm'
      ? { root: 'w-[36px] h-[20px] p-[2px]', thumb: 'w-4 h-4 data-[state=checked]:translate-x-[16px]' }
      : { root: 'w-[46px] h-[26px] p-[3px]', thumb: 'w-5 h-5 data-[state=checked]:translate-x-[20px]' };
  return (
    <RSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={ariaLabel}
      className={cn(
        'shrink-0 inline-flex items-center rounded-full transition-colors outline-none',
        'data-[state=checked]:bg-accent',
        'data-[state=unchecked]:bg-border-default',
        dims.root,
        className,
      )}
    >
      <RSwitch.Thumb
        className={cn(
          'block rounded-full transition-transform bg-white',
          'data-[state=unchecked]:bg-white/55',
          dims.thumb,
        )}
      />
    </RSwitch.Root>
  );
}
