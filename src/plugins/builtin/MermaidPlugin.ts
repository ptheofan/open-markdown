/**
 * MermaidPlugin - Renders Mermaid diagrams in markdown
 */
import { toPng } from 'html-to-image';
import pako from 'pako';

import { BUILTIN_PLUGINS } from '@shared/constants';

import type {
  MarkdownPlugin,
  PluginMetadata,
  PluginOptions,
  ContextMenuItem,
  ContextMenuData,
} from '@shared/types';
import type { PluginThemeDeclaration } from '../../themes/types';
import type MarkdownIt from 'markdown-it';

/**
 * Options for the MermaidPlugin
 */
export interface MermaidOptions extends PluginOptions {
  /** Mermaid theme */
  theme?: 'default' | 'forest' | 'dark' | 'neutral' | 'base';
  /** Security level */
  securityLevel?: 'strict' | 'loose' | 'antiscript' | 'sandbox';
}

/**
 * Mermaid diagram rendering plugin
 */
export class MermaidPlugin implements MarkdownPlugin {
  metadata: PluginMetadata = {
    id: BUILTIN_PLUGINS.MERMAID,
    name: 'Mermaid Diagrams',
    version: '1.0.0',
    description: 'Render Mermaid diagrams in markdown code blocks',
  };

  private options: MermaidOptions;
  private mermaid: typeof import('mermaid').default | null = null;
  private diagramCounter = 0;

  constructor(options: MermaidOptions = {}) {
    this.options = {
      theme: 'default',
      securityLevel: 'loose',
      ...options,
    };
  }

  async initialize(): Promise<void> {
    // Dynamically import mermaid to avoid issues in Node.js environment
    const mermaidModule = await import('mermaid');
    this.mermaid = mermaidModule.default;

    this.initializeMermaid();
  }

  /**
   * Initialize or reinitialize Mermaid with current options
   */
  private initializeMermaid(): void {
    if (!this.mermaid) return;

    this.mermaid.initialize({
      startOnLoad: false,
      theme: this.options.theme,
      securityLevel: this.options.securityLevel,
      flowchart: { useMaxWidth: true },
      sequence: { useMaxWidth: true },
      er: { useMaxWidth: true },
      journey: { useMaxWidth: true },
      gantt: { useMaxWidth: true },
      pie: { useMaxWidth: true },
    });
  }

  /**
   * Set the Mermaid theme and reinitialize
   */
  setTheme(theme: 'light' | 'dark'): void {
    // Map app theme to Mermaid theme
    this.options.theme = theme === 'dark' ? 'dark' : 'default';
    this.initializeMermaid();
  }

  apply(md: MarkdownIt): void {
    // Store reference to default fence renderer
    const defaultFence =
      md.renderer.rules['fence'] ||
      ((tokens, idx, options, _env, self) =>
        self.renderToken(tokens, idx, options));

    // Override fence renderer to handle mermaid blocks
    md.renderer.rules['fence'] = (tokens, idx, options, env, self): string => {
      const token = tokens[idx];
      const info = (token?.info || '').trim().toLowerCase();

      if (info === 'mermaid' && token) {
        const code = token.content.trim();
        const id = `mermaid-placeholder-${this.diagramCounter++}`;

        // Return placeholder that will be processed in postRender
        return `<div class="mermaid-container" data-mermaid-id="${id}" data-mermaid-code="${this.encodeForAttribute(code)}"><div class="mermaid-loading">Loading diagram...</div></div>`;
      }

      return defaultFence(tokens, idx, options, env, self);
    };
  }

  async postRender(container: HTMLElement): Promise<void> {
    if (!this.mermaid) {
      console.error('Mermaid not initialized');
      return;
    }

    const placeholders = container.querySelectorAll(
      '.mermaid-container[data-mermaid-code]'
    );

    for (const placeholder of placeholders) {
      const id = placeholder.getAttribute('data-mermaid-id') || `mermaid-${Date.now()}`;
      const encodedCode = placeholder.getAttribute('data-mermaid-code');

      if (!encodedCode) continue;

      const code = this.decodeFromAttribute(encodedCode);

      try {
        // Render the diagram
        const { svg } = await this.mermaid.render(id, code);

        // Replace placeholder with rendered SVG
        placeholder.innerHTML = svg;
        placeholder.classList.add('mermaid-rendered');

        // Store source for context menu and mark plugin ownership
        placeholder.setAttribute('data-plugin-id', 'mermaid');
        placeholder.setAttribute('data-mermaid-source', this.encodeForAttribute(code));
        placeholder.removeAttribute('data-mermaid-code');
      } catch (error) {
        // Show error message
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to render diagram';
        placeholder.innerHTML = `
          <div class="mermaid-error">
            <strong>Mermaid Error:</strong>
            <pre>${this.escapeHtml(errorMessage)}</pre>
            <details>
              <summary>Show source</summary>
              <pre>${this.escapeHtml(code)}</pre>
            </details>
          </div>
        `;
        placeholder.classList.add('mermaid-error-container');

        // Still store source for context menu (code copy still works for errors)
        placeholder.setAttribute('data-plugin-id', 'mermaid');
        placeholder.setAttribute('data-mermaid-source', this.encodeForAttribute(code));
      }
    }
  }

  /**
   * Encode string for use in HTML attribute
   */
  private encodeForAttribute(str: string): string {
    return btoa(encodeURIComponent(str));
  }

  /**
   * Decode string from HTML attribute
   */
  private decodeFromAttribute(str: string): string {
    return decodeURIComponent(atob(str));
  }

