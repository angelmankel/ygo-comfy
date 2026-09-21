import { cn } from '@/lib/cn';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'ghost' | 'soft';
type ToggleState = 'on' | 'off';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: Variant;
  /**
   * Toggle state for on/off buttons. When set, this is reflected as a
   * `data-state` attribute and styled via Tailwind `data-[state=on]:…`
   * variants — those compile to attribute selectors which always beat the
   * default utility classes regardless of stylesheet ordering, so consumers
   * never have to fight Tailwind specificity to make "on" look distinct.
   * Leave `undefined` for a stateless icon button (most buttons).
   */
  state?: ToggleState;
};

const BASE = [
  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[14px] outline-none transition-colors',
  'focus-visible:border-accent',
];

/** Default appearance, used both for the always-on look (no `state` prop)
 *  and the off side of a toggle. Lives in one place so the two stay in sync. */
const DEFAULT_LOOK = [
  'text-fg-muted hover:text-fg-secondary',
];

/** "On" appearance applied when `data-state="on"` is set. Uses the data-state
 *  attribute selector so it wins over the default utilities without `!important`. */
const ON_LOOK = [
  'data-[state=on]:bg-accent data-[state=on]:border-accent data-[state=on]:text-white',
  'data-[state=on]:hover:bg-accent-hover',
  'data-[state=on]:shadow-[0_0_0_1px_rgba(79,138,255,0.35)]',
];

export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { children, variant = 'soft', state, className, ...rest },
  ref,
) {
  const variantBase =
    variant === 'soft'
      ? 'bg-bg-elev border border-border-subtle hover:border-border-strong'
      : 'border border-transparent hover:bg-bg-elev';
  return (
    <button
      ref={ref}
      type="button"
      data-state={state}
      {...rest}
      className={cn(
        ...BASE,
        variantBase,
        ...DEFAULT_LOOK,
        // ON_LOOK is gated by data-[state=on] so it's a no-op without the attr.
        ...ON_LOOK,
        className,
      )}
    >
      {children}
    </button>
  );
});
