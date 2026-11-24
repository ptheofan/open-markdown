/**
 * PreferencesService - Manages application preferences
 *
 * Handles loading, saving, validating, and migrating preferences.
 * Supports both core application preferences and plugin-specific preferences.
 */
import { app } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import { isDeepStrictEqual } from 'util';

import type { AppPreferences, DeepPartial, ThemeMode } from '@shared/types';
import {
  DEFAULT_APP_PREFERENCES,
  PREFERENCES_VERSION,
  clonePreferences,
  deepMerge,
} from '../../preferences';

/**
 * PreferencesService handles preferences management
 */
export class PreferencesService {
  private preferencesPath: string;
  private themePreferencesPath: string;
  private preferences: AppPreferences = clonePreferences(DEFAULT_APP_PREFERENCES);
  private initialized = false;
  private changeListeners: Set<(prefs: AppPreferences) => void> = new Set();

  constructor(preferencesDir?: string) {
    const dir = preferencesDir ?? app.getPath('userData');
    this.preferencesPath = path.join(dir, 'preferences.json');
    this.themePreferencesPath = path.join(dir, 'theme-preferences.json');
  }

  /**
   * Initialize the service and load preferences
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.loadPreferences();
    } catch {
      // Use defaults if preferences can't be loaded
      this.preferences = clonePreferences(DEFAULT_APP_PREFERENCES);
    }

    this.initialized = true;
  }

  /**
   * Get the complete preferences
   */
  getPreferences(): AppPreferences {
    return clonePreferences(this.preferences);
  }

  /**
   * Update preferences with partial data (deep merge)
   */
  async updatePreferences(updates: DeepPartial<AppPreferences>): Promise<void> {
    // Deep merge updates into current preferences
    const merged = deepMerge(this.preferences, updates as Partial<AppPreferences>);

    // Ensure version is maintained
    merged.version = PREFERENCES_VERSION;

    await this.commit(merged);
  }

  /**
   * Make `next` the current preferences: save them and notify listeners.
   *
   * Unchanged preferences are neither written nor broadcast; every broadcast
   * re-renders the open documents (#90). A failed write restores the previous
   * preferences, so retrying the same change is not mistaken for a no-op.
   */
  private async commit(next: AppPreferences): Promise<void> {
    if (isDeepStrictEqual(next, this.preferences)) return;

    const previous = this.preferences;
    this.preferences = next;
    try {
      await this.savePreferences();
    } catch (error) {
      // Leave a newer change that landed during the write alone
      if (this.preferences === next) this.preferences = previous;
      throw error;
    }

    this.notifyListeners();
  }

  /**
   * Reset preferences to defaults
   */
  async resetToDefaults(): Promise<AppPreferences> {
    this.preferences = clonePreferences(DEFAULT_APP_PREFERENCES);
    await this.savePreferences();
    this.notifyListeners();
    return this.getPreferences();
  }

  /**
   * Subscribe to preference changes
   * Returns a cleanup function to unsubscribe
   */
  onPreferencesChange(callback: (prefs: AppPreferences) => void): () => void {
    this.changeListeners.add(callback);

    return () => {
      this.changeListeners.delete(callback);
    };
  }

  /**
   * Get plugin-specific preferences
   */
  getPluginPreferences<T>(pluginId: string): T | null {
    const pluginPrefs = this.preferences.plugins[pluginId];
    if (pluginPrefs === undefined) {
      return null;
    }
    return clonePreferences(pluginPrefs) as T;
  }

  /**
   * Set plugin-specific preferences
   */
  async setPluginPreferences<T>(pluginId: string, prefs: T): Promise<void> {
    await this.commit({
      ...this.preferences,
      plugins: { ...this.preferences.plugins, [pluginId]: prefs },
    });
  }

  /**
   * Get the preferences file path (for testing)
   */
  getPreferencesPath(): string {
    return this.preferencesPath;
  }

