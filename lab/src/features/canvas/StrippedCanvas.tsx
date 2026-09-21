/**
 * Stripped canvas view — the simpler alternative to the infinite Pixi
 * compositor (ticket #36). Renders a single centered image with rounded
 * corners + drop shadow + soft gradient background. No pan/zoom (the user
 * clicks to open the fullscreen modal which has pan/zoom).
 *
 * Step 1 of #36: minimal version. Shows the selected history entry, or the
 * most-recent one when none selected. Preview-frame streaming + gradient bg
 * derived from image colours land in subsequent steps.
 */
import { useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { useCanvasStore } from '@/lib/canvasStore';
import { viewUrl } from '@/lib/comfy';
import { useImageDominantColor } from '@/hooks/useImageDominantColor';

type Props = {
  navOffset?: number;
  /** Pixel width of an open left side panel (else 0). Same role as on
   *  <InfiniteCanvas>: keep the centered image in the visible area. */
  leftInset?: number;
  /** Same for the right side panel. */
  rightInset?: number;
};

export function StrippedCanvas({ navOffset = 0, leftInset = 0, rightInset = 0 }: Props) {
  const selectedEntry = useStore(s => s.selectedEntry);
  const history = useStore(s => s.history);
  const servers = useStore(s => s.servers);
  const openViewer = useStore(s => s.openViewer);
  const livePreviews = useCanvasStore(s => s.livePreviews);

  // Stable order: servers in their configured order, so concurrent jobs land
  // in deterministic grid cells rather than swapping positions as frames
  // arrive at slightly different rates.
  const previewUrls = useMemo(() => {
    const ordered = servers.map(sv => livePreviews[sv.id]).filter((u): u is string => !!u);
    // Include any preview whose serverId no longer matches a configured
    // server (defensive — shouldn't happen in practice).
    for (const [id, u] of Object.entries(livePreviews)) {
      if (u && !servers.some(sv => sv.id === id)) ordered.push(u);
    }
    return ordered;
  }, [livePreviews, servers]);
  const singlePreviewUrl = previewUrls.length === 1 ? previewUrls[0] : null;

  // Pick what to show in single-image mode: live preview frame (during gen),
  // else selected entry, else most-recent history.
  const entry = useMemo(() => selectedEntry ?? history[0] ?? null, [selectedEntry, history]);
  const staticUrl = useMemo(() => {
    if (!entry) return null;
    const host = servers.find(s => s.id === entry.serverId)?.host;
    return host ? viewUrl(entry, host) : null;
  }, [entry, servers]);
  const url = singlePreviewUrl ?? staticUrl;

  // Track natural aspect ratio so the rendered box hugs the image (so the
  // rounded corners + shadow trace the image edges) while still scaling up
  // to fill the available space — `w-auto h-auto` alone leaves low-res
  // preview frames at their tiny intrinsic size.
  const [aspect, setAspect] = useState<number | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

  // Sample the dominant colour of the currently-shown image. Skip during
  // live previews — the colour can shift wildly between frames, which would
  // make the bg pulse distractingly. Static URL only.
  const tint = useImageDominantColor(previewUrls.length ? null : staticUrl);
  const bgStyle = useMemo(() => {
    if (!tint) return {};
    const { r, g, b } = tint;
    // Soft radial: brighter tint in the centre fading toward bg-base at the
    // edges. The 0.45 / 0.05 alphas keep it subtle on dark themes.
    return {
      background: `
        radial-gradient(ellipse at center,
          rgba(${r}, ${g}, ${b}, 0.45) 0%,
          rgba(${r}, ${g}, ${b}, 0.18) 35%,
          rgba(${r}, ${g}, ${b}, 0.05) 65%,
          transparent 100%)`,
    };
  }, [tint]);

  return (
    <div
      className="relative flex h-full w-full items-center justify-center bg-bg-base transition-[padding] duration-200 ease-out"
      style={{
        // navOffset = TopNav footprint (wrapper pad + bar + wrapper pad = 64).
        // Adding 4 on top lands the image 12px below the bar — matching the
        // 12px gutter on the other three sides for an even frame.
        paddingTop: navOffset + 4,
        paddingBottom: 12,
        paddingLeft: leftInset + 12,
        paddingRight: rightInset + 12,
      }}
    >
      {/* Gradient tint layer — sits between the bg-base solid and the image,
          fades in/out as the static image changes. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-opacity duration-500"
        style={{ ...bgStyle, opacity: tint ? 1 : 0 }}
      />
      {previewUrls.length >= 2 ? (
        // Multiple concurrent generations — lay each server's live preview
        // out in its own cell instead of fighting over the single-image
        // slot (which used to flash between them as frames arrived).
        // 2 → side-by-side; 3-4 → 2×2; >4 → 3-col grid.
        <div
          className="grid h-full w-full gap-3"
          style={{
            gridTemplateColumns:
              previewUrls.length === 2 ? 'repeat(2, minmax(0, 1fr))'
              : previewUrls.length <= 4 ? 'repeat(2, minmax(0, 1fr))'
              : 'repeat(3, minmax(0, 1fr))',
            gridAutoRows: '1fr',
          }}
        >
          {previewUrls.map((u, i) => (
            <div key={i} className="relative flex items-center justify-center overflow-hidden">
              <img
                src={u}
                alt=""
                onClick={() => openViewer()}
                className="block max-h-full max-w-full cursor-pointer rounded-2xl object-contain shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6),_0_8px_24px_-4px_rgba(0,0,0,0.4)] ring-1 ring-white/5"
              />
            </div>
          ))}
        </div>
      ) : url ? (
        // Container-query trick: the img sizes itself to the largest box that
        // fits in the parent while respecting the image's aspect ratio, so the
        // shadow + rounded corners trace the actual image edges instead of
        // either letterboxing (object-contain in a fixed-size box) or
        // stretching (h-full + aspect-ratio on the img).
        <div
          className="relative flex h-full w-full items-center justify-center"
          style={{ containerType: 'size' }}
        >
          <img
            src={url}
            alt=""
            onClick={() => openViewer()}
            title="Open in viewer (Space)"
            onLoad={e => {
              const img = e.currentTarget;
              if (img.naturalWidth && img.naturalHeight) {
                setAspect(img.naturalWidth / img.naturalHeight);
                setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
              }
            }}
            style={aspect ? {
              width: `min(100cqw, 100cqh * ${aspect})`,
              height: `min(100cqh, 100cqw / ${aspect})`,
            } : undefined}
            className="block cursor-pointer rounded-2xl object-contain shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6),_0_8px_24px_-4px_rgba(0,0,0,0.4)] ring-1 ring-white/5 transition-transform hover:scale-[1.005]"
          />
          {naturalSize && aspect && (
            <div
              className="pointer-events-none absolute rounded-md bg-black/55 px-2 py-1 font-mono text-[10px] tracking-tight text-white/85 backdrop-blur-sm"
              // Pin the overlay to the bottom-left of the actual image box (not
              // the surrounding container, which can be much wider/taller),
              // mirroring the same min() sizing used by the img.
              style={{
                bottom: `calc(50% - min(50cqh, 50cqw / ${aspect}) + 8px)`,
                left: `calc(50% - min(50cqw, 50cqh * ${aspect}) + 8px)`,
              }}
            >
              {naturalSize.w} × {naturalSize.h}
            </div>
          )}
        </div>
      ) : (
        <div className="text-[12px] italic text-fg-muted">No image yet — generate something to see it here</div>
      )}
    </div>
  );
}
