import { Section } from './Section';
import { useVersionImages } from './store';

/**
 * Civitai has no structured "recommended settings" field — they're usually
 * buried in the description prose. As a useful approximation we surface the
 * params from a representative gallery image as the version's typical settings.
 * The images come from the Images API (via `useVersionImages`), which keeps
 * each image's `meta`; the `models/:id` payload strips it.
 */
export function RecommendedSettings() {
  const images = useVersionImages();
  const meta = images.find((img) => img.meta)?.meta ?? null;
  if (!meta) return null;

  const cells: { label: string; value: string }[] = [
    { label: 'CFG scale', value: meta.cfgScale != null ? String(meta.cfgScale) : '—' },
    { label: 'Steps', value: meta.steps != null ? String(meta.steps) : '—' },
    { label: 'Sampler', value: meta.sampler ?? '—' },
  ];

  return (
    <Section label="Typical settings">
      <div className="grid grid-cols-3 gap-2">
        {cells.map((c) => (
          <div key={c.label} className="rounded-lg border border-border-default bg-bg-card px-2.5 py-1.5">
            <div className="truncate text-[12px] font-semibold text-fg-secondary">{c.value}</div>
            <div className="text-[9px] font-medium text-fg-dim">{c.label}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}
