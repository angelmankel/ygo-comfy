import { useEffect, useState } from 'react';
import { comfyHttpFor } from '@/lib/comfy';
import { useStore } from '@/lib/store';
import { useCanvasStore } from '@/lib/canvasStore';
import { ComfyIcon, ExternalLinkIcon, ResetIcon } from '@/components/ui/icons';

/**
 * Full-area ComfyUI iframe — a top-level view (not an overlay). The sidebar's
 * per-server ComfyUI buttons set both `mainView='comfy'` and
 * `comfyServerId=<id>`; switching away unmounts this whole subtree so the
 * iframe doesn't keep ComfyUI's session in memory.
 *
 * Reachability is gated on `serverInfo[id]`. If the store doesn't have it
 * (server offline, DNS dead, ComfyUI not running) we render an in-app dead
 * state with a Retry button instead of letting the iframe show the browser's
 * default error page. On mount we kick a probe — that way a server that just
 * came back up doesn't require a manual retry click.
 *
 * Note: ComfyUI doesn't set X-Frame-Options, so it embeds fine.
 */
export function ComfyView({ serverId }: { serverId?: string }) {
  const servers = useStore((s) => s.servers);
  const activeId = useCanvasStore((s) => s.comfyServerId);
  // ComfyLayer keeps one of these per server it has warmed, so the server is passed in rather
  // than read from the store — otherwise every kept-alive frame would follow the active one.
  const id = serverId ?? activeId;
  const server = servers.find((s) => s.id === id) ?? servers[0];

  // Subscribe to just this server's info — re-renders the moment the probe
  // finishes (or a later WS reconnect flips it from offline → online).
  const isReachable = useStore((s) => server ? Boolean(s.serverInfo[server.id]) : false);
  const refreshServerInfo = useStore((s) => s.refreshServerInfo);

  // Local "probing" flag so the dead state doesn't flash before the initial
  // reachability probe resolves. Also drives the Retry spinner.
  const [probing, setProbing] = useState(true);
  useEffect(() => {
    if (!server) { setProbing(false); return; }
    setProbing(true);
    let cancelled = false;
    void refreshServerInfo(server.id).finally(() => {
      if (!cancelled) setProbing(false);
    });
    return () => { cancelled = true; };
  }, [server?.id, refreshServerInfo]);

  if (!server) {
    return <DeadState title="No ComfyUI servers configured" body="Add one in Settings." />;
  }

  if (isReachable) {
    return <ComfyFrame key={server.id} server={server} />;
  }

  if (probing) {
    return <DeadState title={`Connecting to ${server.name}…`} body={server.host} />;
  }

  return (
    <DeadState
      title={`Can't reach ${server.name}`}
      body={`${server.host} isn't responding. The server may be offline or ComfyUI isn't running.`}
      actions={
        <>
          <button
            type="button"
            onClick={() => {
              setProbing(true);
              void refreshServerInfo(server.id).finally(() => setProbing(false));
            }}
            disabled={probing}
            className="flex items-center gap-1.5 rounded-md border border-accent bg-accent px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
          >
            <ResetIcon size={13} /> {probing ? 'Checking…' : 'Retry'}
          </button>
          <a
            href={comfyHttpFor(server.host)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-md border border-border-default bg-bg-elev px-3 py-1.5 text-[12px] text-fg-secondary hover:border-border-strong"
          >
            Open in tab <ExternalLinkIcon size={12} />
          </a>
        </>
      }
    />
  );
}

/** Iframe wrapper that masks the white-page flash. The iframe itself uses
 *  the app's dark base color so the gap before ComfyUI paints is dark-on-
 *  dark (ComfyUI is dark by default, so this matches its final look). A
 *  small "Loading…" overlay fades out on the iframe's `load` event — that
 *  event fires for cross-origin frames too, so we get reliable signal even
 *  though we can't read frame contents. */
function ComfyFrame({ server }: { server: { id: string; name: string; host: string } }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="relative h-full w-full bg-bg-base">
      <iframe
        src={comfyHttpFor(server.host)}
        title={`ComfyUI — ${server.name}`}
        onLoad={() => setLoaded(true)}
        className="h-full w-full border-0 bg-bg-base"
      />
      {!loaded && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-bg-base">
          <div className="flex flex-col items-center gap-3 text-fg-muted">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border-subtle bg-bg-elev">
              <ComfyIcon size={20} />
            </div>
            <span className="text-[12px]">Loading {server.name}…</span>
          </div>
        </div>
      )}
    </div>
  );
}

function DeadState({
  title,
  body,
  actions,
}: {
  title: string;
  body?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-bg-base px-6">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border-subtle bg-bg-elev text-fg-muted">
          <ComfyIcon size={20} />
        </div>
        <h2 className="text-[14px] font-semibold text-fg-primary">{title}</h2>
        {body && <p className="text-[12px] leading-relaxed text-fg-muted">{body}</p>}
        {actions && <div className="mt-2 flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
