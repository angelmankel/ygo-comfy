import { useState } from 'react';
import type { CivitaiImage } from './civitai';
import { useStore } from '@/lib/store';
import { CIVITAI_CATEGORY_ID } from '@/lib/storage';
import { cn } from '@/lib/cn';
import { CopyIcon, StarIcon, CheckIcon } from '@/components/ui/icons';

/**
 * The selected gallery image's generation parameters — Civitai's `image.meta`
 * (prompt, sampler, steps, CFG, seed). The prompt takes the slack at the top
 * and scrolls; below it the params are a vertical, single-column list of
 * clickable rows that apply each value to the active workflow on tap.
 *
 * The prompt has its own "save to library" action that creates a snippet
 * under the Civit.ai category (the category is created on demand).
 */
export function GenerationSettings({
  image,
  onCollapse,
}: {
  image: CivitaiImage | null;
  onCollapse?: () => void;
}) {
  const meta = image?.meta ?? null;
  const setWorkflow = useStore((s) => s.setWorkflow);
  const setStatus = useStore((s) => s.setStatus);
  const addSnippet = useStore((s) => s.addSnippet);
  const snippetCategories = useStore((s) => s.snippetCategories);
  const addSnippetCategory = useStore((s) => s.addSnippetCategory);

  const copyAll = () => {
    if (!meta) return;
    navigator.clipboard?.writeText(JSON.stringify(meta, null, 2)).catch(() => { /* clipboard unavailable */ });
  };

  const applyPatch = (patch: Parameters<typeof setWorkflow>[0], label: string) => {
    setWorkflow(patch);
    setStatus(`Applied ${label}`, 'ok');
  };

  const ensureCivitaiCategory = (): string => {
    if (snippetCategories.some((c) => c.id === CIVITAI_CATEGORY_ID)) return CIVITAI_CATEGORY_ID;
    return addSnippetCategory('Civit.ai', '🅒');
  };

  const saveAsSnippet = () => {
    const prompt = meta?.prompt?.trim();
    if (!prompt) return;
    const categoryId = ensureCivitaiCategory();
    // Derive a short, readable name from the first few words.
    const name = prompt.split(/[,\n]/)[0]?.trim().slice(0, 60) || 'Civit.ai prompt';
    addSnippet({
      name,
      tag: 'Civit.ai',
      text: prompt,
      weight: 1,
      kind: 'positive',
      categoryId,
    });
    setStatus(`Saved snippet to Civit.ai library`, 'ok');
  };

  return (
    <div className="flex h-full flex-col gap-3 rounded-lg border border-border-default bg-bg-card p-3.5">
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-section text-fg-dim">
          Generation settings
        </span>
        <div className="flex-1" />
        {meta && (
          <button
            type="button"
            onClick={copyAll}
            className="flex items-center gap-1 rounded border border-border-default bg-bg-elev px-2 py-1 text-[11px] font-medium text-fg-tertiary transition-colors hover:text-fg-secondary"
          >
            <CopyIcon size={12} /> Copy
          </button>
        )}
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Hide generation settings"
            title="Hide generation settings"
            className="flex h-[24px] w-[24px] items-center justify-center rounded border border-border-default bg-bg-elev text-[13px] leading-none text-fg-tertiary transition-colors hover:border-border-strong hover:text-fg-secondary"
          >
            ›
          </button>
        )}
      </div>

      {meta ? (
        <>
          {/* Prompt — taller, bigger font, "save as snippet" action. */}
          <div className="flex min-h-0 flex-1 flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium uppercase tracking-section text-fg-dim">Prompt</span>
              <div className="flex-1" />
              {meta.prompt && (
                <button
                  type="button"
                  onClick={saveAsSnippet}
                  title="Save prompt to library under Civit.ai"
                  className="flex items-center gap-1 rounded border border-border-default bg-bg-elev px-2 py-1 text-[10px] font-medium text-fg-tertiary transition-colors hover:border-accent-hover hover:text-accent-fg"
                >
                  <StarIcon size={11} /> Save snippet
                </button>
              )}
            </div>
            {meta.prompt ? (
              <p className="scroll-y min-h-[120px] flex-1 whitespace-pre-wrap rounded-md border border-border-default bg-bg-input px-3 py-2.5 text-[13px] leading-relaxed text-fg-tertiary">
                {meta.prompt}
              </p>
            ) : (
              <div className="flex min-h-[120px] flex-1 items-center justify-center rounded-md border border-border-default bg-bg-input text-[12px] text-fg-dim">
                No prompt recorded
              </div>
            )}
          </div>

          {/* Vertical, single-column param list. Each row is clickable and
              applies its value to the workflow. Sampler is display-only since
              Civitai's names don't always match ComfyUI's options. */}
          <div className="flex shrink-0 flex-col gap-1.5">
            <ParamRow
              label="Sampler"
              value={meta.sampler ?? '—'}
              hint="Click to apply"
              onClick={meta.sampler ? () => applyPatch({ sampler: String(meta.sampler) }, `sampler ${meta.sampler}`) : undefined}
            />
            <ParamRow
              label="Steps"
              value={meta.steps != null ? String(meta.steps) : '—'}
              hint="Click to apply"
              onClick={meta.steps != null ? () => applyPatch({ steps: Number(meta.steps) }, `steps ${meta.steps}`) : undefined}
            />
            <ParamRow
              label="CFG scale"
              value={meta.cfgScale != null ? String(meta.cfgScale) : '—'}
              hint="Click to apply"
              onClick={meta.cfgScale != null ? () => applyPatch({ cfg: Number(meta.cfgScale) }, `CFG ${meta.cfgScale}`) : undefined}
            />
            <ParamRow
              label="Seed"
              value={meta.seed != null ? String(meta.seed) : '—'}
              hint="Click to apply"
              mono
              onClick={meta.seed != null ? () => applyPatch({ seed: Number(meta.seed), randomizeSeed: false }, `seed ${meta.seed}`) : undefined}
            />
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-md border border-border-default bg-bg-input text-[12px] text-fg-dim">
          No generation data for this image.
        </div>
      )}
    </div>
  );
}

function ParamRow({
  label, value, mono, hint, onClick,
}: {
  label: string;
  value: string;
  mono?: boolean;
  hint?: string;
  onClick?: () => void;
}) {
  const [pulse, setPulse] = useState(false);
  const handleClick = () => {
    if (!onClick) return;
    onClick();
    setPulse(true);
    window.setTimeout(() => setPulse(false), 600);
  };
  const disabled = !onClick;
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      title={disabled ? undefined : hint}
      className={cn(
        'group flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors',
        disabled
          ? 'border-border-default bg-bg-input cursor-default'
          : 'border-border-default bg-bg-input hover:border-accent-hover hover:bg-accent-soft/30',
        pulse && 'border-accent bg-accent-soft',
      )}
    >
      <span className="text-[12px] font-medium uppercase tracking-section text-fg-dim">{label}</span>
      <span className="flex items-center gap-1.5">
        {pulse && <CheckIcon size={12} className="text-accent-fg" />}
        <span className={cn('truncate text-[14px] font-semibold', pulse ? 'text-accent-fg' : 'text-fg-secondary', mono && 'font-mono')}>
          {value}
        </span>
      </span>
    </button>
  );
}
