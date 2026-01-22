/**
 * PluginManager - Manages plugin lifecycle and configuration
 */
import { PluginAlreadyRegisteredError } from '@shared/errors';

import { MarkdownRenderer, createMarkdownRenderer } from './MarkdownRenderer';

import type { MarkdownRendererOptions } from './MarkdownRenderer';
import type {
  MarkdownPlugin,
  PluginMetadata,
  PluginOptions,
  PluginManagerConfig,
  PluginLoadResult,
} from '@shared/types';
import type { PluginThemeDeclaration } from '../../themes/types';

/**
 * Plugin factory function type
 */
export type PluginFactory = (options?: PluginOptions) => MarkdownPlugin;

/**
 * PluginManager - Central manager for all markdown plugins
 */
export class PluginManager {
  private renderer: MarkdownRenderer;
  private availablePlugins: Map<string, PluginFactory> = new Map();
  private pluginOptions: Map<string, PluginOptions> = new Map();
  private enabledPlugins: Set<string> = new Set();

  constructor(rendererOptions?: MarkdownRendererOptions) {
    this.renderer = createMarkdownRenderer(rendererOptions);
  }

  /**
   * Register a plugin factory
   * Plugin won't be enabled until explicitly enabled
   */
  registerPluginFactory(pluginId: string, factory: PluginFactory): void {
    if (this.availablePlugins.has(pluginId)) {
      throw new PluginAlreadyRegisteredError(pluginId);
    }
    this.availablePlugins.set(pluginId, factory);
  }

  /**
   * Enable a plugin by ID
   */
  async enablePlugin(
    pluginId: string,
    options?: PluginOptions
  ): Promise<PluginLoadResult> {
    if (this.enabledPlugins.has(pluginId)) {
      return {
        success: true,
        pluginId,
      };
    }

    const factory = this.availablePlugins.get(pluginId);
    if (!factory) {
      return {
        success: false,
        pluginId,
        error: `Plugin '${pluginId}' not found. Available plugins: ${Array.from(this.availablePlugins.keys()).join(', ')}`,
      };
    }

    try {
      // Store options for this plugin
      if (options) {
        this.pluginOptions.set(pluginId, options);
      }

      // Create plugin instance
      const plugin = factory(this.pluginOptions.get(pluginId));

      // Register with renderer
      await this.renderer.registerPlugin(plugin);

      this.enabledPlugins.add(pluginId);

      return {
        success: true,
        pluginId,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        pluginId,
        error: errorMessage,
      };
    }
  }

  /**
   * Disable a plugin by ID
   */
  async disablePlugin(pluginId: string): Promise<void> {
    if (!this.enabledPlugins.has(pluginId)) {
      return;
    }

    await this.renderer.unregisterPlugin(pluginId);
    this.enabledPlugins.delete(pluginId);
  }

  /**
   * Enable multiple plugins at once
   */
  async enablePlugins(
    pluginIds: string[],
    options?: Record<string, PluginOptions>
  ): Promise<PluginLoadResult[]> {
    const results: PluginLoadResult[] = [];

    for (const pluginId of pluginIds) {
      const result = await this.enablePlugin(
        pluginId,
        options?.[pluginId]
      );
      results.push(result);
    }

    return results;
  }

  /**
   * Render markdown using registered plugins
   */
  render(markdown: string): string {
    return this.renderer.render(markdown);
  }

  /**
   * Render inline markdown
   */
  renderInline(markdown: string): string {
    return this.renderer.renderInline(markdown);
  }

  /**
   * Run post-render processing for all enabled plugins
   */
  async postRender(container: HTMLElement): Promise<void> {
    await this.renderer.postRender(container);
  }

  /**
   * Get CSS styles from all enabled plugins
   */
  getPluginStyles(): string[] {
    return this.renderer.getPluginStyles();
  }

  /**
   * Get aggregated theme variable declarations from all enabled plugins
   */
  getPluginThemeDeclarations(): PluginThemeDeclaration {
    return this.renderer.getPluginThemeDeclarations();
  }

  /**
   * Get list of available plugins
   */
  getAvailablePlugins(): string[] {
    return Array.from(this.availablePlugins.keys());
  }

  /**
   * Get list of enabled plugins
   */
  getEnabledPlugins(): string[] {
    return Array.from(this.enabledPlugins);
  }

  /**
   * Get metadata for enabled plugins
   */
  getEnabledPluginMetadata(): PluginMetadata[] {
    return this.renderer.getRegisteredPlugins();
  }

  /**
   * Check if a plugin is enabled
   */
  isPluginEnabled(pluginId: string): boolean {
    return this.enabledPlugins.has(pluginId);
  }

  /**
   * Check if a plugin is available
   */
  isPluginAvailable(pluginId: string): boolean {
    return this.availablePlugins.has(pluginId);
  }

  /**
   * Get a plugin instance by ID
   */
  getPlugin<T extends MarkdownPlugin = MarkdownPlugin>(pluginId: string): T | undefined {
    return this.renderer.getPlugin<T>(pluginId);
  }

  /**
   * Get current configuration
   */
  getConfig(): PluginManagerConfig {
    return {
      enabledPlugins: Array.from(this.enabledPlugins),
      pluginOptions: Object.fromEntries(this.pluginOptions),
    };
  }

  /**
   * Load configuration
   */
  async loadConfig(config: PluginManagerConfig): Promise<PluginLoadResult[]> {
    // Disable all current plugins
    for (const pluginId of this.enabledPlugins) {
      await this.disablePlugin(pluginId);
    }

    // Apply options
    for (const [pluginId, options] of Object.entries(config.pluginOptions)) {
      this.pluginOptions.set(pluginId, options);
    }

    // Enable configured plugins
    return this.enablePlugins(config.enabledPlugins);
  }

  /**
   * Get the underlying renderer
   */
  getRenderer(): MarkdownRenderer {
    return this.renderer;
  }
}

/**
 * Create a PluginManager with default built-in plugins registered
 */
export function createPluginManager(
  rendererOptions?: MarkdownRendererOptions
): PluginManager {
  return new PluginManager(rendererOptions);
}
