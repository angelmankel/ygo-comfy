/**
 * Client-side image operations for the input-image editor. Everything here
 * runs on a Canvas2D — fast, no extra deps. Heavy/AI ops (Remove BG, etc.)
 * are server-side via `lib/imageJobs.ts`.
 */

/** Decode a data URL into an HTMLImageElement. */
export function loadHtmlImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image'));
    img.src = dataUrl;
  });
}

/** Draw `img` into a fresh Canvas of the same size and return it. */
function freshCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D context');
  return { canvas, ctx };
}

function canvasToDataUrl(canvas: HTMLCanvasElement, mime = 'image/png', quality?: number): string {
  return canvas.toDataURL(mime, quality);
}

function canvasToBlob(canvas: HTMLCanvasElement, mime = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob returned null')), mime, quality);
  });
}

export type ImageResult = { dataUrl: string; width: number; height: number };

/** Re-emit the image with its current pixels, no transform. Useful as a
 *  uniform return shape. */
async function emit(img: HTMLImageElement): Promise<ImageResult> {
  const { canvas, ctx } = freshCanvas(img.naturalWidth, img.naturalHeight);
  ctx.drawImage(img, 0, 0);
  return { dataUrl: canvasToDataUrl(canvas), width: canvas.width, height: canvas.height };
}

/** Rotate the image by 90°×k clockwise (k can be negative). */
export async function rotate90(dataUrl: string, k = 1): Promise<ImageResult> {
  const img = await loadHtmlImage(dataUrl);
  const turns = ((k % 4) + 4) % 4;
  if (turns === 0) return emit(img);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const swapped = turns === 1 || turns === 3;
  const { canvas, ctx } = freshCanvas(swapped ? h : w, swapped ? w : h);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((turns * Math.PI) / 2);
  ctx.drawImage(img, -w / 2, -h / 2);
  return { dataUrl: canvasToDataUrl(canvas), width: canvas.width, height: canvas.height };
}

export async function flipHorizontal(dataUrl: string): Promise<ImageResult> {
  const img = await loadHtmlImage(dataUrl);
  const { canvas, ctx } = freshCanvas(img.naturalWidth, img.naturalHeight);
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(img, 0, 0);
  return { dataUrl: canvasToDataUrl(canvas), width: canvas.width, height: canvas.height };
}

export async function flipVertical(dataUrl: string): Promise<ImageResult> {
  const img = await loadHtmlImage(dataUrl);
  const { canvas, ctx } = freshCanvas(img.naturalWidth, img.naturalHeight);
  ctx.translate(0, canvas.height);
  ctx.scale(1, -1);
  ctx.drawImage(img, 0, 0);
  return { dataUrl: canvasToDataUrl(canvas), width: canvas.width, height: canvas.height };
}

export async function invert(dataUrl: string): Promise<ImageResult> {
  const img = await loadHtmlImage(dataUrl);
  const { canvas, ctx } = freshCanvas(img.naturalWidth, img.naturalHeight);
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    px[i] = 255 - px[i];
    px[i + 1] = 255 - px[i + 1];
    px[i + 2] = 255 - px[i + 2];
  }
  ctx.putImageData(data, 0, 0);
  return { dataUrl: canvasToDataUrl(canvas), width: canvas.width, height: canvas.height };
}

export type CssFilters = {
  brightness: number; // 0..2, 1 = no change
  contrast: number;   // 0..2, 1 = no change
  saturation: number; // 0..2, 1 = no change
  blur: number;       // 0..20 px
};

export const NEUTRAL_FILTERS: CssFilters = { brightness: 1, contrast: 1, saturation: 1, blur: 0 };

export function cssFilterString(f: CssFilters): string {
  return `brightness(${f.brightness}) contrast(${f.contrast}) saturate(${f.saturation}) blur(${f.blur}px)`;
}

export function isNeutralFilters(f: CssFilters): boolean {
  return f.brightness === 1 && f.contrast === 1 && f.saturation === 1 && f.blur === 0;
}

