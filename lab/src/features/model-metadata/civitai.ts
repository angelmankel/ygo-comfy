/**
 * Model-metadata view helpers — formatting + shaping for the metadata modal.
 *
 * The CivitAI network + cache layer (and the API type definitions) live in
 * `@/lib/civitai`; this module re-exports the types the feature renders and
 * the cached `fetchCivitaiModel` fetcher, then adds the display-only helpers.
 */
export type {
  CivitaiCreator,
  CivitaiStats,
  CivitaiFileMetadata,
  CivitaiFile,
  CivitaiImageMeta,
  CivitaiImage,
  CivitaiModelVersion,
  CivitaiModel,
  NsfwFilter,
} from '@/lib/civitai';
export { fetchCivitaiModel, fetchCivitaiImages } from '@/lib/civitai';

import type { CivitaiModelVersion, CivitaiFile } from '@/lib/civitai';

/** The model's public CivitAI page URL. */
export function civitaiModelUrl(modelId: number): string {
  return `https://civitai.com/models/${modelId}`;
}

/** Human-readable file size from CivitAI's `sizeKB`. */
export function formatFileSize(sizeKB: number): string {
  if (sizeKB >= 1024 * 1024) return `${(sizeKB / 1024 / 1024).toFixed(2)} GB`;
  if (sizeKB >= 1024) return `${(sizeKB / 1024).toFixed(1)} MB`;
  return `${Math.round(sizeKB)} KB`;
}

/** Compact count display, e.g. 601851 → "601.9k". */
export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Short readable date from an ISO string, e.g. "Apr 2024". Empty when unparseable. */
export function formatDate(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

/**
 * CivitAI descriptions are HTML. Rather than dangerously inject third-party
 * markup, flatten it to readable plain text for display.
 */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The primary downloadable file of a version (or the first, or null). */
export function primaryFile(version: CivitaiModelVersion): CivitaiFile | null {
  const files = version.files ?? [];
  return files.find((f) => f.primary) ?? files[0] ?? null;
}
