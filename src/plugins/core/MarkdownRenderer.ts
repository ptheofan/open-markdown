/**
 * MarkdownRenderer - Wrapper around markdown-it with plugin support
 */
import { PluginInitError, PluginRenderError } from '@shared/errors';
import MarkdownIt from 'markdown-it';


import type { MarkdownPlugin, PluginMetadata } from '@shared/types';
import type { PluginThemeDeclaration } from '../../themes/types';

/**
 * Options for the MarkdownRenderer
 */
export interface MarkdownRendererOptions {
  html?: boolean;
  linkify?: boolean;
  typographer?: boolean;
  breaks?: boolean;
}

/**
 * Markdown renderer with plugin support
 */
export class MarkdownRenderer {
  private md: MarkdownIt;
  private plugins: Map<string, MarkdownPlugin> = new Map();

  constructor(options: MarkdownRendererOptions = {}) {
    this.md = new MarkdownIt({
      html: options.html ?? true,
      linkify: options.linkify ?? true,
      typographer: options.typographer ?? true,
      breaks: options.breaks ?? false,
    });
  }

  /**
   * Register a plugin with the renderer
   */
  async registerPlugin(plugin: MarkdownPlugin): Promise<void> {
    const { id } = plugin.metadata;

    if (this.plugins.has(id)) {
      throw new PluginInitError(id, 'Plugin already registered');
    }

    try {
      // Initialize plugin if it has an initializer
      if (plugin.initialize) {
        await plugin.initialize();
      }

      // Apply plugin to markdown-it instance
      plugin.apply(this.md);

      // Store plugin reference
      this.plugins.set(id, plugin);
    } catch (error) {
      throw new PluginInitError(
        id,
        error instanceof Error ? error.message : 'Unknown initialization error'
      );
    }
  }

  /**
   * Unregister a plugin from the renderer
   */
  async unregisterPlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      return;
    }

    try {
      if (plugin.destroy) {
        await plugin.destroy();
      }
    } finally {
      this.plugins.delete(pluginId);
    }

    // Note: We cannot truly "unapply" a markdown-it plugin
    // For full removal, renderer needs to be recreated
  }

  /**
   * Render markdown to HTML
   */
  render(markdown: string): string {
    try {
      return this.md.render(markdown);
    } catch (error) {
      throw new PluginRenderError(
        'markdown-it',
        error instanceof Error ? error.message : 'Render failed'
      );
    }
  }

  /**
   * Render markdown inline (no paragraph wrapper)
   */
  renderInline(markdown: string): string {
    try {
      return this.md.renderInline(markdown);
    } catch (error) {
      throw new PluginRenderError(
        'markdown-it',
        error instanceof Error ? error.message : 'Render failed'
      );
    }
  }

  /**
   * Run post-render hooks for all plugins
   * Call this after inserting rendered HTML into DOM
   */
  async postRender(container: HTMLElement): Promise<void> {
    for (const [pluginId, plugin] of this.plugins) {
      if (plugin.postRender) {
        try {
          await plugin.postRender(container);
        } catch (error) {
          console.error(`Post-render error in plugin ${pluginId}:`, error);
          // Continue with other plugins even if one fails
        }
      }
    }
  }

  /**
   * Get CSS styles from all registered plugins
   */
  getPluginStyles(): string[] {
    const styles: string[] = [];

    for (const plugin of this.plugins.values()) {
      if (plugin.getStyles) {
        const pluginStyles = plugin.getStyles();
        if (Array.isArray(pluginStyles)) {
          styles.push(...pluginStyles);
        } else {
          styles.push(pluginStyles);
        }
      }
    }

    return styles;
  }

  /**
   * Get aggregated theme variable declarations from all plugins
   */
  getPluginThemeDeclarations(): PluginThemeDeclaration {
    const aggregated: PluginThemeDeclaration = {};

    for (const [pluginId, plugin] of this.plugins) {
      if (plugin.getThemeVariables) {
        const declarations = plugin.getThemeVariables();
        for (const [name, values] of Object.entries(declarations)) {
          if (aggregated[name]) {
            console.warn(
              `[MarkdownRenderer] Duplicate theme variable --${name} from plugin ${pluginId}`
            );
          }
          aggregated[name] = values;
        }
      }
    }

    return aggregated;
  }

  /**
   * Get metadata for all registered plugins
   */
  getRegisteredPlugins(): PluginMetadata[] {
    return Array.from(this.plugins.values()).map((p) => p.metadata);
  }

  /**
   * Check if a plugin is registered
   */
  hasPlugin(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }

  /**
   * Get a plugin by ID
   */
  getPlugin<T extends MarkdownPlugin = MarkdownPlugin>(pluginId: string): T | undefined {
    return this.plugins.get(pluginId) as T | undefined;
  }

  /**
   * Get the underlying markdown-it instance (for advanced use)
   */
  getMarkdownIt(): MarkdownIt {
    return this.md;
  }

  /**
   * Get plugin count
   */
  get pluginCount(): number {
    return this.plugins.size;
  }
}

/**
 * Create a new MarkdownRenderer instance
 */
export function createMarkdownRenderer(
  options?: MarkdownRendererOptions
): MarkdownRenderer {
  return new MarkdownRenderer(options);
}
