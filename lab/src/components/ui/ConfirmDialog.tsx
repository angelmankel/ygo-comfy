import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import * as RDialog from '@radix-ui/react-dialog';
import { cn } from '@/lib/cn';

/**
 * App-styled replacement for `window.confirm()`. Mount `<ConfirmProvider>`
 * once near the app root and call `const confirm = useConfirm()` anywhere —
 * `await confirm(message)` resolves to `true` / `false`.
 *
 * The dialog is a Radix Dialog (the lighter primitive — we don't need
 * AlertDialog's role-attribute boilerplate, and pulling in another Radix
 * package only for that wouldn't pay off). Esc / overlay click resolve to
 * `false` to match window.confirm semantics.
 */

type ConfirmOptions = {
  /** Headline shown in the dialog title slot (defaults to "Confirm"). */
  title?: string;
  /** Body copy. Required; this is the question the user is answering. */
  message: string;
  /** Label on the destructive button — also drives its styling (red for
   *  destructive verbs like "Delete", accent otherwise). */
  confirmLabel?: string;
  /** Label on the cancel button. Defaults to "Cancel". */
  cancelLabel?: string;
  /** True when the action is destructive (deletes etc.). Styles the confirm
   *  button red instead of accent. Defaults to `true` because every current
   *  caller is a destructive flow — flip to `false` for non-destructive ones. */
  destructive?: boolean;
  /** When set, the dialog renders a "Don't ask again" checkbox. Checking it
   *  + confirming persists `<this key> = true` under SKIP_KEY in localStorage
   *  so future `confirm()` calls with the same key resolve `true` immediately
   *  without showing the dialog. Cleared by `clearConfirmSkips()`. */
  dontAskAgainKey?: string;
};

type ResolvedState = ConfirmOptions & { resolve: (ok: boolean) => void };

const ConfirmContext = createContext<((opts: string | ConfirmOptions) => Promise<boolean>) | null>(null);

/** localStorage key — record of `{ [dontAskAgainKey]: true }` for confirm
 *  dialogs the user has chosen to suppress. Read at confirm() time so a
 *  toggle made in this session takes effect on the next call. */
const SKIP_KEY = 'imagelab.confirmSkip.v1';
const loadSkipMap = (): Record<string, boolean> => {
  try {
    const raw = localStorage.getItem(SKIP_KEY);
    return raw ? JSON.parse(raw) as Record<string, boolean> : {};
  } catch { return {}; }
};
const setSkipped = (k: string) => {
  const m = loadSkipMap();
  m[k] = true;
  try { localStorage.setItem(SKIP_KEY, JSON.stringify(m)); } catch { /* ignore */ }
};
/** Wipe every persisted "don't ask again" choice — exposed for a future
 *  Settings → Reset confirmations affordance. */
export function clearConfirmSkips() {
  try { localStorage.removeItem(SKIP_KEY); } catch { /* ignore */ }
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return ctx;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ResolvedState | null>(null);
  const [dontAsk, setDontAsk] = useState(false);

  const confirm = useCallback((opts: string | ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      const normalized: ConfirmOptions = typeof opts === 'string' ? { message: opts } : opts;
      // Skip the dialog entirely if the user previously checked
      // "Don't ask again" for this key.
      if (normalized.dontAskAgainKey && loadSkipMap()[normalized.dontAskAgainKey]) {
        resolve(true);
        return;
      }
      setDontAsk(false);
      setState({ destructive: true, ...normalized, resolve });
    });
  }, []);

  const settle = (ok: boolean) => {
    if (ok && dontAsk && state?.dontAskAgainKey) {
      setSkipped(state.dontAskAgainKey);
    }
    state?.resolve(ok);
    setState(null);
  };

  const destructive = state?.destructive !== false;
  const confirmLabel = state?.confirmLabel ?? (destructive ? 'Delete' : 'Confirm');
  const cancelLabel = state?.cancelLabel ?? 'Cancel';

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <RDialog.Root open={!!state} onOpenChange={(o) => { if (!o) settle(false); }}>
        <RDialog.Portal>
          <RDialog.Overlay className="fixed inset-0 z-50 bg-black/55 data-[state=open]:animate-in data-[state=open]:fade-in" />
          <RDialog.Content
            className={cn(
              'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
              'w-[min(92vw,400px)] rounded-xl border border-border-strong bg-bg-elev px-5 py-4 text-fg-secondary shadow-2xl outline-none',
            )}
          >
            <RDialog.Title className="mb-1 text-[13px] font-semibold text-fg-primary">
              {state?.title ?? 'Confirm'}
            </RDialog.Title>
            <RDialog.Description className="mb-4 text-[12px] text-fg-muted">
              {state?.message}
            </RDialog.Description>
            {state?.dontAskAgainKey && (
              <label className="mb-3 flex cursor-pointer items-center gap-2 text-[11px] text-fg-muted hover:text-fg-secondary">
                <input
                  type="checkbox"
                  checked={dontAsk}
                  onChange={(e) => setDontAsk(e.currentTarget.checked)}
                  className="h-3.5 w-3.5 rounded border-border-default bg-bg-input accent-accent"
                />
                Don&apos;t ask again
              </label>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => settle(false)}
                className="rounded-md border border-border-default bg-bg-input px-3 py-1.5 text-[12px] font-medium text-fg-secondary hover:border-border-strong"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => settle(true)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-[12px] font-semibold text-white',
                  destructive
                    ? 'bg-status-err hover:bg-status-err/85'
                    : 'bg-accent hover:bg-accent-hover',
                )}
              >
                {confirmLabel}
              </button>
            </div>
          </RDialog.Content>
        </RDialog.Portal>
      </RDialog.Root>
    </ConfirmContext.Provider>
  );
}
