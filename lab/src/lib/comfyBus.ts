/**
 * One websocket per ComfyUI host, shared by everything that wants to hear from it.
 *
 * ComfyUI keys its connected clients by `clientId`, and it keeps exactly one socket per id. A
 * second connection using the same id silently displaces the first, so the moment two parts of
 * this app each opened their own, one of them stopped receiving events — the generate view would
 * go deaf as soon as Studio connected. Ref-counting a single socket per host and fanning its
 * messages out to every subscriber is the only arrangement where both can listen at once.
 *
 * The socket is opened on the first subscriber and closed on the last, with a short grace period
 * so switching views does not tear down and rebuild it. Reconnects back off rather than hammering
 * a server that is restarting.
 */
import { clientId, comfyWsFor } from './comfyHost';

/** Everything ComfyUI reports that this app has a use for. */
export type ComfyEvent =
  | { type: 'binary'; mime: string; bytes: Uint8Array }
  | { type: 'progress'; value: number; max: number; node: string | null; promptId: string }
  | { type: 'executing'; promptId: string; node: string | null }
  | { type: 'execution_start'; promptId: string }
  | { type: 'execution_cached'; promptId: string; nodes: string[] }
  /** A node finished and produced outputs — images arrive here, per node, as they are made. */
  | { type: 'executed'; promptId: string; node: string; images: ComfyImageRef[] }
  | { type: 'execution_error'; promptId: string; message: string }
  /** The prompt finished, whether or not it produced anything. The authoritative "done". */
  | { type: 'execution_success'; promptId: string }
  /** Queue depth, pushed whenever it changes. */
  | { type: 'status'; queueRemaining: number };

export interface ComfyImageRef { filename: string; subfolder: string; type: string }

export interface BusHandlers {
  onOpen?: () => void;
  onClose?: () => void;
  onEvent: (ev: ComfyEvent) => void;
}

interface Conn {
  ws: WebSocket | null;
  subs: Set<BusHandlers>;
  /** Set while waiting out the grace period after the last unsubscribe. */
  closeTimer: ReturnType<typeof setTimeout> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  attempts: number;
  stopped: boolean;
}

const conns = new Map<string, Conn>();

/** Keep the socket briefly after the last listener leaves, so a view switch does not cycle it. */
const GRACE_MS = 5000;
const BACKOFF = [500, 1000, 2000, 4000, 8000];

function imagesOf(data: Record<string, unknown>): ComfyImageRef[] {
  const out = (data.output ?? {}) as { images?: Array<Record<string, unknown>> };
  return (out.images ?? []).map(i => ({
    filename: String(i.filename ?? ''),
    subfolder: String(i.subfolder ?? ''),
    type: String(i.type ?? 'output'),
  })).filter(i => i.filename);
}

function emit(conn: Conn, ev: ComfyEvent) {
  // Copy first: a handler may unsubscribe while being called.
  for (const sub of [...conn.subs]) {
    try { sub.onEvent(ev); } catch (err) { console.warn('[comfyBus] subscriber threw', err); }
  }
}

function open(host: string, conn: Conn) {
  if (conn.stopped) return;
  const ws = new WebSocket(`${comfyWsFor(host)}?clientId=${clientId}`);
  conn.ws = ws;
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    conn.attempts = 0;
    for (const sub of [...conn.subs]) sub.onOpen?.();
  };

  ws.onclose = () => {
    for (const sub of [...conn.subs]) sub.onClose?.();
    if (conn.stopped || !conn.subs.size) return;
    const delay = BACKOFF[Math.min(conn.attempts++, BACKOFF.length - 1)];
    conn.reconnectTimer = setTimeout(() => open(host, conn), delay);
  };

  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') {
      let msg: { type?: string; data?: Record<string, unknown> };
      try { msg = JSON.parse(ev.data); } catch { return; }
      const { type, data } = msg;
      if (!type || !data) return;
      const promptId = String(data.prompt_id ?? '');
      switch (type) {
        case 'progress':
          return emit(conn, {
            type: 'progress',
            value: Number(data.value) | 0,
            max: Number(data.max) | 0,
            node: data.node == null ? null : String(data.node),
            promptId,
          });
        case 'executing':
          return emit(conn, { type: 'executing', promptId, node: data.node == null ? null : String(data.node) });
        case 'execution_start':
          return emit(conn, { type: 'execution_start', promptId });
        case 'execution_cached':
          return emit(conn, { type: 'execution_cached', promptId, nodes: (data.nodes as string[]) ?? [] });
        case 'executed':
          return emit(conn, { type: 'executed', promptId, node: String(data.node ?? ''), images: imagesOf(data) });
        case 'execution_success':
          return emit(conn, { type: 'execution_success', promptId });
        case 'execution_error':
        case 'execution_interrupted':
          return emit(conn, {
            type: 'execution_error',
            promptId,
            message: String(data.exception_message ?? (type === 'execution_interrupted' ? 'Interrupted' : 'execution_error')),
          });
        case 'status': {
          const info = (data.status ?? {}) as { exec_info?: { queue_remaining?: number } };
          return emit(conn, { type: 'status', queueRemaining: Number(info.exec_info?.queue_remaining ?? 0) });
        }
        default:
          return;
      }
    }

    if (ev.data instanceof ArrayBuffer) {
      // Preview frames: [uint32 event][uint32 format][image bytes]. Event 1 is a preview image;
      // format 2 is PNG, anything else JPEG.
      const buf = ev.data;
      if (buf.byteLength < 8) return;
      const view = new DataView(buf);
      if (view.getUint32(0, false) !== 1) return;
      const mime = view.getUint32(4, false) === 2 ? 'image/png' : 'image/jpeg';
      emit(conn, { type: 'binary', mime, bytes: new Uint8Array(buf, 8) });
    }
  };
}

/**
 * Listen to a host. Returns an unsubscribe; the socket lives as long as at least one listener
 * does (plus the grace period).
 */
export function subscribeComfy(host: string, handlers: BusHandlers): () => void {
  let conn = conns.get(host);
  if (!conn) {
    conn = { ws: null, subs: new Set(), closeTimer: null, reconnectTimer: null, attempts: 0, stopped: false };
    conns.set(host, conn);
  }
  if (conn.closeTimer) { clearTimeout(conn.closeTimer); conn.closeTimer = null; }
  conn.stopped = false;
  conn.subs.add(handlers);

  if (!conn.ws || conn.ws.readyState === WebSocket.CLOSED) open(host, conn);
  else if (conn.ws.readyState === WebSocket.OPEN) handlers.onOpen?.();

  return () => {
    const c = conns.get(host);
    if (!c) return;
    c.subs.delete(handlers);
    if (c.subs.size) return;
    c.closeTimer = setTimeout(() => {
      if (c.subs.size) return;               // someone came back during the grace period
      c.stopped = true;
      if (c.reconnectTimer) clearTimeout(c.reconnectTimer);
      c.ws?.close();
      c.ws = null;
      conns.delete(host);
    }, GRACE_MS);
  };
}

/** Whether a host's socket is open right now — for a connection dot that tells the truth. */
export function isComfyConnected(host: string): boolean {
  return conns.get(host)?.ws?.readyState === WebSocket.OPEN;
}
