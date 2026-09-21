import { useState } from 'react';
import { useStore } from '@/lib/store';
import { VENICE_DEFAULT_MODEL, VENICE_DEFAULT_BASE_URL, type PromptStyle } from '@/lib/storage';
import { FieldGroup } from './FieldGroup';
import { cn } from '@/lib/cn';

type StyleOption = { id: PromptStyle; label: string; blurb: string };

const STYLE_OPTIONS: StyleOption[] = [
  {
    id: 'sdxl',
    label: 'Generic SDXL',
    blurb: 'Comma-separated natural-language phrases. Works with most SDXL / Pony / Flux checkpoints.',
  },
  {
    id: 'illustrious',
    label: 'Illustrious / Danbooru',
    blurb: 'Danbooru tag syntax (underscores, escaped parens) plus the `masterpiece, best quality` opener — follows Arctenox\'s Illustrious guide.',
  },
];

/**
 * Venice AI — uncensored chat-completion provider used by the Snippet
 * Library's "improve / expand / brainstorm" actions and the Collections
 * AI tools. Stored locally; never leaves the browser except via direct
 * calls to api.venice.ai.
 */
export function VeniceTab() {
  const venice = useStore(s => s.venice);
  const setVenice = useStore(s => s.setVenice);
  const [showKey, setShowKey] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[11px] text-fg-muted">
        Venice AI provides uncensored, privacy-respecting chat completions. The Snippet
        Library uses it to brainstorm new ideas, expand or tighten prompts, and improve
        wording. Your API key is stored in this browser only — calls go directly to
        Venice from your tab.
      </p>

      <FieldGroup title="API key">
        <div className="flex items-stretch gap-1.5">
          <input
            type={showKey ? 'text' : 'password'}
            value={venice.apiKey}
            onChange={(e) => setVenice({ apiKey: e.target.value })}
            placeholder="vn-…"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            className="min-w-0 flex-1 rounded border border-border-default bg-bg-input px-2 py-1 font-mono text-[11px] text-fg-secondary outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => setShowKey(s => !s)}
            className="shrink-0 rounded border border-border-default bg-bg-elev px-2 text-[10px] font-semibold uppercase tracking-tag text-fg-tertiary hover:border-border-strong hover:text-fg-secondary"
          >
            {showKey ? 'Hide' : 'Show'}
          </button>
        </div>
        <p className="text-[10.5px] text-fg-dim">
          Get a key at{' '}
          <a href="https://venice.ai/settings/api" target="_blank" rel="noreferrer" className="text-accent-fg hover:underline">
            venice.ai/settings/api
          </a>
          {' '}·{' '}
          <a href="https://docs.venice.ai/overview/getting-started" target="_blank" rel="noreferrer" className="text-accent-fg hover:underline">
            docs
          </a>
        </p>
      </FieldGroup>

      <FieldGroup title="Model">
        <input
          value={venice.model}
          onChange={(e) => setVenice({ model: e.target.value })}
          placeholder={VENICE_DEFAULT_MODEL}
          spellCheck={false}
          className="rounded border border-border-default bg-bg-input px-2 py-1 font-mono text-[11px] text-fg-secondary outline-none focus:border-accent"
        />
        <p className="text-[10.5px] text-fg-dim">
          Default: <code className="font-mono">{VENICE_DEFAULT_MODEL}</code>. Any Venice
          chat model id works (e.g. <code className="font-mono">llama-3.3-70b</code>).
        </p>
      </FieldGroup>

      <FieldGroup title="Prompt style">
        <div className="flex flex-col gap-1.5">
          {STYLE_OPTIONS.map(opt => {
            const active = venice.promptStyle === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setVenice({ promptStyle: opt.id })}
                className={cn(
                  'flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left transition-colors',
                  active
                    ? 'border-accent bg-accent-soft/60'
                    : 'border-border-default bg-bg-input hover:border-border-strong',
                )}
              >
                <span className={cn(
                  'flex items-center gap-2 text-[12.5px] font-semibold',
                  active ? 'text-accent-fg' : 'text-fg-primary',
                )}>
                  <span
                    aria-hidden
                    className={cn(
                      'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border',
                      active ? 'border-accent bg-accent' : 'border-border-strong bg-bg-input',
                    )}
                  >
                    {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                  </span>
                  {opt.label}
                </span>
                <span className="pl-[22px] text-[10.5px] leading-snug text-fg-muted">
                  {opt.blurb}
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-[10.5px] text-fg-dim">
          Applied to every AI helper: generate, expand / shorten / improve, brainstorm, per-layer tweak, and image → prompt.
        </p>
      </FieldGroup>

      <FieldGroup title="Base URL (advanced)">
        <input
          value={venice.baseUrl}
          onChange={(e) => setVenice({ baseUrl: e.target.value })}
          placeholder={VENICE_DEFAULT_BASE_URL}
          spellCheck={false}
          className="rounded border border-border-default bg-bg-input px-2 py-1 font-mono text-[11px] text-fg-secondary outline-none focus:border-accent"
        />
        <p className="text-[10.5px] text-fg-dim">
          Leave empty to use the default. Any OpenAI-compatible endpoint will work
          if you prefer a different provider.
        </p>
      </FieldGroup>
    </div>
  );
}
