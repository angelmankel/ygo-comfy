/**
 * Sample the average / dominant colour of an image URL for use as a
 * background tint. Returns rgb values or null while loading / on failure.
 *
 * Approach: load the image with crossOrigin=anonymous, draw it into an
 * offscreen 16×16 canvas, average the resulting pixels (with a perceptual
 * weight to skip pure black/white extremes that dominate noisy thumbnails),
 * and return. Cached per-URL to dodge re-sampling identical images.
 *
 * Falls back gracefully when CORS blocks (the canvas getImageData throws a
 * SecurityError) — caller renders without a tint.
 */
import { useEffect, useState } from 'react';

const SAMPLE_SIZE = 16;
const cache = new Map<string, RgbTriple | 'failed'>();

export type RgbTriple = { r: number; g: number; b: number };

function sample(url: string): Promise<RgbTriple | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = SAMPLE_SIZE;
        c.height = SAMPLE_SIZE;
        const ctx = c.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          const pr = data[i], pg = data[i + 1], pb = data[i + 2];
          // Skip near-pure-black and near-pure-white — they wash out the tint
          // on flat backgrounds (logos, line art) and produce a grey average.
          const lum = pr * 0.299 + pg * 0.587 + pb * 0.114;
          if (lum < 12 || lum > 243) continue;
          r += pr; g += pg; b += pb; n += 1;
        }
        if (n === 0) {
          // Image was all extreme luminance — fall back to plain average.
          for (let i = 0; i < data.length; i += 4) {
            r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1;
          }
        }
        resolve({ r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) });
      } catch {
        // Tainted canvas (CORS), etc. — give up gracefully.
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function useImageDominantColor(url: string | null): RgbTriple | null {
  const [colour, setColour] = useState<RgbTriple | null>(() => {
    if (!url) return null;
    const cached = cache.get(url);
    return cached && cached !== 'failed' ? cached : null;
  });

  useEffect(() => {
    if (!url) { setColour(null); return; }
    const cached = cache.get(url);
    if (cached === 'failed') { setColour(null); return; }
    if (cached) { setColour(cached); return; }
    let cancelled = false;
    void sample(url).then((rgb) => {
      if (cancelled) return;
      cache.set(url, rgb ?? 'failed');
      setColour(rgb);
    });
    return () => { cancelled = true; };
  }, [url]);

  return colour;
}
