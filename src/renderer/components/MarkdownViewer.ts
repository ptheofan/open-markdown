/**
 * MarkdownViewer - Component for rendering and displaying markdown content
 */
import {
  PluginManager,
  createPluginManager,
  createGithubFlavoredPlugin,
  createSyntaxHighlightPlugin,
  createMermaidPlugin,
  MermaidPlugin,
} from '@plugins/index';
import { BUILTIN_PLUGINS } from '@shared/constants';
import { Toast } from './Toast';

import type { MarkdownPlugin, ContextMenuData } from '@shared/types';
import type { PluginThemeDeclaration } from '../../themes/types';

/**
 * State for the markdown viewer
 */
export interface MarkdownViewerState {
  content: string;
  filePath: string | null;
  isRendering: boolean;
}

/**
 * MarkdownViewer component
 */
export class MarkdownViewer {
  private container: HTMLElement;
  private pluginManager: PluginManager;
  private state: MarkdownViewerState = {
    content: '',
    filePath: null,
    isRendering: false,
  };
  private initialized = false;
  private highlightedElement: HTMLElement | null = null;
  private toast: Toast;

  constructor(container: HTMLElement) {
    this.container = container;
    this.pluginManager = createPluginManager({
      html: true,
      linkify: true,
      typographer: true,
    });
    this.toast = new Toast();
  }

  /**
   * Initialize the viewer and plugins
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Register plugin factories
    this.pluginManager.registerPluginFactory(
      BUILTIN_PLUGINS.GITHUB_FLAVORED,
      createGithubFlavoredPlugin
    );
    this.pluginManager.registerPluginFactory(
      BUILTIN_PLUGINS.SYNTAX_HIGHLIGHT,
      createSyntaxHighlightPlugin
    );
    this.pluginManager.registerPluginFactory(
      BUILTIN_PLUGINS.MERMAID,
      createMermaidPlugin
    );

    // Enable all built-in plugins
    await this.pluginManager.enablePlugins([
      BUILTIN_PLUGINS.GITHUB_FLAVORED,
      BUILTIN_PLUGINS.SYNTAX_HIGHLIGHT,
      BUILTIN_PLUGINS.MERMAID,
    ]);

    // Apply plugin styles
    this.applyPluginStyles();

    // Setup context menu handling
    this.setupContextMenu();

    this.initialized = true;
  }

  /**
   * Apply plugin CSS styles to the document
   */
  private applyPluginStyles(): void {
    const styleContainer = document.getElementById('plugin-styles');
    if (styleContainer) {
      const styles = this.pluginManager.getPluginStyles();
      styleContainer.textContent = styles.join('\n');
    }
  }

  /**
   * Render markdown content
   */
  async render(markdown: string, filePath?: string): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    this.state.isRendering = true;
    this.state.content = markdown;
    if (filePath) {
      this.state.filePath = filePath;
    }

