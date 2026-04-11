/**
 * ThemeService - Manages system theme detection
 *
 * Theme mode preference (light/dark/system) is stored exclusively
 * by PreferencesService. ThemeService is responsible only for
 * detecting the OS-level theme and notifying listeners of changes.
 */
import { nativeTheme } from 'electron';

import type { ResolvedTheme } from '@shared/types';

/**
 * ThemeService handles system theme detection
 */
export class ThemeService {
  /**
   * Get the system theme (light or dark)
   */
  getSystemTheme(): ResolvedTheme {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  }

  /**
   * Subscribe to system theme changes
   * Returns a cleanup function to unsubscribe
   */
  onSystemThemeChange(callback: (theme: ResolvedTheme) => void): () => void {
    const handler = (): void => {
      callback(this.getSystemTheme());
    };

    nativeTheme.on('updated', handler);

    return () => {
      nativeTheme.off('updated', handler);
    };
  }
}

// Singleton instance
let themeServiceInstance: ThemeService | null = null;

/**
 * Get the singleton ThemeService instance
 */
export function getThemeService(): ThemeService {
  if (!themeServiceInstance) {
    themeServiceInstance = new ThemeService();
  }
  return themeServiceInstance;
}

/**
 * Create a new ThemeService instance (for testing)
 */
export function createThemeService(): ThemeService {
  return new ThemeService();
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetThemeService(): void {
  themeServiceInstance = null;
}