  /**
   * Escape HTML entities
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Declare theme variables used by this plugin
   */
  getThemeVariables(): PluginThemeDeclaration {
    return {
      'mermaid-label-bg': {
        light: '#ffffff',
        dark: '#2d2d2d',
        description: 'Background color for edge labels in diagrams',
      },
    };
  }

  getStyles(): string {
    return `
      /* Mermaid Diagram Styles */
      .mermaid-container {
        margin: 1em 0;
        text-align: center;
        overflow-x: auto;
      }

      /* Edge label backgrounds - override Mermaid's hardcoded 50% transparency */
      .mermaid-container .labelBkg {
        background-color: var(--mermaid-label-bg) !important;
      }

      .mermaid-container svg {
        max-width: 100%;
        height: auto;
      }

      .mermaid-loading {
        padding: 2em;
        color: var(--text-muted);
        font-style: italic;
      }

      .mermaid-error {
        padding: 1em;
        background-color: var(--error-bg);
        border: 1px solid var(--error-border);
        border-radius: 6px;
        color: var(--error-text);
        text-align: left;
      }

      .mermaid-error pre {
        margin: 0.5em 0 0;
        padding: 0.5em;
        background-color: var(--code-bg);
        border-radius: 4px;
        overflow-x: auto;
        font-size: 0.85em;
      }

      .mermaid-error details {
        margin-top: 0.5em;
      }

      .mermaid-error summary {
        cursor: pointer;
        color: var(--link-color);
      }

      .mermaid-error summary:hover {
        text-decoration: underline;
      }

    `;
  }

  /**
   * Get context menu items for a right-clicked element
   */
  getContextMenuItems(element: HTMLElement): ContextMenuItem[] | null {
    const container = element.closest('.mermaid-container[data-mermaid-source]');
    if (!container) return null;

    const hasError = container.classList.contains('mermaid-error-container');

    return [
      { id: 'copy-code', label: 'Copy Mermaid Code', enabled: true },
      { id: 'copy-image', label: 'Copy as Image', enabled: !hasError },
      { id: 'copy-mermaid-live', label: 'Copy as Mermaid Live', enabled: true },
      {
        id: 'copy-image-with-link',
        label: 'Copy as Image with Link',
        enabled: !hasError,
      },
      { id: 'save-png', label: 'Save as PNG...', enabled: !hasError },
    ];
  }

  /**
   * Generate data for a selected context menu item
   */
  async getContextMenuData(
    element: HTMLElement,
    menuItemId: string
  ): Promise<ContextMenuData> {
    const container = element.closest(
      '.mermaid-container[data-mermaid-source]'
    ) as HTMLElement;
    const encodedSource = container.getAttribute('data-mermaid-source');
    if (!encodedSource) {
      throw new Error('Mermaid source not found');
    }

    const code = this.decodeFromAttribute(encodedSource);

    switch (menuItemId) {
      case 'copy-code':
        return { type: 'text', content: code };

      case 'copy-image': {
        const png = await this.renderToPng(container);
        return { type: 'image', content: png };
      }

      case 'copy-mermaid-live': {
        const url = this.generateMermaidLiveUrl(code);
        return {
          type: 'html',
          content: `<a href="${url}">Mermaid Diagram</a>`,
        };
      }

      case 'copy-image-with-link': {
        const pngData = await this.renderToPng(container);
        const liveUrl = this.generateMermaidLiveUrl(code);
        return {
          type: 'html',
          content: `<img src="data:image/png;base64,${pngData}"/><br/><a href="${liveUrl}">Mermaid Diagram</a>`,
        };
      }

      case 'save-png': {
        const pngForSave = await this.renderToPng(container);
        return {
          type: 'file-save',
          content: pngForSave,
          filename: 'mermaid-diagram.png',
        };
      }

      default:
        throw new Error(`Unknown menu item: ${menuItemId}`);
    }
  }

  /**
   * Render the diagram SVG to a PNG base64 string using html-to-image
   */
  private async renderToPng(container: HTMLElement): Promise<string> {
    const svg = container.querySelector('svg');
    if (!svg) {
      throw new Error('SVG element not found');
    }

    // Get bounding box and add padding to prevent cropping
    const bbox = svg.getBoundingClientRect();
    const padding = 20;

    const dataUrl = await toPng(svg as unknown as HTMLElement, {
      backgroundColor: 'white',
      pixelRatio: 2, // Retina quality
      width: Math.ceil(bbox.width) + padding * 2,
      height: Math.ceil(bbox.height) + padding * 2,
      style: {
        margin: `${padding}px`,
      },
    });

    return dataUrl.split(',')[1] ?? '';
  }

  /**
   * Generate a mermaid.live URL for the given code
   */
  private generateMermaidLiveUrl(code: string): string {
    const state = {
      code,
      mermaid: { theme: this.options.theme || 'default' },
      autoSync: true,
      updateDiagram: true,
    };

    const jsonString = JSON.stringify(state);
    const compressed = pako.deflate(jsonString, { level: 9 });
    const base64 = btoa(String.fromCharCode(...compressed));

    return `https://mermaid.live/edit#pako:${base64}`;
  }

  destroy(): void {
    // Reset counter
    this.diagramCounter = 0;
  }
}

/**
 * Factory function for creating the plugin
 */
export function createMermaidPlugin(options?: MermaidOptions): MarkdownPlugin {
  return new MermaidPlugin(options);
}
