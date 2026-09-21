/**
 * Decoupled image-tool runner. Each "tool" is a small ComfyUI graph that
 * takes a `LoadImage` input and produces a single `SaveImage` output — the
 * runner uploads the image, queues the graph as a separate prompt, polls
 * `/history/{id}` until it's done, and downloads the result as a Blob.
 *
 * Reusable for any preprocessor/manipulation flow (Remove BG today, easy to
 * add Sharpen, Adjust, Crop-on-server, Upscale tools later). The main
 * generation pipeline (`queuePrompt` in `comfy.ts`) is unaffected — these
 * jobs share the same ComfyUI queue but are otherwise independent.
 */

import { comfyHttpFor, viewUrl, uploadImage, loadImageRef, clientId } from './comfy';

/** A graph factory: given an uploaded image reference, produce the API graph
 *  to send to ComfyUI. The graph MUST include exactly one `SaveImage` node
 *  whose images will be returned. */
export type ToolGraphBuilder = (uploadedRef: string) => Record<string, GraphNode>;

type GraphNode = { class_type: string; inputs: Record<string, unknown> };

export type RunImageToolOptions = {
  signal?: AbortSignal;
  /** ms between polls for the result. Default 500. */
  pollMs?: number;
  /** Hard timeout (ms). Default 120s — generous for first-call model loads. */
  timeoutMs?: number;
};

/**
 * Run a tool graph on `host` against `blob`. Returns the produced image as
 * a Blob (caller decides whether to swap it into state, save it, etc).
 */
export async function runImageTool(
  host: string,
  blob: Blob,
  filename: string,
  buildGraph: ToolGraphBuilder,
  opts: RunImageToolOptions = {},
): Promise<Blob> {
  // 1. Upload the source image to the server's `input/imagelab/` folder.
  const uploaded = await uploadImage(host, blob, filename);
  const ref = loadImageRef(uploaded);

  // 2. Build the graph for this specific tool and queue it as a prompt.
  const graph = buildGraph(ref);
  const queueRes = await fetch(`${comfyHttpFor(host)}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: clientId }),
    signal: opts.signal,
  });
  if (!queueRes.ok) throw new Error(`queue HTTP ${queueRes.status}`);
  const queueJson = await queueRes.json();
  if (queueJson.error) throw new Error(queueJson.error.message || JSON.stringify(queueJson.error));
  const promptId: string | undefined = queueJson.prompt_id;
  if (!promptId) throw new Error('Queue accepted but returned no prompt_id');

  // 3. Poll /history/{id} for completion.
  const start = Date.now();
  const pollMs = opts.pollMs ?? 500;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  while (true) {
    opts.signal?.throwIfAborted?.();
    if (Date.now() - start > timeoutMs) throw new Error('Tool job timed out');

    const hr = await fetch(`${comfyHttpFor(host)}/history/${promptId}`, { signal: opts.signal });
    if (hr.ok) {
      const hist = await hr.json();
      const entry = hist[promptId];
      // ComfyUI populates `outputs` once the prompt is fully done.
      if (entry && entry.outputs && Object.keys(entry.outputs).length > 0) {
        for (const node of Object.values(entry.outputs) as Array<{ images?: Array<{ filename: string; subfolder?: string; type?: string }> }>) {
          const img = node.images?.[0];
          if (img) {
            const url = viewUrl(img, host);
            const ir = await fetch(url, { signal: opts.signal });
            if (!ir.ok) throw new Error(`fetch result HTTP ${ir.status}`);
            return await ir.blob();
          }
        }
        throw new Error('Job completed but produced no image output');
      }
      // Surface a status-level error if ComfyUI rejected the graph.
      if (entry?.status?.status_str === 'error') {
        const msgs = (entry.status.messages || []) as Array<[string, unknown]>;
        const err = msgs.find(m => m[0] === 'execution_error');
        throw new Error(err ? JSON.stringify(err[1]) : 'ComfyUI execution error');
      }
    }
    await new Promise(r => setTimeout(r, pollMs));
  }
}

// ─── Built-in tools ────────────────────────────────────────────────────────
// Each is a small graph factory. Add more here as we want them. The runner
// is unaware of which tool is running — it just queues whatever the builder
// returns and fetches the saved image.

const PREFIX = 'imagelab_tool';

/** Remove background using the BRIA RMBG node already in use elsewhere. */
export const removeBackgroundGraph: ToolGraphBuilder = (ref) => ({
  "load":  { class_type: "LoadImage", inputs: { image: ref }},
  "model": { class_type: "BRIA_RMBG_ModelLoader_Zho", inputs: {} },
  "rmbg":  { class_type: "BRIA_RMBG_Zho", inputs: {
    rmbgmodel: ["model", 0],
    image: ["load", 0],
  }},
  "save":  { class_type: "SaveImage", inputs: {
    images: ["rmbg", 0],
    filename_prefix: PREFIX,
  }},
});

/**
 * Built-in ComfyUI image manipulations. Each is a single-node passthrough
 * graph. Param defaults are chosen for noticeable-but-tasteful effect; the
 * UI can expose sliders later if needed.
 */
export const blurGraph: ToolGraphBuilder = (ref) => ({
  "load":  { class_type: "LoadImage", inputs: { image: ref }},
  "op":    { class_type: "ImageBlur", inputs: {
    image: ["load", 0],
    blur_radius: 8,
    sigma: 1.5,
  }},
  "save":  { class_type: "SaveImage", inputs: {
    images: ["op", 0],
    filename_prefix: PREFIX,
  }},
});

export const sharpenGraph: ToolGraphBuilder = (ref) => ({
  "load":  { class_type: "LoadImage", inputs: { image: ref }},
  "op":    { class_type: "ImageSharpen", inputs: {
    image: ["load", 0],
    sharpen_radius: 1,
    sigma: 1.0,
    alpha: 1.0,
  }},
  "save":  { class_type: "SaveImage", inputs: {
    images: ["op", 0],
    filename_prefix: PREFIX,
  }},
});

export const invertGraph: ToolGraphBuilder = (ref) => ({
  "load":  { class_type: "LoadImage", inputs: { image: ref }},
  "op":    { class_type: "ImageInvert", inputs: { image: ["load", 0] }},
  "save":  { class_type: "SaveImage", inputs: {
    images: ["op", 0],
    filename_prefix: PREFIX,
  }},
});
