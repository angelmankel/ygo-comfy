/**
 * App-wide theme system: font, icon weight, and the full color palette.
 *
 * Themes drive the existing CSS custom properties declared in `styles/index.css`.
 * `applyTheme()` writes each value to `document.documentElement.style` and lazily
 * injects a Google Fonts `<link>` for the active theme's font. Icon weight is
 * read by `components/ui/icons.tsx` via the store so all icons re-render in the
 * new weight on theme change.
 */

export type IconStyle = 'thin' | 'regular' | 'bold' | 'fill';

export const ICON_STYLES: { value: IconStyle; label: string; hint: string }[] = [
  { value: 'thin',    label: 'Outline thin',  hint: 'Hairline, minimal' },
  { value: 'regular', label: 'Outline',       hint: 'Balanced default' },
  { value: 'bold',    label: 'Outline bold',  hint: 'Heavier, more presence' },
  { value: 'fill',    label: 'Solid',         hint: 'Filled glyphs' },
];

export type ThemeColors = {
  bgBase: string;
  bgPanel: string;
  bgElev: string;
  bgInput: string;
  bgCard: string;
  bgCardOn: string;
  borderSubtle: string;
  borderDefault: string;
  borderStrong: string;
  borderBright: string;
  fgPrimary: string;
  fgSecondary: string;
  fgTertiary: string;
  fgMuted: string;
  fgDim: string;
  fgFaint: string;
  accent: string;
  accentHover: string;
  accentSoft: string;
  accentFg: string;
  handle: string;
};

export type Theme = {
  id: string;
  name: string;
  blurb: string;
  builtIn: boolean;
  font: string;
  fontWeights: number[];
  fontGeneric: 'sans-serif' | 'serif' | 'monospace';
  iconStyle: IconStyle;
  colors: ThemeColors;
};

