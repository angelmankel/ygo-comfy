import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import {
  BUILT_IN_THEMES, COLOR_FIELDS, ICON_STYLES, resolveTheme,
  derivePalette, baseFromColors,
} from '@/lib/themes';
import type { Theme, ThemeColors, IconStyle, ThemeBase } from '@/lib/themes';
import { CopyIcon, CheckIcon, TrashIcon, ChevronDownIcon, ChevronRightIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

/**
 * Theme picker:
 *   - Grid of all built-in + custom themes (selectable).
 *   - Fork-active-into-custom action.
 *   - Quick editor: 4 base colors (Background, Text, Accent, Border) that derive
 *     the full 21-color palette via `derivePalette`. Enough for 95% of edits.
 *   - Advanced palette: collapsed by default. Direct access to all 21 fields if
 *     the user wants pixel-level control.
 */

const FONT_PRESETS = [
  { value: 'Inter',              generic: 'sans-serif' as const },
  { value: 'Manrope',            generic: 'sans-serif' as const },
  { value: 'Space Grotesk',      generic: 'sans-serif' as const },
  { value: 'Outfit',             generic: 'sans-serif' as const },
  { value: 'DM Sans',            generic: 'sans-serif' as const },
  { value: 'Lexend',             generic: 'sans-serif' as const },
  { value: 'Plus Jakarta Sans',  generic: 'sans-serif' as const },
  { value: 'Cormorant Garamond', generic: 'serif' as const },
  { value: 'Playfair Display',   generic: 'serif' as const },
  { value: 'IBM Plex Serif',     generic: 'serif' as const },
  { value: 'Merriweather',       generic: 'serif' as const },
  { value: 'JetBrains Mono',     generic: 'monospace' as const },
  { value: 'IBM Plex Mono',      generic: 'monospace' as const },
  { value: 'Fira Code',          generic: 'monospace' as const },
];

export function ThemeTab() {
  const themeId = useStore(s => s.themeId);
  const customThemes = useStore(s => s.customThemes);
  const setThemeId = useStore(s => s.setThemeId);
  const createCustomTheme = useStore(s => s.createCustomTheme);
  const deleteCustomTheme = useStore(s => s.deleteCustomTheme);

  const allThemes = useMemo(() => [...BUILT_IN_THEMES, ...customThemes], [customThemes]);
  const active = resolveTheme(themeId, customThemes);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[11px] text-fg-muted">
        Pick a built-in for a one-click look, or fork one to get a quick editor —
        change 4 base colors and the rest of the palette is derived automatically.
      </p>

      <div className="grid grid-cols-2 gap-2">
        {allThemes.map(t => (
          <ThemeCard
            key={t.id}
            theme={t}
            active={t.id === themeId}
            onSelect={() => setThemeId(t.id)}
            onDelete={t.builtIn ? undefined : () => deleteCustomTheme(t.id)}
          />
        ))}
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border-default bg-bg-input px-3 py-2">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-fg-secondary">
            {active.name}
            {active.builtIn && (
              <span className="ml-1.5 rounded bg-bg-elev px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-tag text-fg-tertiary">
                Built-in
              </span>
            )}
          </div>
          <div className="text-[10.5px] text-fg-muted">{active.blurb}</div>
        </div>
        <button
          type="button"
          onClick={() => createCustomTheme(active.id, `${active.name} (custom)`)}
          className="flex shrink-0 items-center gap-1 rounded-md border border-border-default bg-bg-elev px-2.5 py-1.5 text-[11px] font-semibold text-fg-secondary hover:border-border-strong"
          title="Fork this theme into an editable custom theme"
        >
          <CopyIcon size={12} /> Fork
        </button>
      </div>

      {!active.builtIn && <CustomThemeEditor theme={active} />}
    </div>
  );
}

