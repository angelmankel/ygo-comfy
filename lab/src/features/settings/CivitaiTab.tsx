import { useState } from 'react';
import { useStore } from '@/lib/store';
import { FieldGroup } from './FieldGroup';

/**
 * CivitAI — browser-side credentials for the model browser and metadata
 * lookups. Distinct from the ImageLab extension's `CIVITAI_TOKEN` env var,
 * which only authenticates downloads server-side. This token is attached as
 * a bearer header on every browser-direct call to civitai.com / civitai.red,
 * and is what unlocks the full adult catalog on the Red side.
 */
export function CivitaiTab() {
  const civitai = useStore(s => s.civitai);
  const setCivitai = useStore(s => s.setCivitai);
  const [showKey, setShowKey] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[11px] text-fg-muted">
        Authenticates the in-app model browser and metadata lookups against CivitAI.
        Required to see the full adult catalog on Civitai Red — unauthed requests get
        a filtered subset. This is separate from the <code className="font-mono">CIVITAI_TOKEN</code>{' '}
        env var on your ComfyUI server, which only handles downloads.
      </p>

      <FieldGroup title="API key">
        <div className="flex items-stretch gap-1.5">
          <input
            type={showKey ? 'text' : 'password'}
            value={civitai.apiKey}
            onChange={(e) => setCivitai({ apiKey: e.target.value })}
            placeholder="civitai api token"
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
          Generate at{' '}
          <a href="https://civitai.com/user/account" target="_blank" rel="noreferrer" className="text-accent-fg hover:underline">
            civitai.com/user/account
          </a>
          {' '}(API Keys section). For the Red catalog, mint the token while signed in to{' '}
          <a href="https://civitai.red/user/account" target="_blank" rel="noreferrer" className="text-accent-fg hover:underline">
            civitai.red
          </a>
          {' '}— some pre-split tokens are not accepted there. Make sure X / XXX browsing
          levels are enabled on the source account.
        </p>
      </FieldGroup>
    </div>
  );
}
