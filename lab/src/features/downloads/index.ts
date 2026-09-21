/**
 * Downloads — CivitAI model downloads across every server.
 *
 *   store.ts            — feature-scoped store (rows, refresh, start, cancel)
 *   DownloadsButton.tsx — toolbar badge + popover panel
 *
 * Polling lives in `@/hooks/useDownloads` (mounted once near the app root).
 */
export { DownloadsButton } from './DownloadsButton';
export { useDownloadsStore, type DownloadRow } from './store';
