import { useState, useEffect } from 'react';
import { useBrowserStore, type BrowserFilters, BROWSING_LEVEL_BITS } from './store';
import { cn } from '@/lib/cn';
import type { CivitaiSearchType, CivitaiSearchSort, CivitaiSearchPeriod } from '@/lib/civitai';
import { Switch } from '@/components/ui/Switch';

const TYPE_OPTIONS: { id: CivitaiSearchType; label: string }[] = [
  { id: 'Checkpoint',       label: 'Checkpoint' },
  { id: 'LORA',             label: 'LoRA' },
  { id: 'TextualInversion', label: 'Embedding' },
  { id: 'VAE',              label: 'VAE' },
  { id: 'Controlnet',       label: 'ControlNet' },
  { id: 'Upscaler',         label: 'Upscaler' },
];

// CivitAI's `baseModels` filter takes label strings exactly — we mirror their
// values (with spaces / casing) so the API accepts them. The first cluster
// here covers ~90% of what an SDXL-focused user will hit; the secondary
// cluster covers the rest.
const BASE_MODELS: string[] = [
  'SD 1.5', 'SD 2.1', 'SDXL 1.0', 'Pony', 'Illustrious',
  'NoobAI', 'Flux.1 D', 'Flux.1 S', 'SD 3', 'SD 3.5',
];

const SORT_OPTIONS: CivitaiSearchSort[] = [
  'Highest Rated', 'Most Downloaded', 'Most Liked', 'Newest',
];

const PERIOD_OPTIONS: CivitaiSearchPeriod[] = ['AllTime', 'Year', 'Month', 'Week', 'Day'];

/** CivitAI's rating ladder, in the order users expect to see them. */
const RATING_OPTIONS: { label: string; bit: number }[] = [
  { label: 'G',     bit: BROWSING_LEVEL_BITS.G },
  { label: 'PG',    bit: BROWSING_LEVEL_BITS.PG },
  { label: 'PG-13', bit: BROWSING_LEVEL_BITS.PG13 },
  { label: 'R',     bit: BROWSING_LEVEL_BITS.R },
  { label: 'X',     bit: BROWSING_LEVEL_BITS.X },
  { label: 'XXX',   bit: BROWSING_LEVEL_BITS.XXX },
];

/** Left filter rail. All chip toggles route through the store's `setFilters`
 *  which kicks a refresh; the search box debounces 350ms so each keystroke
 *  doesn't fire a request. */
export function BrowserFiltersRail({ filters }: { filters: BrowserFilters }) {
  const setFilters = useBrowserStore((s) => s.setFilters);

  // Local mirror for the search input so typing is instant; commit on debounce.
  const [searchDraft, setSearchDraft] = useState(filters.query);
  useEffect(() => { setSearchDraft(filters.query); }, [filters.query]);
  useEffect(() => {
    if (searchDraft === filters.query) return;
    const t = setTimeout(() => setFilters({ query: searchDraft.trim() }), 350);
    return () => clearTimeout(t);
  }, [searchDraft, filters.query, setFilters]);

  const toggleType = (id: CivitaiSearchType) => {
    const has = filters.types.includes(id);
    setFilters({ types: has ? filters.types.filter((t) => t !== id) : [...filters.types, id] });
  };
  const toggleBase = (b: string) => {
    const has = filters.baseModels.includes(b);
    setFilters({ baseModels: has ? filters.baseModels.filter((x) => x !== b) : [...filters.baseModels, b] });
  };
  const toggleRating = (bit: number) => {
    const next = (filters.browsingLevels & bit) ? filters.browsingLevels & ~bit : filters.browsingLevels | bit;
    setFilters({ browsingLevels: next });
  };

  return (
    <aside className="flex w-[220px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-border-subtle bg-bg-panel/60 px-3 py-4">
      <Group label="Catalog">
        <div className="flex rounded-md border border-border-default bg-bg-input p-0.5">
          <CatalogTab
            active={filters.catalog === 'civitai'}
            onClick={() => setFilters({ catalog: 'civitai' })}
          >
            Civitai
          </CatalogTab>
          <CatalogTab
            active={filters.catalog === 'red'}
            onClick={() => setFilters({ catalog: 'red' })}
            title="civitai.red — full adult catalog"
          >
            Civitai Red
          </CatalogTab>
        </div>
      </Group>

      <Group label="Search">
        <input
          type="text"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          placeholder="Name, tag, creator…"
          spellCheck={false}
          className="min-h-[34px] w-full rounded-md border border-border-default bg-bg-input px-2.5 text-[12px] text-fg-secondary placeholder:text-fg-dim outline-none hover:border-border-strong focus:border-accent"
        />
      </Group>

      <Group label="Type">
        <ChipRow>
          {TYPE_OPTIONS.map((t) => (
            <Chip key={t.id} active={filters.types.includes(t.id)} onClick={() => toggleType(t.id)}>
              {t.label}
            </Chip>
          ))}
        </ChipRow>
      </Group>

      <Group label="Base model">
        <ChipRow>
          {BASE_MODELS.map((b) => (
            <Chip key={b} active={filters.baseModels.includes(b)} onClick={() => toggleBase(b)}>
              {b}
            </Chip>
          ))}
        </ChipRow>
      </Group>

      <Group label="Rating">
        <ChipRow>
          {RATING_OPTIONS.map((r) => (
            <Chip key={r.bit} active={(filters.browsingLevels & r.bit) !== 0} onClick={() => toggleRating(r.bit)}>
              {r.label}
            </Chip>
          ))}
        </ChipRow>
      </Group>

      <Group label="Sort">
        <select
          value={filters.sort}
          onChange={(e) => setFilters({ sort: e.target.value as CivitaiSearchSort })}
          className="min-h-[34px] w-full rounded-md border border-border-default bg-bg-input px-2.5 text-[12px] text-fg-secondary outline-none hover:border-border-strong focus:border-accent"
        >
          {SORT_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Group>

      <Group label="Period">
        <select
          value={filters.period}
          onChange={(e) => setFilters({ period: e.target.value as CivitaiSearchPeriod })}
          className="min-h-[34px] w-full rounded-md border border-border-default bg-bg-input px-2.5 text-[12px] text-fg-secondary outline-none hover:border-border-strong focus:border-accent"
        >
          {PERIOD_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </Group>

      {/* On the Red catalog NSFW is implied — the store forces nsfw=true on
          the request so per-model preview galleries return their adult
          samples. Hiding the toggle keeps the UI honest. */}
      {filters.catalog !== 'red' && (
        <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-elev/40 px-2.5 py-2">
          <Switch
            size="sm"
            checked={filters.showNsfw}
            onCheckedChange={(on) => setFilters({ showNsfw: on })}
            ariaLabel="Show NSFW results"
          />
          <span className="text-[12px] text-fg-tertiary">Show NSFW</span>
        </div>
      )}
    </aside>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="px-0.5 text-[10px] font-semibold uppercase tracking-section text-fg-dim">{label}</div>
      {children}
    </div>
  );
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>;
}

function CatalogTab({
  active, onClick, title, children,
}: { active: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        'flex-1 rounded px-2 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'bg-accent-soft text-accent-fg'
          : 'text-fg-tertiary hover:text-fg-secondary',
      )}
    >
      {children}
    </button>
  );
}

function Chip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'border-accent bg-accent-soft text-accent-fg'
          : 'border-border-default bg-bg-elev/50 text-fg-tertiary hover:border-border-strong hover:text-fg-secondary',
      )}
    >
      {children}
    </button>
  );
}