function ThemeCard({
  theme, active, onSelect, onDelete,
}: {
  theme: Theme;
  active: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}) {
  const c = theme.colors;
  return (
    <div className={cn(
      'group relative flex flex-col gap-1.5 rounded-lg border p-2 text-left transition-colors',
      active ? 'border-accent bg-accent-soft/30' : 'border-border-default bg-bg-input hover:border-border-strong',
    )}>
      <button type="button" onClick={onSelect} className="flex flex-col gap-1.5 text-left">
        <div className="flex h-12 items-center gap-1 rounded border px-1.5" style={{ background: c.bgPanel, borderColor: c.borderDefault }}>
          <div className="h-7 w-7 shrink-0 rounded" style={{ background: c.bgElev, border: `1px solid ${c.borderDefault}` }} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="h-1.5 w-3/4 rounded-full" style={{ background: c.fgSecondary, opacity: 0.85 }} />
            <div className="h-1.5 w-1/2 rounded-full" style={{ background: c.fgMuted, opacity: 0.85 }} />
          </div>
          <div className="h-5 w-5 shrink-0 rounded" style={{ background: c.accent }} />
        </div>
        <div className="flex items-center gap-1.5">
          {active && <CheckIcon size={12} className="text-accent-fg" />}
          <div className={cn('text-[12px] font-semibold', active ? 'text-accent-fg' : 'text-fg-secondary')}>
            {theme.name}
          </div>
        </div>
        <div className="line-clamp-1 text-[10px] text-fg-muted">{theme.font} · {theme.iconStyle}</div>
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${theme.name}`}
          title="Delete custom theme"
          className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded border border-transparent text-fg-dim opacity-0 transition-opacity hover:border-status-err hover:text-status-err group-hover:opacity-100"
        >
          <TrashIcon size={10} />
        </button>
      )}
    </div>
  );
}

function CustomThemeEditor({ theme }: { theme: Theme }) {
  const update = useStore(s => s.updateCustomTheme);
  const [name, setName] = useState(theme.name);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  useEffect(() => { setName(theme.name); }, [theme.name, theme.id]);

  const fontPreset = FONT_PRESETS.find(p => p.value === theme.font);

  const setBase = (patch: Partial<ThemeBase>) => {
    const current = baseFromColors(theme.colors);
    update(theme.id, { colors: derivePalette({ ...current, ...patch }) });
  };
  const setColor = (k: keyof ThemeColors, v: string) => {
    update(theme.id, { colors: { ...theme.colors, [k]: v } });
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-default bg-bg-input/40 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-section text-fg-tertiary">
        Edit custom theme
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[10.5px] text-fg-muted">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => { if (name.trim() && name !== theme.name) update(theme.id, { name }); else setName(theme.name); }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          className="rounded border border-border-default bg-bg-input px-2 py-1 text-[12px] text-fg-secondary outline-none focus:border-accent"
        />
      </label>

      {/* Quick editor — 4 base colors derive the full 21-color palette */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline gap-2">
          <span className="text-[10.5px] text-fg-muted">Palette</span>
          <span className="text-[9.5px] text-fg-dim">— change one of these to re-derive the rest</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <BaseColorField label="Background"  value={theme.colors.bgBase}        onChange={(v) => setBase({ background: v })} />
          <BaseColorField label="Text"        value={theme.colors.fgPrimary}     onChange={(v) => setBase({ text: v })} />
          <BaseColorField label="Accent"      value={theme.colors.accent}        onChange={(v) => setBase({ accent: v })} />
          <BaseColorField label="Border"      value={theme.colors.borderDefault} onChange={(v) => setBase({ border: v })} />
        </div>
        <ThemePreview colors={theme.colors} fontFamily={theme.font} fontGeneric={theme.fontGeneric} />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[10.5px] text-fg-muted">Font</span>
        <div className="flex gap-1.5">
          <select
            value={fontPreset ? theme.font : '__custom__'}
            onChange={(e) => {
              const val = e.target.value;
              if (val === '__custom__') return;
              const preset = FONT_PRESETS.find(p => p.value === val)!;
              update(theme.id, { font: preset.value, fontGeneric: preset.generic });
            }}
            className="min-w-0 flex-1 rounded border border-border-default bg-bg-input px-2 py-1 text-[12px] text-fg-secondary outline-none focus:border-accent"
          >
            {FONT_PRESETS.map(p => <option key={p.value} value={p.value}>{p.value}</option>)}
            {!fontPreset && <option value="__custom__">{theme.font} (custom)</option>}
          </select>
          <input
            value={theme.font}
            onChange={(e) => update(theme.id, { font: e.target.value })}
            placeholder="Any Google Fonts family"
            spellCheck={false}
            className="w-[180px] rounded border border-border-default bg-bg-input px-2 py-1 font-mono text-[11px] text-fg-secondary outline-none focus:border-accent"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[10.5px] text-fg-muted">Icon style</span>
        <div className="grid grid-cols-4 gap-1">
          {ICON_STYLES.map(s => (
            <IconStyleButton
              key={s.value}
              value={s.value}
              label={s.label}
              hint={s.hint}
              active={theme.iconStyle === s.value}
              onSelect={() => update(theme.id, { iconStyle: s.value })}
            />
          ))}
        </div>
      </div>

      {/* Advanced: full 21-color palette. Collapsed by default — the quick
          editor covers the common case, and exposing all 21 by default was
          the source of "too tedious to change". */}
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => setAdvancedOpen(o => !o)}
          className="flex items-center gap-1 text-[10.5px] text-fg-muted hover:text-fg-secondary"
        >
          {advancedOpen ? <ChevronDownIcon size={10} /> : <ChevronRightIcon size={10} />}
          Advanced palette — every color, individually
        </button>
        {advancedOpen && <AdvancedPalette theme={theme} setColor={setColor} />}
      </div>
    </div>
  );
}

function BaseColorField({
  label, value, onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded border border-border-default bg-bg-input px-2 py-1.5">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className="h-7 w-9 shrink-0 cursor-pointer rounded border border-border-default bg-transparent p-0"
        aria-label={`${label} color`}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[11px] font-semibold text-fg-secondary">{label}</span>
        <span className="font-mono text-[10px] text-fg-dim">{value.toUpperCase()}</span>
      </div>
    </label>
  );
}

/** Small live preview that shows how the derived palette looks in practice —
 *  panel surface, text ramp, an accent button, an accent-soft chip. */
function ThemePreview({ colors, fontFamily, fontGeneric }: {
  colors: ThemeColors;
  fontFamily: string;
  fontGeneric: 'sans-serif' | 'serif' | 'monospace';
}) {
  return (
    <div
      className="rounded-md border p-2.5"
      style={{
        background: colors.bgPanel,
        borderColor: colors.borderDefault,
        fontFamily: `"${fontFamily}", ${fontGeneric}`,
      }}
    >
      <div className="flex items-center gap-2">
        <div className="flex flex-col">
          <span className="text-[12px] font-semibold" style={{ color: colors.fgPrimary }}>
            Primary text
          </span>
          <span className="text-[10.5px]" style={{ color: colors.fgMuted }}>
            Muted secondary line
          </span>
        </div>
        <span
          className="ml-auto rounded px-2 py-0.5 text-[10px] font-semibold"
          style={{ background: colors.accentSoft, color: colors.accentFg }}
        >
          chip
        </span>
        <button
          type="button"
          className="rounded px-2.5 py-1 text-[11px] font-semibold"
          style={{ background: colors.accent, color: '#FFF' }}
        >
          Action
        </button>
      </div>
    </div>
  );
}

function AdvancedPalette({ theme, setColor }: {
  theme: Theme;
  setColor: (k: keyof ThemeColors, v: string) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, typeof COLOR_FIELDS>();
    for (const f of COLOR_FIELDS) {
      const arr = map.get(f.group) ?? [];
      arr.push(f);
      map.set(f.group, arr);
    }
    return [...map.entries()];
  }, []);
  return (
    <div className="flex flex-col gap-2 pt-2">
      {grouped.map(([group, fields]) => (
        <div key={group} className="flex flex-col gap-1">
          <div className="text-[9.5px] font-semibold uppercase tracking-tag text-fg-dim">{group}</div>
          <div className="grid grid-cols-2 gap-1.5">
            {fields.map(f => (
              <ColorField
                key={f.key}
                label={f.label}
                value={theme.colors[f.key]}
                onChange={(v) => setColor(f.key, v)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function IconStyleButton({
  value, label, hint, active, onSelect,
}: {
  value: IconStyle;
  label: string;
  hint: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={hint}
      aria-pressed={active}
      className={cn(
        'rounded border px-2 py-1.5 text-left transition-colors',
        active
          ? 'border-accent bg-accent-soft text-accent-fg'
          : 'border-border-default bg-bg-input text-fg-tertiary hover:border-border-strong',
      )}
    >
      <div className="text-[11px] font-semibold">{label}</div>
      <div className="text-[9.5px] text-fg-dim">{value}</div>
    </button>
  );
}

function ColorField({
  label, value, onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded border border-border-default bg-bg-input px-1.5 py-1">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className="h-6 w-7 shrink-0 cursor-pointer rounded border border-border-default bg-transparent p-0"
        aria-label={`${label} color`}
      />
      <span className="min-w-0 flex-1 truncate text-[10.5px] text-fg-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="w-[72px] shrink-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-right font-mono text-[10px] text-fg-tertiary outline-none focus:border-border-default"
      />
    </label>
  );
}
