import { createContext, useContext, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { ModelKind } from '../types';
import { KIND_LABEL } from '../kindMeta';
import { CountBadge } from './Badge';

/**
 * Compound type-grouped section — one per model kind.
 *
 *   <ModelGroup kind="lora">
 *     <ModelGroup.Header count={loras.length} right={<ModelPicker … />} />
 *     {loras.map((l) => <LoraModel key={l.id} lora={l} />)}
 *     {loras.length === 0 && <ModelGroup.Empty>No LoRAs yet</ModelGroup.Empty>}
 *   </ModelGroup>
 *
 * This is a generic part: it owns the section chrome (label, count, and a
 * caller-supplied `right` slot) and nothing else. Composing groups into a full
 * panel is the consumer's job — there is intentionally no "panel" component here.
 */

type GroupCtx = { kind: ModelKind };
const Ctx = createContext<GroupCtx | null>(null);
const useGroup = (part: string): GroupCtx => {
  const v = useContext(Ctx);
  if (!v) throw new Error(`<ModelGroup.${part}> must be used inside <ModelGroup>`);
  return v;
};

function Root({ kind, children, className }: { kind: ModelKind; children: ReactNode; className?: string }) {
  return (
    <Ctx.Provider value={{ kind }}>
      <section className={cn('flex flex-col gap-2', className)}>{children}</section>
    </Ctx.Provider>
  );
}

/** Section header: kind label + optional count + a caller-supplied right slot (e.g. an add control). */
function Header({ count, right }: { count?: number; right?: ReactNode }) {
  const { kind } = useGroup('Header');
  return (
    <div className="flex items-center gap-2 px-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-section text-fg-dim">
        {KIND_LABEL[kind].group}
      </span>
      {count != null && <CountBadge>{count}</CountBadge>}
      {right && <div className="ml-auto">{right}</div>}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border-default px-3 py-4 text-center text-[11px] text-fg-dim">
      {children}
    </div>
  );
}

export const ModelGroup = Object.assign(Root, { Header, Empty });