  /**
   * Load preferences from disk
   */
  private async loadPreferences(): Promise<void> {
    let loaded = false;

    // Try to load preferences.json first
    try {
      const data = await fs.readFile(this.preferencesPath, 'utf-8');
      const parsed = JSON.parse(data) as unknown;

      if (this.isValidPreferencesStructure(parsed)) {
        // Migrate if needed
        this.preferences = this.migrateIfNeeded(parsed);
        loaded = true;
      }
    } catch (error) {
      // File doesn't exist or is invalid - try migration from old format
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Failed to load preferences:', error);
      }
    }

    // If not loaded, try to migrate from theme-preferences.json
    if (!loaded) {
      await this.migrateFromThemePreferences();
    }
  }

  /**
   * Migrate from old theme-preferences.json format
   */
  private async migrateFromThemePreferences(): Promise<void> {
    try {
      const data = await fs.readFile(this.themePreferencesPath, 'utf-8');
      const parsed = JSON.parse(data) as { theme?: ThemeMode };

      if (parsed.theme && this.isValidThemeMode(parsed.theme)) {
        // Start with defaults and apply old theme preference
        this.preferences = clonePreferences(DEFAULT_APP_PREFERENCES);
        this.preferences.core.theme.mode = parsed.theme;

        // Save migrated preferences
        await this.savePreferences();
      }
    } catch (error) {
      // No old preferences to migrate - use defaults
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Failed to migrate from theme-preferences.json:', error);
      }
      this.preferences = clonePreferences(DEFAULT_APP_PREFERENCES);
    }
  }

  /**
   * Save preferences to disk
   */
  private async savePreferences(): Promise<void> {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.preferencesPath);
      await fs.mkdir(dir, { recursive: true });

      // Write preferences
      await fs.writeFile(
        this.preferencesPath,
        JSON.stringify(this.preferences, null, 2),
        'utf-8'
      );
    } catch (error) {
      console.error('Failed to save preferences:', error);
      throw error;
    }
  }

  /**
   * Notify all listeners of preference changes
   */
  private notifyListeners(): void {
    const prefsCopy = this.getPreferences();
    for (const listener of this.changeListeners) {
      try {
        listener(prefsCopy);
      } catch (error) {
        console.error('Error in preferences change listener:', error);
      }
    }
  }

  /**
   * Check if value is a valid preferences structure
   */
  private isValidPreferencesStructure(value: unknown): value is AppPreferences {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const obj = value as Record<string, unknown>;

    // Must have version number
    if (typeof obj['version'] !== 'number') {
      return false;
    }

    // Must have core object
    if (typeof obj['core'] !== 'object' || obj['core'] === null) {
      return false;
    }

    // Must have plugins object
    if (typeof obj['plugins'] !== 'object' || obj['plugins'] === null) {
      return false;
    }

    return true;
  }

  /**
   * Migrate preferences from older schema versions
   */
  private migrateIfNeeded(stored: AppPreferences): AppPreferences {
    let prefs = clonePreferences(stored);

    // Migration from version 0 (or undefined) to version 1
    // In future, add more migration steps here

    // Ensure all default values exist (fills in missing fields)
    prefs = deepMerge(clonePreferences(DEFAULT_APP_PREFERENCES), prefs);

    // Update version
    prefs.version = PREFERENCES_VERSION;

    return prefs;
  }

  /**
   * Check if a value is a valid ThemeMode
   */
  private isValidThemeMode(value: unknown): value is ThemeMode {
    return value === 'light' || value === 'dark' || value === 'system';
  }
}

// Singleton instance
let preferencesServiceInstance: PreferencesService | null = null;

/**
 * Get the singleton PreferencesService instance
 */
export function getPreferencesService(): PreferencesService {
  if (!preferencesServiceInstance) {
    preferencesServiceInstance = new PreferencesService();
  }
  return preferencesServiceInstance;
}