/** Bake CSS-style adjustments into a fresh canvas. */
export async function applyFilters(dataUrl: string, f: CssFilters): Promise<ImageResult> {
  const img = await loadHtmlImage(dataUrl);
  const { canvas, ctx } = freshCanvas(img.naturalWidth, img.naturalHeight);
  ctx.filter = cssFilterString(f);
  ctx.drawImage(img, 0, 0);
  return { dataUrl: canvasToDataUrl(canvas), width: canvas.width, height: canvas.height };
}

export type CropRect = { x: number; y: number; w: number; h: number };

export async function crop(dataUrl: string, rect: CropRect): Promise<ImageResult> {
  const img = await loadHtmlImage(dataUrl);
  const x = Math.max(0, Math.round(rect.x));
  const y = Math.max(0, Math.round(rect.y));
  const w = Math.max(1, Math.min(img.naturalWidth - x, Math.round(rect.w)));
  const h = Math.max(1, Math.min(img.naturalHeight - y, Math.round(rect.h)));
  const { canvas, ctx } = freshCanvas(w, h);
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
  return { dataUrl: canvasToDataUrl(canvas), width: canvas.width, height: canvas.height };
}

/**
 * Scale factor that clamps `max(w, h)` into `[minEdge, maxEdge]`. Upscales tiny
 * inputs up to `minEdge`, downscales huge ones to `maxEdge`, leaves the rest
 * alone. Shared with the InputImage / hi-res preview so the UI can mirror
 * exactly what the upload pipeline does.
 */
export function scaleForLongestEdge(w: number, h: number, maxEdge: number, minEdge = 0): number {
  const longest = Math.max(w, h) || 1;
  if (maxEdge > 0 && longest > maxEdge) return maxEdge / longest;
  if (minEdge > 0 && longest < minEdge) return minEdge / longest;
  return 1;
}

/**
 * Decode + clamp to `maxEdge` + re-encode as PNG blob. Used by the upload
 * pipeline before each generate. PNG keeps alpha (matters once Remove BG
 * has been applied) at the cost of larger blobs vs. JPEG.
 */
export async function resizeDataUrlForUpload(dataUrl: string, maxEdge: number, minEdge = 0): Promise<Blob> {
  const img = await loadHtmlImage(dataUrl);
  const scale = scaleForLongestEdge(img.naturalWidth, img.naturalHeight, maxEdge, minEdge);
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const { canvas, ctx } = freshCanvas(w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvasToBlob(canvas, 'image/png');
}

/** Decode a `File` to a dataURL + dimensions. */
export async function fileToImageState(file: File): Promise<{ dataUrl: string; name: string; width: number; height: number }> {
  const dataUrl: string = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('FileReader failed'));
    r.readAsDataURL(file);
  });
  const img = await loadHtmlImage(dataUrl);
  return { dataUrl, name: file.name || 'input.png', width: img.naturalWidth, height: img.naturalHeight };
}

/**
 * Fetch an image URL and decode it into the same `{dataUrl, name, w, h}`
 * shape as a dropped file. Tries `fetch` + Blob first (works when CORS is
 * permissive), falls back to a `<img crossOrigin>` + Canvas dance (works
 * with image-only CORS headers, common for CDN hosts).
 */
export async function urlToImageState(url: string, name = 'image.png'): Promise<{ dataUrl: string; name: string; width: number; height: number }> {
  try {
    const r = await fetch(url, { mode: 'cors' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const blob = await r.blob();
    return await blobToImageState(blob, name);
  } catch {
    const img: HTMLImageElement = await new Promise((resolve, reject) => {
      const i = new Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Image load failed'));
      i.src = url;
    });
    const { canvas, ctx } = freshCanvas(img.naturalWidth, img.naturalHeight);
    ctx.drawImage(img, 0, 0);
    return {
      dataUrl: canvasToDataUrl(canvas),
      name,
      width: img.naturalWidth,
      height: img.naturalHeight,
    };
  }
}

/** Decode a Blob to a dataURL + dimensions. */
export async function blobToImageState(blob: Blob, name = 'tool-output.png'): Promise<{ dataUrl: string; name: string; width: number; height: number }> {
  const dataUrl: string = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('FileReader failed'));
    r.readAsDataURL(blob);
  });
  const img = await loadHtmlImage(dataUrl);
  return { dataUrl, name, width: img.naturalWidth, height: img.naturalHeight };
}