    try {
      // Render markdown to HTML
      const html = this.pluginManager.render(markdown);
      this.container.innerHTML = html;

      // Run post-render hooks (for Mermaid diagrams, etc.)
      await this.pluginManager.postRender(this.container);
    } catch (error) {
      console.error('Render error:', error);
      this.container.innerHTML = `
        <div class="render-error">
          <h3>Render Error</h3>
          <p>${error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
      `;
    } finally {
      this.state.isRendering = false;
    }
  }

  /**
   * Clear the viewer content
   */
  clear(): void {
    this.container.innerHTML = '';
    this.state.content = '';
    this.state.filePath = null;
  }

  /**
   * Get current state
   */
  getState(): Readonly<MarkdownViewerState> {
    return { ...this.state };
  }

  /**
   * Get the container element
   */
  getContainer(): HTMLElement {
    return this.container;
  }

  /**
   * Check if viewer is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Scroll to a specific heading by ID
   */
  scrollToHeading(headingId: string): void {
    const heading = this.container.querySelector(`#${CSS.escape(headingId)}`);
    if (heading) {
      heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /**
   * Scroll to top
   */
  scrollToTop(): void {
    this.container.scrollTop = 0;
  }

  /**
   * Get aggregated theme variable declarations from all plugins
   */
  getPluginThemeDeclarations(): PluginThemeDeclaration {
    return this.pluginManager.getPluginThemeDeclarations();
  }

  /**
   * Set theme for theme-aware plugins (like Mermaid)
   * Re-renders content if there's any loaded
   */
  async setTheme(theme: 'light' | 'dark'): Promise<void> {
    // Update Mermaid plugin theme
    const mermaidPlugin = this.pluginManager.getPlugin<MermaidPlugin>(BUILTIN_PLUGINS.MERMAID);
    if (mermaidPlugin && 'setTheme' in mermaidPlugin) {
      mermaidPlugin.setTheme(theme);
    }

    // Re-render if we have content
    if (this.state.content) {
      await this.render(this.state.content, this.state.filePath ?? undefined);
    }
  }

  /**
   * Setup context menu handling for plugin elements
   */
  private setupContextMenu(): void {
    this.container.addEventListener('contextmenu', (e) => {
      void this.handleContextMenu(e);
    });
  }

  /**
   * Handle context menu event
   */
  private async handleContextMenu(e: MouseEvent): Promise<void> {
    const target = e.target as HTMLElement;

    // Find plugin-rendered element
    const pluginElement = target.closest('[data-plugin-id]');
    if (!pluginElement || !(pluginElement instanceof HTMLElement)) {
      // Let default menu show for non-plugin elements
      return;
    }

    e.preventDefault();

    // Highlight the element
    this.highlightElement(pluginElement);

    // Get plugin and menu items
    const pluginId = pluginElement.getAttribute('data-plugin-id');
    if (!pluginId) {
      this.removeHighlight();
      return;
    }

    const plugin = this.pluginManager.getPlugin(pluginId);
    if (!plugin?.getContextMenuItems) {
      this.removeHighlight();
      return;
    }

    const items = plugin.getContextMenuItems(pluginElement);
    if (!items || items.length === 0) {
      this.removeHighlight();
      return;
    }

    // Show native context menu
    const selectedId = await window.electronAPI.contextMenu.show({
      items,
      x: e.screenX,
      y: e.screenY,
    });

    // Remove highlight
    this.removeHighlight();

    // Execute selected action
    if (selectedId && plugin.getContextMenuData) {
      await this.executeContextMenuItem(plugin, pluginElement, selectedId);
    }
  }

  /**
   * Highlight an element being targeted by context menu
   */
  private highlightElement(element: HTMLElement): void {
    this.removeHighlight();
    element.classList.add('context-menu-target');
    this.highlightedElement = element;
  }

  /**
   * Remove highlight from current element
   */
  private removeHighlight(): void {
    if (this.highlightedElement) {
      this.highlightedElement.classList.remove('context-menu-target');
      this.highlightedElement = null;
    }
  }

  /**
   * Execute a context menu action
   */
  private async executeContextMenuItem(
    plugin: MarkdownPlugin,
    element: HTMLElement,
    menuItemId: string
  ): Promise<void> {
    if (!plugin.getContextMenuData) {
      return;
    }

    try {
      const data = await plugin.getContextMenuData(element, menuItemId);
      await this.executeClipboardAction(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.toast.error(`Failed: ${message}`);
    }
  }

  /**
   * Execute clipboard action based on data type
   */
  private async executeClipboardAction(data: ContextMenuData): Promise<void> {
    switch (data.type) {
      case 'text':
        await window.electronAPI.clipboard.writeText(data.content);
        this.toast.success('Copied to clipboard');
        break;

      case 'html':
        await window.electronAPI.clipboard.writeHtml(data.content);
        this.toast.success('Copied to clipboard');
        break;

      case 'image':
        await window.electronAPI.clipboard.writeImage(data.content);
        this.toast.success('Image copied to clipboard');
        break;

      case 'file-save': {
        const result = await window.electronAPI.clipboard.saveFile(
          data.content,
          data.filename || 'image.png'
        );
        if (result.success) {
          this.toast.success(`Saved to ${result.filePath}`);
        } else if (!result.cancelled) {
          this.toast.error(result.error || 'Failed to save file');
        }
        // No toast for cancelled
        break;
      }

      default: {
        const exhaustiveCheck: never = data.type;
        throw new Error(`Unknown data type: ${String(exhaustiveCheck)}`);
      }
    }
  }
}

/**
 * Factory function to create a MarkdownViewer
 */
export function createMarkdownViewer(container: HTMLElement): MarkdownViewer {
  return new MarkdownViewer(container);
}
