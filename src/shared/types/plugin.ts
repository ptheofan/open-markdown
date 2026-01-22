import type MarkdownIt from 'markdown-it';
import type { ContextMenuItem } from './api';
import type { PluginThemeDeclaration } from '../../themes/types';

/**
 * Plugin metadata for identification and display
 */
export interface PluginMetadata {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
}

/**
 * Plugin configuration options
 */
export type PluginOptions = Record<string, unknown>;

/**
 * Data returned by plugin for context menu action
 */
export interface ContextMenuData {
  type: 'text' | 'html' | 'image' | 'file-save';
  content: string;
  mimeType?: string;
  filename?: string;
}

/**
 * Interface that all markdown plugins must implement
 */
export interface MarkdownPlugin {
  /**
   * Plugin identification and metadata
   */
  metadata: PluginMetadata;

  /**
   * Called when plugin is registered, before apply()
   * Use for async initialization (e.g., loading external resources)
   */
  initialize?: () => Promise<void> | void;

  /**
   * Apply markdown-it plugin modifications
   * @param md - The markdown-it instance to modify
   */
  apply: (md: MarkdownIt) => void;

  /**
   * Get CSS styles to inject for this plugin
   * @returns CSS string(s) or path(s) to CSS files
   */
  getStyles?: () => string | string[];

  /**
   * Declare theme variables this plugin uses
   * These will be included in the theme system and update with theme changes
   * @returns Map of variable names to their light/dark values
   */
  getThemeVariables?: () => PluginThemeDeclaration;

  /**
   * Post-render processing hook
   * Called after HTML is rendered and inserted into DOM
   * Use for plugins that need to modify rendered content (e.g., Mermaid)
   * @param container - The container element with rendered content
   */
  postRender?: (container: HTMLElement) => Promise<void> | void;

  /**
   * Cleanup when plugin is unregistered
   * Use for releasing resources
   */
  destroy?: () => Promise<void> | void;

  /**
   * Get context menu items for a right-clicked element
   * @param element - The element that was right-clicked
   * @returns Menu items if plugin owns element, null otherwise
   */
  getContextMenuItems?: (element: HTMLElement) => ContextMenuItem[] | null;

  /**
   * Generate data for a selected menu item
   * @param element - The element that was right-clicked
   * @param menuItemId - The ID of the selected menu item
   * @returns Data to write to clipboard or save to file
   */
  getContextMenuData?: (
    element: HTMLElement,
    menuItemId: string
  ) => Promise<ContextMenuData>;
}

/**
 * Plugin manager configuration
 */
export interface PluginManagerConfig {
  enabledPlugins: string[];
  pluginOptions: Record<string, PluginOptions>;
}

/**
 * Result of loading a plugin
 */
export interface PluginLoadResult {
  success: boolean;
  pluginId: string;
  error?: string;
}

/**
 * Plugin registration event
 */
export interface PluginRegistrationEvent {
  pluginId: string;
  metadata: PluginMetadata;
  action: 'registered' | 'unregistered';
}
