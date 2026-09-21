import { useEffect, useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import * as RDialog from '@radix-ui/react-dialog';
import {
  CloseIcon, SearchIcon,
  ComfyIcon, SettingsIcon, SparkleIcon, ImagePlaceholderIcon,
} from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import { ServersTab } from './ServersTab';
import { VeniceTab } from './VeniceTab';
import { CivitaiTab } from './CivitaiTab';
import { PreviewsTab } from './PreviewsTab';
import { ThemeTab } from './ThemeTab';

type Props = { open: boolean; onOpenChange: (o: boolean) => void };

/* ────────────────────────────────────────────────────────────────────────
   Section registry — single source of truth. Add a new pane by appending
   one entry: an id, label, icon, search keywords, and the component to
   render. Tab components are self-contained — they read what they need
   from the store and never touch the shell.
   ──────────────────────────────────────────────────────────────────────── */

type SectionDef = {
  id: string;
  label: string;
  blurb: string;
  keywords: string[];
  Icon: ComponentType<{ size?: number; className?: string }>;
  Component: ComponentType;
};

const SETTINGS_SECTIONS: SectionDef[] = [
  {
    id: 'servers',
    label: 'Servers',
    blurb: 'ComfyUI endpoints — every parameter, prompt and history is shared across them.',
    keywords: ['server', 'comfyui', 'endpoint', 'host', 'lan', 'routing'],
    Icon: ComfyIcon,
    Component: ServersTab,
  },
  {
    id: 'ai',
    label: 'AI / Venice',
    blurb: 'API key + model used by the snippet library, tagging, and image-to-prompt.',
    keywords: ['venice', 'ai', 'api', 'llm', 'prompt', 'brainstorm', 'tag'],
    Icon: SparkleIcon,
    Component: VeniceTab,
  },
  {
    id: 'civitai',
    label: 'CivitAI',
    blurb: 'Bearer token for the model browser. Required for the full Civitai Red catalog.',
    keywords: ['civitai', 'red', 'token', 'api', 'key', 'auth', 'browser', 'adult', 'nsfw'],
    Icon: ImagePlaceholderIcon,
    Component: CivitaiTab,
  },
  {
    id: 'previews',
    label: 'Previews',
    blurb: 'How the model-picker hover slideshow orders its images.',
    keywords: ['preview', 'slideshow', 'civitai', 'model', 'image', 'random'],
    Icon: ImagePlaceholderIcon,
    Component: PreviewsTab,
  },
  {
    id: 'theme',
    label: 'Theme',
    blurb: 'Font, icon weight, and the full color palette. Fork any theme to edit.',
    keywords: ['theme', 'color', 'palette', 'font', 'icon', 'dark', 'light', 'custom'],
    Icon: SettingsIcon,
    Component: ThemeTab,
  },
];

/**
 * Settings shell — fixed-size landscape modal, searchable left rail, and an
 * independently scrolling content pane. Long content (Theme/Fork) scrolls
 * vertically inside the pane while the chrome stays put.
 */
export function SettingsModal({ open, onOpenChange }: Props) {
  const [activeId, setActiveId] = useState<string>(SETTINGS_SECTIONS[0].id);
  const [query, setQuery] = useState('');

  // Reset to a clean state every time the modal is reopened so users don't
  // land on a stale section (or a search query from last time).
  useEffect(() => {
    if (open) { setActiveId(SETTINGS_SECTIONS[0].id); setQuery(''); }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SETTINGS_SECTIONS;
    return SETTINGS_SECTIONS.filter(s =>
      s.label.toLowerCase().includes(q)
      || s.blurb.toLowerCase().includes(q)
      || s.keywords.some(k => k.includes(q))
    );
  }, [query]);

  // Keep the rendered section in sync with the search: if the user types a
  // query that filters out the active section, jump to the first match.
  useEffect(() => {
    if (filtered.length === 0) return;
    if (!filtered.some(s => s.id === activeId)) setActiveId(filtered[0].id);
  }, [filtered, activeId]);

  const active = SETTINGS_SECTIONS.find(s => s.id === activeId) ?? SETTINGS_SECTIONS[0];
  const ActiveComponent = active.Component;
  const ActiveIcon = active.Icon;

  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-20 bg-black/55 data-[state=open]:animate-in data-[state=open]:fade-in" />
        <RDialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2',
            'flex h-[min(86vh,640px)] w-[min(96vw,960px)] flex-col overflow-hidden',
            'rounded-xl border border-border-strong bg-bg-elev text-fg-secondary shadow-2xl outline-none',
          )}
        >
          <RDialog.Title className="sr-only">Settings</RDialog.Title>

          <header className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-4 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-section text-fg-tertiary">
              Settings
            </span>
            <span className="text-fg-dim">·</span>
            <span className="text-[12px] font-semibold text-fg-secondary">{active.label}</span>
            <div className="flex-1" />
            <RDialog.Close
              aria-label="Close"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border-default bg-bg-elev text-fg-muted hover:border-border-strong hover:text-fg-secondary"
            >
              <CloseIcon size={14} />
            </RDialog.Close>
          </header>

          <div className="flex min-h-0 flex-1">
            <nav className="flex w-[220px] shrink-0 flex-col gap-2 border-r border-border-subtle bg-bg-panel/40 px-2 py-2.5">
              <div className="relative px-1">
                <SearchIcon size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-dim" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search settings…"
                  className="w-full rounded-md border border-border-default bg-bg-input pl-7 pr-2 py-1.5 text-[12px] text-fg-secondary outline-none placeholder:text-fg-dim focus:border-accent"
                  aria-label="Search settings"
                />
              </div>
              <ul role="tablist" className="scroll-y flex min-h-0 flex-1 flex-col gap-0.5 px-1">
                {filtered.map(s => {
                  const isActive = s.id === active.id;
                  const Icon = s.Icon;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => setActiveId(s.id)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors',
                          isActive
                            ? 'bg-accent text-white'
                            : 'text-fg-tertiary hover:bg-bg-elev hover:text-fg-secondary',
                        )}
                      >
                        <Icon size={14} className={isActive ? 'text-white' : 'text-fg-muted'} />
                        <span className="min-w-0 flex-1 truncate font-semibold">{s.label}</span>
                      </button>
                    </li>
                  );
                })}
                {filtered.length === 0 && (
                  <li className="px-2 py-3 text-center text-[11px] text-fg-dim">No matches</li>
                )}
              </ul>
            </nav>

            <main className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle px-5 py-3">
                <ActiveIcon size={16} className="text-fg-muted" />
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-fg-primary">{active.label}</div>
                  <div className="truncate text-[11px] text-fg-muted">{active.blurb}</div>
                </div>
              </div>
              <div className="scroll-y min-h-0 flex-1 px-5 py-4">
                <ActiveComponent />
              </div>
            </main>
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
