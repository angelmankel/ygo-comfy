/**
 * ImageLab brand mark — a GPU die with a camera lens at its core.
 *
 * Self-contained multi-colour SVG (no `currentColor`); the palette is baked in
 * so it reads the same on any surface. This is the simplified small-size cut of
 * the logo — fewer lens rings, thicker traces, no corner mounting holes — tuned
 * to stay legible down to ~24px. Drawn on a 48-unit viewBox.
 */
type LogoProps = {
  /** Rendered width/height in px. Default 28 (the side-rail size). */
  size?: number;
  className?: string;
  /** Accessible name + tooltip. */
  title?: string;
};

export function Logo({ size = 28, className, title = 'ImageLab' }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>

      {/* Chip die */}
      <rect x="3" y="3" width="42" height="42" rx="11" fill="#2E6B62" stroke="#16302C" strokeWidth="1.5" />

      {/* Copper edge traces */}
      <g fill="#C8825C">
        <rect x="17" y="4.5" width="14" height="3" rx="1.5" />
        <rect x="17" y="40.5" width="14" height="3" rx="1.5" />
        <rect x="4.5" y="17" width="3" height="14" rx="1.5" />
        <rect x="40.5" y="17" width="3" height="14" rx="1.5" />
      </g>

      {/* Brushed-metal lens bezel */}
      <rect x="13" y="13" width="22" height="22" rx="7" fill="#9C9D96" stroke="#54544E" strokeWidth="1" />

      {/* Concentric camera lens */}
      <circle cx="24" cy="24" r="9" fill="#0C1413" />
      <circle cx="24" cy="24" r="7.5" fill="#2F6B66" stroke="#7FD8CC" strokeWidth="0.6" />
      <circle cx="24" cy="24" r="4.5" fill="#4FA39A" />
      <circle cx="24" cy="24" r="2.4" fill="#69C5B9" />
      <circle cx="24" cy="24" r="1" fill="#0A1716" />

      {/* Specular glint */}
      <circle cx="21.6" cy="21.6" r="0.9" fill="#D7F5EE" />
    </svg>
  );
}