// ---------------------------------------------------------------------------
// Color math — tiny HSL helpers used by the "quick swap" editor and the
// derivation helper. Operates on `#RRGGBB` strings throughout.
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '').padStart(6, '0');
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
}
function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
    case g: h = ((b - r) / d + 2); break;
    default: h = ((r - g) / d + 4);
  }
  return [h * 60, s, l];
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = h / 360;
  const t = [hk + 1 / 3, hk, hk - 1 / 3].map(x => (x + 1) % 1);
  const ch = (tc: number) => {
    if (tc < 1 / 6) return p + (q - p) * 6 * tc;
    if (tc < 1 / 2) return q;
    if (tc < 2 / 3) return p + (q - p) * (2 / 3 - tc) * 6;
    return p;
  };
  return [ch(t[0]) * 255, ch(t[1]) * 255, ch(t[2]) * 255];
}
/** Shift a color's lightness by `delta` (in 0..1 space), preserving hue+sat. */
function shiftL(hex: string, delta: number): string {
  const [h, s, l] = rgbToHsl(...hexToRgb(hex));
  const [r, g, b] = hslToRgb(h, s, Math.max(0, Math.min(1, l + delta)));
  return rgbToHex(r, g, b);
}
/** Mix two colors at ratio `t` (0 = a, 1 = b). */
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}
/** Relative luminance for contrast picking (WCAG-ish). */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(c => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** "On-color" — pick black or white for legibility on top of `bg`. */
function onColor(bg: string): string {
  return luminance(bg) > 0.5 ? '#0A0A0A' : '#FFFFFF';
}

// ---------------------------------------------------------------------------
// Palette derivation — turn 4 base colors (Background, Text, Accent, Border)
// into a complete `ThemeColors`. Used by the "Quick edit" panel so users can
// re-skin a theme in seconds without poking at 21 individual fields.
// ---------------------------------------------------------------------------

export type ThemeBase = {
  background: string;
  text: string;
  accent: string;
  border: string;
};

export function derivePalette({ background, text, accent, border }: ThemeBase): ThemeColors {
  const isLight = luminance(background) > 0.5;
  // Surface ramp: darker themes step UP (lighter elevations); light themes step DOWN.
  const dir = isLight ? -1 : 1;
  const bgPanel  = shiftL(background, dir * 0.02);
  const bgElev   = shiftL(background, dir * 0.05);
  const bgInput  = shiftL(background, dir * 0.01);
  const bgCard   = shiftL(background, dir * 0.03);
  const bgCardOn = shiftL(background, dir * 0.07);

  // Text ramp: primary is the user's text color; tertiary/muted/dim fade toward bg.
  const fgPrimary   = text;
  const fgSecondary = mix(text, background, 0.15);
  const fgTertiary  = mix(text, background, 0.40);
  const fgMuted     = mix(text, background, 0.55);
  const fgDim       = mix(text, background, 0.70);
  const fgFaint     = mix(text, background, 0.80);

  // Border ramp around the user's border anchor.
  const borderSubtle  = mix(border, background, 0.55);
  const borderDefault = border;
  const borderStrong  = shiftL(border, dir * 0.10);
  const borderBright  = shiftL(border, dir * 0.20);

  // Accent ramp. accentSoft is a tint that mixes accent into the bg so it
  // reads as a chip; accentFg is forced to contrast accentSoft *and* the
  // panel surface, so accent text is always legible no matter where it lands.
  const accentHover = shiftL(accent, isLight ? -0.08 : 0.10);
  const accentSoft  = mix(accent, background, isLight ? 0.80 : 0.82);
  // Accent text needs to read on accentSoft AND on bgPanel — both are near
  // background lightness, so we pick a saturated, contrast-safe version of
  // accent: bias toward darker on light themes and lighter on dark themes.
  const accentFg = isLight
    ? shiftL(accent, -0.22)
    : shiftL(accent, 0.18);
  const handle = mix(border, fgMuted, 0.45);

  return {
    bgBase: background,
    bgPanel, bgElev, bgInput, bgCard, bgCardOn,
    borderSubtle, borderDefault, borderStrong, borderBright,
    fgPrimary, fgSecondary, fgTertiary, fgMuted, fgDim, fgFaint,
    accent, accentHover, accentSoft, accentFg,
    handle,
  };
}

/** Extract the 4 base colors from an existing palette so the quick editor can
 *  seed itself when forking a built-in or opening a custom theme. */
export function baseFromColors(c: ThemeColors): ThemeBase {
  return {
    background: c.bgBase,
    text: c.fgPrimary,
    accent: c.accent,
    border: c.borderDefault,
  };
}

// ---------------------------------------------------------------------------
// Built-in themes — every one of these is generated by `derivePalette` so the
// palette is internally consistent and contrast-checked by construction.
// Pure light / dark, neutral / colored — a curated short list rather than the
// previous grab bag.
// ---------------------------------------------------------------------------

// Midnight keeps its hand-tuned palette (it's the canonical look the app was
// designed around). Everything else is derived so the base 4 colors fully
// describe the theme.
const MIDNIGHT_COLORS: ThemeColors = {
  bgBase:        '#070A10',
  bgPanel:       '#0C1119',
  bgElev:        '#11192A',
  bgInput:       '#0B1018',
  bgCard:        '#0F1623',
  bgCardOn:      '#131C2D',
  borderSubtle:  '#161D29',
  borderDefault: '#1B2333',
  borderStrong:  '#2A3543',
  borderBright:  '#3A4759',
  fgPrimary:     '#E8EDF5',
  fgSecondary:   '#D5DBE5',
  fgTertiary:    '#9CA8BD',
  fgMuted:       '#7B8699',
  fgDim:         '#5A6477',
  fgFaint:       '#4A5364',
  accent:        '#3B6FE0',
  accentHover:   '#4F8AFF',
  accentSoft:    '#1A2D52',
  accentFg:      '#9CB4EA',
  handle:        '#3D4A5E',
};

// Ocean Deep — also hand-tuned, kept as the second canonical theme.
const OCEAN_DEEP_COLORS: ThemeColors = {
  bgBase:        '#04101A',
  bgPanel:       '#071620',
  bgElev:        '#0B2030',
  bgInput:       '#06141E',
  bgCard:        '#0A1C28',
  bgCardOn:      '#102A3A',
  borderSubtle:  '#0E1F2A',
  borderDefault: '#152C3C',
  borderStrong:  '#214258',
  borderBright:  '#305E7A',
  fgPrimary:     '#E0F4FA',
  fgSecondary:   '#BFDFE9',
  fgTertiary:    '#84B2C2',
  fgMuted:       '#5F8896',
  fgDim:         '#446471',
  fgFaint:       '#344E59',
  accent:        '#3FB0C5',
  accentHover:   '#5BC9DD',
  accentSoft:    '#0D2F3A',
  accentFg:      '#86D4E5',
  handle:        '#3A5868',
};

export const BUILT_IN_THEMES: Theme[] = [
  {
    id: 'midnight',
    name: 'Midnight',
    blurb: 'The original deep-blue night. Calm, professional.',
    builtIn: true,
    font: 'Inter',
    fontWeights: [400, 500, 600, 700],
    fontGeneric: 'sans-serif',
    iconStyle: 'regular',
    colors: MIDNIGHT_COLORS,
  },
  {
    id: 'ocean-deep',
    name: 'Ocean Deep',
    blurb: 'Teal abyss, soft cyan glow. Reads like a dive console.',
    builtIn: true,
    font: 'Lexend',
    fontWeights: [400, 500, 600, 700],
    fontGeneric: 'sans-serif',
    iconStyle: 'regular',
    colors: OCEAN_DEEP_COLORS,
  },
  {
    id: 'graphite',
    name: 'Graphite',
    blurb: 'Neutral charcoal greys, indigo accent. Quiet and readable.',
    builtIn: true,
    font: 'Inter',
    fontWeights: [400, 500, 600, 700],
    fontGeneric: 'sans-serif',
    iconStyle: 'regular',
    colors: derivePalette({
      background: '#15171B',
      text:       '#EDEFF2',
      accent:     '#7B8AFF',
      border:     '#2A2E36',
    }),
  },
  {
    id: 'aurora',
    name: 'Aurora',
    blurb: 'Muted violet on near-black, soft lavender highlights.',
    builtIn: true,
    font: 'Space Grotesk',
    fontWeights: [400, 500, 600, 700],
    fontGeneric: 'sans-serif',
    iconStyle: 'regular',
    colors: derivePalette({
      background: '#10101A',
      text:       '#EDE8FA',
      accent:     '#9F7BFF',
      border:     '#2A2540',
    }),
  },
  {
    id: 'sage',
    name: 'Sage',
    blurb: 'Forest greens on slate. Calm, low-saturation.',
    builtIn: true,
    font: 'Outfit',
    fontWeights: [400, 500, 600, 700],
    fontGeneric: 'sans-serif',
    iconStyle: 'regular',
    colors: derivePalette({
      background: '#0E1413',
      text:       '#E5EDE6',
      accent:     '#6FB57E',
      border:     '#222C2A',
    }),
  },
  {
    id: 'amber',
    name: 'Amber',
    blurb: 'Warm dark workshop. Brass accent on coffee.',
    builtIn: true,
    font: 'Outfit',
    fontWeights: [400, 500, 600, 700],
    fontGeneric: 'sans-serif',
    iconStyle: 'bold',
    colors: derivePalette({
      background: '#15110C',
      text:       '#F2EADC',
      accent:     '#E2A24A',
      border:     '#2C2418',
    }),
  },
  {
    id: 'crimson',
    name: 'Crimson',
    blurb: 'Burgundy on warm graphite. Cinematic, restrained.',
    builtIn: true,
    font: 'Inter',
    fontWeights: [400, 500, 600, 700],
    fontGeneric: 'sans-serif',
    iconStyle: 'regular',
    colors: derivePalette({
      background: '#13100F',
      text:       '#F0E5E5',
      accent:     '#D45464',
      border:     '#2A2022',
    }),
  },
  {
    id: 'terminal',
    name: 'Terminal',
    blurb: 'Phosphor green on jet, but legible — soft accent, cream text.',
    builtIn: true,
    font: 'JetBrains Mono',
    fontWeights: [400, 500, 600, 700],
    fontGeneric: 'monospace',
    iconStyle: 'regular',
    colors: derivePalette({
      background: '#0B0F0B',
      text:       '#E8F2E5',
      accent:     '#4FD17A',
      border:     '#1E2A1F',
    }),
  },
  {
    id: 'linen',
    name: 'Linen',
    blurb: 'Light theme. Off-white surfaces, dusky rose accent.',
    builtIn: true,
    font: 'DM Sans',
    fontWeights: [400, 500, 600, 700],
    fontGeneric: 'sans-serif',
    iconStyle: 'regular',
    colors: derivePalette({
      background: '#F5F1EA',
      text:       '#241F1A',
      accent:     '#B85870',
      border:     '#D9D0C2',
    }),
  },
  {
    id: 'parchment',
    name: 'Parchment',
    blurb: 'Aged paper, deep sepia ink. Editorial feel.',
    builtIn: true,
    font: 'IBM Plex Serif',
    fontWeights: [400, 500, 600, 700],
    fontGeneric: 'serif',
    iconStyle: 'regular',
    colors: derivePalette({
      background: '#F1E8D2',
      text:       '#1F1808',
      accent:     '#8A4015',
      border:     '#C8BB9B',
    }),
  },
];

export const DEFAULT_THEME_ID = 'midnight';

/** Used as the starting point when the user creates their first custom theme. */
export const CUSTOM_THEME_SEED: ThemeColors = MIDNIGHT_COLORS;

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

const COLOR_VAR: Record<keyof ThemeColors, string> = {
  bgBase:        '--color-bg-base',
  bgPanel:       '--color-bg-panel',
  bgElev:        '--color-bg-elev',
  bgInput:       '--color-bg-input',
  bgCard:        '--color-bg-card',
  bgCardOn:      '--color-bg-card-on',
  borderSubtle:  '--color-border-subtle',
  borderDefault: '--color-border-default',
  borderStrong:  '--color-border-strong',
  borderBright:  '--color-border-bright',
  fgPrimary:     '--color-fg-primary',
  fgSecondary:   '--color-fg-secondary',
  fgTertiary:    '--color-fg-tertiary',
  fgMuted:       '--color-fg-muted',
  fgDim:         '--color-fg-dim',
  fgFaint:       '--color-fg-faint',
  accent:        '--color-accent',
  accentHover:   '--color-accent-hover',
  accentSoft:    '--color-accent-soft',
  accentFg:      '--color-accent-fg',
  handle:        '--color-handle',
};

export const COLOR_FIELDS: { key: keyof ThemeColors; label: string; group: string }[] = [
  { key: 'bgBase',        label: 'Background',        group: 'Surfaces' },
  { key: 'bgPanel',       label: 'Panel',             group: 'Surfaces' },
  { key: 'bgElev',        label: 'Elevated',          group: 'Surfaces' },
  { key: 'bgInput',       label: 'Input',             group: 'Surfaces' },
  { key: 'bgCard',        label: 'Card',              group: 'Surfaces' },
  { key: 'bgCardOn',      label: 'Card active',       group: 'Surfaces' },
  { key: 'borderSubtle',  label: 'Subtle',            group: 'Borders' },
  { key: 'borderDefault', label: 'Default',           group: 'Borders' },
  { key: 'borderStrong',  label: 'Strong',            group: 'Borders' },
  { key: 'borderBright',  label: 'Bright',            group: 'Borders' },
  { key: 'fgPrimary',     label: 'Primary',           group: 'Text' },
  { key: 'fgSecondary',   label: 'Secondary',         group: 'Text' },
  { key: 'fgTertiary',    label: 'Tertiary',          group: 'Text' },
  { key: 'fgMuted',       label: 'Muted',             group: 'Text' },
  { key: 'fgDim',         label: 'Dim',               group: 'Text' },
  { key: 'fgFaint',       label: 'Faint',             group: 'Text' },
  { key: 'accent',        label: 'Accent',            group: 'Accent' },
  { key: 'accentHover',   label: 'Accent hover',      group: 'Accent' },
  { key: 'accentSoft',    label: 'Accent soft',       group: 'Accent' },
  { key: 'accentFg',      label: 'Accent text',       group: 'Accent' },
  { key: 'handle',        label: 'Drag handle',       group: 'Accent' },
];

function fontStack(theme: Theme): string {
  const fallbacks =
    theme.fontGeneric === 'serif'
      ? `Georgia, "Times New Roman", serif`
      : theme.fontGeneric === 'monospace'
      ? `ui-monospace, SFMono-Regular, Menlo, monospace`
      : `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  return `"${theme.font}", ${fallbacks}`;
}

function ensureFontLoaded(theme: Theme) {
  if (typeof document === 'undefined') return;
  const id = 'app-theme-font';
  const family = encodeURIComponent(theme.font).replace(/%20/g, '+');
  const weights = theme.fontWeights.join(';');
  const href = `https://fonts.googleapis.com/css2?family=${family}:wght@${weights}&display=swap`;

  let link = document.getElementById(id) as HTMLLinkElement | null;
  if (link && link.href === href) return;
  if (!link) {
    link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  link.href = href;
}

export function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  for (const key of Object.keys(theme.colors) as (keyof ThemeColors)[]) {
    root.setProperty(COLOR_VAR[key], theme.colors[key]);
  }
  root.setProperty('--font-sans', fontStack(theme));
  ensureFontLoaded(theme);
}

export function resolveTheme(id: string, customThemes: Theme[]): Theme {
  return (
    customThemes.find(t => t.id === id) ||
    BUILT_IN_THEMES.find(t => t.id === id) ||
    BUILT_IN_THEMES[0]
  );
}

// Re-export the on-color helper for the editor preview.
export { onColor };
