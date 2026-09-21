import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/cn';
import { ImagePlaceholderIcon } from '@/components/ui/icons';

type Props = {
  src?: string | null;
  /** Ordered fallback chain — takes precedence over `src`. Used by the model
   *  pickers: CivitAI preview URLs occasionally 404, and we want the first
   *  one that loads to win. */
  srcs?: string[];
  alt?: string;
  /** Caption shown over the placeholder when there is no image. */
  label?: string;
  className?: string;
  /** How the image fills the box: 'cover' (default) crops to fill, 'contain' letterboxes. */
  fit?: 'cover' | 'contain';
};

/**
 * Generic image preview — renders the image when `src` is set, a neutral
 * gradient placeholder otherwise. Sizing is the caller's job (pass `className`).
 *
 * When given `srcs`, walks the array on `onError` until one image loads or all
 * candidates are exhausted, at which point it falls back to the placeholder.
 */
export function PreviewThumb({ src, srcs, alt = '', label, className, fit = 'cover' }: Props) {
  // Normalise into one ordered candidate list. Memoised against the joined
  // identity so a parent re-render with the same URLs doesn't reset progress.
  const candidates = useMemo(() => {
    const arr = (srcs ?? []).filter(Boolean);
    if (src && !arr.includes(src)) arr.unshift(src);
    return arr;
  }, [src, srcs]);
  const candidatesKey = candidates.join('|');

  const [index, setIndex] = useState(0);
  // Reset whenever the candidate set itself changes — a new model is being
  // previewed, so we must start over from the top.
  useEffect(() => { setIndex(0); }, [candidatesKey]);

  const url = candidates[index];
  // Per-URL load tracker — drives the fade-in below so each new image
  // doesn't pop onscreen. Resets implicitly via the keyed <img> remount.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setLoaded(false); }, [url]);

  return (
    <div className={cn('relative overflow-hidden bg-bg-input', className)}>
      {url ? (
        <>
          {/* Soft pulse stand-in while the image is decoding. Sits under
              the <img> and fades out as the image fades in. */}
          {!loaded && <div aria-hidden className="absolute inset-0 animate-pulse bg-bg-elev" />}
          <img
            // The src in the key makes React mount a fresh <img> per candidate,
            // which forces `onError` to fire reliably even when the browser has
            // already cached the failed URL.
            key={url}
            src={url}
            alt={alt}
            onLoad={() => setLoaded(true)}
            onError={() => setIndex((i) => (i + 1 < candidates.length ? i + 1 : i + 1))}
            className={cn(
              'relative h-full w-full transition-opacity duration-300 ease-out',
              fit === 'contain' ? 'object-contain' : 'object-cover',
              loaded ? 'opacity-100' : 'opacity-0',
            )}
          />
        </>
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-bg-elev to-bg-input text-fg-dim">
          <ImagePlaceholderIcon size={20} />
          {label && <span className="text-[9px] font-medium">{label}</span>}
        </div>
      )}
    </div>
  );
}
