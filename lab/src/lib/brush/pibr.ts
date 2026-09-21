/**
 * "PIBR" — Premultiplied Image Buffer Raw.
 *
 * Custom binary format the brush engine uses for layer-history commits. PNG
 * isn't an option because every canvas2d-based PNG roundtrip drifts the
 * premultiplied pixels at brush-edge alpha values, leaving visible "ghost
 * outlines" on reload. PIBR is a flat header + raw RGBA bytes, identical
 * to what's in the live RT.
 *
 * Format:
 *   bytes 0-3  : magic 'PIBR'
 *   bytes 4-7  : uint32 width  (little-endian)
 *   bytes 8-11 : uint32 height (little-endian)
 *   bytes 12+  : width * height * 4 bytes of premultiplied RGBA
 */

const MAGIC = [0x50, 0x49, 0x42, 0x52]; // 'PIBR'
export const PIBR_HEADER_SIZE = 12;

/** Build a PIBR blob from raw premultiplied RGBA pixels. */
export function encodePibr(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number): Blob {
  const buf = new Uint8Array(PIBR_HEADER_SIZE + pixels.length);
  buf[0] = MAGIC[0]; buf[1] = MAGIC[1]; buf[2] = MAGIC[2]; buf[3] = MAGIC[3];
  const dv = new DataView(buf.buffer);
  dv.setUint32(4, width, true);
  dv.setUint32(8, height, true);
  buf.set(pixels, PIBR_HEADER_SIZE);
  return new Blob([buf], { type: 'application/octet-stream' });
}

/** Cheap header sniff. Reads the first 4 bytes of the blob. */
export async function isPibrBlob(blob: Blob): Promise<boolean> {
  if (blob.size < PIBR_HEADER_SIZE) return false;
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  return head[0] === MAGIC[0] && head[1] === MAGIC[1] && head[2] === MAGIC[2] && head[3] === MAGIC[3];
}

/** Parse a PIBR blob into { pixels, width, height }. Throws if not PIBR. */
export async function decodePibr(blob: Blob): Promise<{ pixels: Uint8Array; width: number; height: number }> {
  const ab = await blob.arrayBuffer();
  const dv = new DataView(ab);
  const width = dv.getUint32(4, true);
  const height = dv.getUint32(8, true);
  const pixels = new Uint8Array(ab, PIBR_HEADER_SIZE);
  return { pixels, width, height };
}

/**
 * Turn a layer-history blob into a URL safe to assign to an `<img>` for
 * preview thumbnails. PNG blobs pass through unchanged. PIBR blobs go
 * through a one-shot canvas2d un-premultiply → PNG encode so the browser
 * can render them — fidelity loss here is acceptable since we're only
 * showing a 64×64 thumbnail, not feeding the canvas compositor.
 *
 * Caller owns the returned URL and must `URL.revokeObjectURL` it.
 */
export async function blobToDisplayUrl(blob: Blob): Promise<string> {
  if (!(await isPibrBlob(blob))) return URL.createObjectURL(blob);
  const { pixels, width, height } = await decodePibr(blob);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return URL.createObjectURL(blob); // fallback
  const img = ctx.createImageData(width, height);
  // Un-premultiply RGB so the canvas2d (straight-alpha) PNG looks right
  // when displayed via <img>. This thumbnail path is one-way — the canvas
  // pipeline never re-loads from this URL, so the lossy un-premultiply is
  // fine here.
  const dest = img.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3];
    if (a === 0) {
      dest[i] = 0; dest[i + 1] = 0; dest[i + 2] = 0; dest[i + 3] = 0;
      continue;
    }
    if (a === 255) {
      dest[i] = pixels[i]; dest[i + 1] = pixels[i + 1]; dest[i + 2] = pixels[i + 2]; dest[i + 3] = 255;
      continue;
    }
    const inv = 255 / a;
    dest[i]     = Math.min(255, Math.round(pixels[i]     * inv));
    dest[i + 1] = Math.min(255, Math.round(pixels[i + 1] * inv));
    dest[i + 2] = Math.min(255, Math.round(pixels[i + 2] * inv));
    dest[i + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  return await new Promise<string>(resolve => {
    canvas.toBlob(b => {
      if (!b) { resolve(URL.createObjectURL(blob)); return; }
      resolve(URL.createObjectURL(b));
    }, 'image/png');
  });
}

/**
 * Same conversion as {@link blobToDisplayUrl} but returns a PNG Blob — for
 * upload paths (ComfyUI tool runner, server-side image processing) that need
 * a real PNG, not a browser-only object URL. PNG blobs pass through; PIBR
 * blobs are un-premultiplied + re-encoded as PNG.
 */
export async function blobToPngBlob(blob: Blob): Promise<Blob> {
  if (!(await isPibrBlob(blob))) return blob;
  const { pixels, width, height } = await decodePibr(blob);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return blob;
  const img = ctx.createImageData(width, height);
  const dest = img.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3];
    if (a === 0) { dest[i] = 0; dest[i + 1] = 0; dest[i + 2] = 0; dest[i + 3] = 0; continue; }
    if (a === 255) { dest[i] = pixels[i]; dest[i + 1] = pixels[i + 1]; dest[i + 2] = pixels[i + 2]; dest[i + 3] = 255; continue; }
    const inv = 255 / a;
    dest[i]     = Math.min(255, Math.round(pixels[i]     * inv));
    dest[i + 1] = Math.min(255, Math.round(pixels[i + 1] * inv));
    dest[i + 2] = Math.min(255, Math.round(pixels[i + 2] * inv));
    dest[i + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  return await new Promise<Blob>(resolve => {
    canvas.toBlob(b => resolve(b ?? blob), 'image/png');
  });
}
