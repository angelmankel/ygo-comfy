import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import type { Server } from '@/lib/storage';
import { CloseIcon } from '@/components/ui/icons';
import { Switch } from '@/components/ui/Switch';
import { FieldGroup } from './FieldGroup';
import { cn } from '@/lib/cn';

/**
 * Servers tab — add / edit / remove ComfyUI endpoints. All workflow state is
 * global; this only controls *where* jobs are routed.
 */
export function ServersTab() {
  const servers = useStore(s => s.servers);
  const serverInfo = useStore(s => s.serverInfo);
  const addServer = useStore(s => s.addServer);
  const updateServer = useStore(s => s.updateServer);
  const removeServer = useStore(s => s.removeServer);

  const [newName, setNewName] = useState('');
  const [newHost, setNewHost] = useState('');

  const add = () => {
    if (!newHost.trim()) return;
    addServer(newName || `Server ${servers.length + 1}`, newHost);
    setNewName('');
    setNewHost('');
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[11px] text-fg-muted">
        Each server is a ComfyUI endpoint. All parameters, models, prompt and
        history are shared — jobs are spread across servers by the routing
        control on the Generate button (round-robin, or pinned to one server).
      </p>

      <FieldGroup title="Active servers">
        <div className="flex flex-col gap-2">
          {servers.map(s => (
            <ServerRow
              key={s.id}
              server={s}
              online={!!serverInfo[s.id]}
              canRemove={servers.length > 1}
              onUpdate={(patch) => updateServer(s.id, patch)}
              onRemove={() => removeServer(s.id)}
              onToggleEnabled={(on) => updateServer(s.id, { enabled: on })}
            />
          ))}
        </div>
      </FieldGroup>

      <FieldGroup title="Add server">
        <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-border-default px-3 py-2.5">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name (e.g. Server 3)"
            className="w-full rounded border border-border-default bg-bg-input px-2 py-1 text-[12px] text-fg-secondary outline-none focus:border-accent"
          />
          <input
            value={newHost}
            onChange={(e) => setNewHost(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder="host:port (e.g. 192.168.0.23:8188)"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            className="w-full rounded border border-border-default bg-bg-input px-2 py-1 font-mono text-[11px] text-fg-secondary outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={add}
            disabled={!newHost.trim()}
            className="mt-0.5 self-end rounded-md border border-accent bg-accent px-3 py-1 text-[11px] font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            Add server
          </button>
        </div>
      </FieldGroup>
    </div>
  );
}

/**
 * One editable server row. Name/host are kept in local draft state and
 * committed on blur (or Enter) so editing a host doesn't tear down its
 * websocket on every keystroke.
 */
function ServerRow({
  server, online, canRemove, onUpdate, onRemove, onToggleEnabled,
}: {
  server: Server;
  online: boolean;
  canRemove: boolean;
  onUpdate: (patch: Partial<Pick<Server, 'name' | 'host'>>) => void;
  onRemove: () => void;
  onToggleEnabled: (on: boolean) => void;
}) {
  const enabled = server.enabled !== false;
  const [name, setName] = useState(server.name);
  const [host, setHost] = useState(server.host);
  useEffect(() => { setName(server.name); }, [server.name]);
  useEffect(() => { setHost(server.host); }, [server.host]);

  const commitName = () => { if (name.trim() && name !== server.name) onUpdate({ name }); else setName(server.name); };
  const commitHost = () => { if (host.trim() && host !== server.host) onUpdate({ host }); else setHost(server.host); };

  return (
    <div className={cn(
      'rounded-lg border border-border-default bg-bg-input px-3 py-2.5 transition-opacity',
      !enabled && 'opacity-55',
    )}>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            !enabled ? 'bg-fg-faint' : online ? 'bg-status-ok' : 'bg-fg-dim',
          )}
          title={!enabled ? 'Disabled' : online ? 'Online' : 'Offline / unreachable'}
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          placeholder="Server name"
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[12px] font-semibold text-fg-primary outline-none hover:border-border-default focus:border-accent"
        />
        <Switch
          checked={enabled}
          onCheckedChange={onToggleEnabled}
          ariaLabel={enabled ? 'Disable server' : 'Enable server'}
        />
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          aria-label="Remove server"
          title={canRemove ? 'Remove server' : 'Can’t remove the last server'}
          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded border border-border-default text-fg-muted hover:border-status-err hover:text-status-err disabled:opacity-40 disabled:hover:border-border-default disabled:hover:text-fg-muted"
        >
          <CloseIcon size={12} />
        </button>
      </div>
      <input
        value={host}
        onChange={(e) => setHost(e.target.value)}
        onBlur={commitHost}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        placeholder="host:port"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        className="mt-1.5 w-full rounded border border-border-default bg-bg-base px-2 py-1 font-mono text-[11px] text-fg-secondary outline-none focus:border-accent"
      />
    </div>
  );
}
