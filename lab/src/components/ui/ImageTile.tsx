import type { MouseEvent, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Square (or arbitrary-aspect) image tile with select-border, hover state,
 * and an overlay slot for caller-defined badges + action buttons. Used by
 * the history grid and the Collections grid; the GalleryColumn rail thumbs
 * are too lightweight to benefit from this shell and stay inline.
 *
 * Action buttons rendered as overlay children are visually layered above the
 * image button. Browsers do NOT allow nested buttons, so the image trigger
 * is rendered as a sibling `<button>` inside this container — overlay
 * children should be `<button>` siblings of it, not children.
 */
type Props = {
  src: string;
  alt?: string;
  selected?: boolean;
  /** Tile click — fires when the image area is clicked. */
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  /** Reports the image's natural pixel size after load — useful for hover
   *  size badges. */
  onNaturalSize?: (w: number, h: number) => void;
  /** Border / shadow classes applied while selected. */
  selectedClassName?: string;
  /** Border / hover classes applied while NOT selected. */
  unselectedClassName?: string;
  /** Outer wrapper extras (aspect ratio overrides, gap, etc.). */
  className?: string;
  /** Aspect ratio class. Default 'aspect-square'. */
  aspect?: string;
  /** Rendered when `src` is empty. */
  fallback?: ReactNode;
  /** Overlay siblings — badges, action buttons. Caller is responsible for
   *  absolute positioning + their own `e.stopPropagation()` on click handlers. */
  children?: ReactNode;
  /** Lazy-load the image. Default true. */
  lazy?: boolean;
  /** Image alt text label for the click button (a11y). */
  buttonLabel?: string;
  /** When set, the tile becomes draggable. Drop targets that understand
   *  `application/x-imagelab-image` (currently the canvas) receive the JSON
   *  payload; external apps see the URL via `text/uri-list`. */
  dragPayload?: { url: string; name?: string };
};

const DEFAULT_SELECTED = 'border-accent border-2';
const DEFAULT_UNSELECTED = 'border-border-default hover:border-border-strong';

export function ImageTile({
  src, alt = '', selected = false, onClick, onNaturalSize,
  selectedClassName = DEFAULT_SELECTED,
  unselectedClassName = DEFAULT_UNSELECTED,
  className,
  aspect = 'aspect-square',
  fallback,
  children,
  lazy = true,
  buttonLabel,
  dragPayload,
}: Props) {
  const onDragStart = (e: React.DragEvent<HTMLImageElement>) => {
    if (!dragPayload) return;
    e.dataTransfer.effectAllowed = 'copy';
    // In-app payload (canvas drop handler reads this first).
    e.dataTransfer.setData('application/x-imagelab-image', JSON.stringify(dragPayload));
    // Fallback for external apps and the browser's image-drag native flow.
    e.dataTransfer.setData('text/uri-list', dragPayload.url);
    e.dataTransfer.setData('text/plain', dragPayload.url);
    // Use the image itself as the drag preview, scaled down so it doesn't
    // dominate the cursor.
    const img = e.currentTarget as HTMLImageElement;
    if (img && 'naturalWidth' in img) {
      e.dataTransfer.setDragImage(img, img.width / 2, img.height / 2);
    }
  };

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-lg border bg-bg-base transition-all',
        aspect,
        selected ? selectedClassName : unselectedClassName,
        className,
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={buttonLabel}
        className="absolute inset-0 flex items-center justify-center bg-bg-elev/60 text-fg-dim"
      >
        {src ? (
          <img
            src={src}
            alt={alt}
            loading={lazy ? 'lazy' : undefined}
            draggable={!!dragPayload}
            onDragStart={dragPayload ? onDragStart : undefined}
            className="h-full w-full object-cover"
            onLoad={(e) => {
              if (!onNaturalSize) return;
              const img = e.currentTarget;
              onNaturalSize(img.naturalWidth, img.naturalHeight);
            }}
          />
        ) : fallback}
      </button>
      {children}
    </div>
  );
}
