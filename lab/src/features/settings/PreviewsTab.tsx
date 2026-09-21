import { useStore } from '@/lib/store';
import { PREVIEW_SOURCES } from '@/lib/storage';
import { cn } from '@/lib/cn';

/**
 * Previews — which image the model-picker hover slideshow starts on. Setting
 * persists to localStorage (`imagelab.previewSource.v1`) so it survives
 * refreshes.
 */
export function PreviewsTab() {
  const previewSource = useStore(s => s.modelPreviewSource);
  const setPreviewSource = useStore(s => s.setModelPreviewSource);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-fg-muted">
        How the model picker's hover slideshow chooses its first image and orders
        the rest. The slideshow auto-advances and cross-fades through every
        CivitAI image (and any local generations you've made with that model).
      </p>

      <div className="flex flex-col gap-1.5">
        {PREVIEW_SOURCES.map(opt => {
          const active = previewSource === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setPreviewSource(opt.value)}
              className={cn(
                'flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors',
                active ? 'border-accent bg-accent-soft/40' : 'border-border-default bg-bg-input hover:border-border-strong',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                  active ? 'border-accent bg-accent' : 'border-border-strong bg-bg-base',
                )}
              >
                {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn('block text-[12.5px] font-semibold', active ? 'text-accent-fg' : 'text-fg-secondary')}>
                  {opt.label}
                </span>
                <span className="block text-[10.5px] text-fg-muted">{opt.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
