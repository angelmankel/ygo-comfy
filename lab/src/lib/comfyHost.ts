/**
 * Addressing a ComfyUI host, and the identity we address it with.
 *
 * Split out of `comfy.ts` because the websocket bus needs exactly these and nothing else. Leaving
 * them in `comfy.ts` made the two modules import each other, and a cycle whose values are read at
 * module-evaluation time — `clientId` is — is the kind that resolves to `undefined` depending on
 * which module a bundler happens to evaluate first. This file imports nothing, so it cannot
 * participate in a cycle at all.
 */

/** Over HTTPS the browser blocks plain-HTTP requests as mixed content, so the scheme follows the page. */
const isSecure = () => typeof window !== 'undefined' && window.location.protocol === 'https:';

/** HTTP base URL for a given ComfyUI host. */
export function comfyHttpFor(host: string) {
  return `${isSecure() ? 'https' : 'http'}://${host}`;
}

/** WebSocket base URL for a given ComfyUI host. */
export function comfyWsFor(host: string) {
  return `${isSecure() ? 'wss' : 'ws'}://${host}/ws`;
}

/** Build a ComfyUI `/view` URL for an image on a specific server. */
export function viewUrl(
  entry: { filename: string; subfolder?: string; type?: string },
  host: string,
) {
  return `${comfyHttpFor(host)}/view?` + new URLSearchParams({
    filename: entry.filename,
    subfolder: entry.subfolder || '',
    type: entry.type || 'output',
  });
}

/**
 * Stable per-browser client id. Persisted to localStorage so that after a page refresh the same
 * id is sent on the new WebSocket connection — ComfyUI routes binary preview frames (and the
 * SaveImageWebsocket node) by `client_id`, so a fresh id every reload silently breaks live
 * preview reconnection for any in-flight job.
 */
const CLIENT_ID_KEY = 'imagelab.clientId.v1';
function loadOrCreateClientId(): string {
  try {
    const saved = localStorage.getItem(CLIENT_ID_KEY);
    if (saved) return saved;
  } catch { /* ignore */ }
  const fresh =
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto && crypto.randomUUID()) ||
    (Math.random().toString(36).slice(2) + Date.now().toString(36));
  try { localStorage.setItem(CLIENT_ID_KEY, fresh); } catch { /* ignore */ }
  return fresh;
}
export const clientId = loadOrCreateClientId();
