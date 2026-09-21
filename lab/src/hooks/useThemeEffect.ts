import { useEffect } from 'react';
import { useStore } from '@/lib/store';
import { applyTheme, resolveTheme } from '@/lib/themes';

/**
 * Writes CSS custom properties on :root and lazy-loads the theme's Google
 * Font. Re-runs when the user picks a different theme or edits the custom
 * theme they're using.
 */
export function useThemeEffect() {
  const themeId = useStore(s => s.themeId);
  const customThemes = useStore(s => s.customThemes);
  useEffect(() => {
    applyTheme(resolveTheme(themeId, customThemes));
  }, [themeId, customThemes]);
}
