/**
 * MermaidPlugin - Renders Mermaid diagrams in markdown
 */
import { toPng } from 'html-to-image';
import pako from 'pako';

import { BUILTIN_PLUGINS } from '@shared/constants';
import {
  DEFAULT_MERMAID_PREFERENCES,
  type MermaidPreferences,
} from '../../preferences/defaults';

import type {
  MarkdownPlugin,
  PluginMetadata,
  PluginOptions,
  ContextMenuItem,
  ContextMenuData,
  PluginPreferencesSchema,
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
  private preferences: MermaidPreferences;

  constructor(options: MermaidOptions = {}) {
    this.options = {
      theme: 'default',
      securityLevel: 'loose',
      ...options,
    };
    this.preferences = { ...DEFAULT_MERMAID_PREFERENCES };
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
   * Decode string from HTML attribute (base64 encoded source)
   * @param str - Base64 encoded source from data-mermaid-source attribute
   * @returns Original mermaid code
   */
  decodeFromAttribute(str: string): string {
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
        light: this.preferences.colors.labelBackground.light,
        dark: this.preferences.colors.labelBackground.dark,
        description: 'Background color for edge labels in diagrams',
      },
      'mermaid-node-fill': {
        light: this.preferences.colors.nodeFill.light,
        dark: this.preferences.colors.nodeFill.dark,
        description: 'Fill color for diagram nodes',
      },
      'mermaid-node-stroke': {
        light: this.preferences.colors.nodeStroke.light,
        dark: this.preferences.colors.nodeStroke.dark,
        description: 'Stroke color for diagram nodes',
      },
      'mermaid-edge-stroke': {
        light: this.preferences.colors.edgeStroke.light,
        dark: this.preferences.colors.edgeStroke.dark,
        description: 'Stroke color for diagram edges',
      },
    };
  }

  /**
   * Get preferences schema for the UI
   */
  getPreferencesSchema(): PluginPreferencesSchema {
    return {
      version: 1,
      sections: [
        {
          id: 'export',
          title: 'Export Settings',
          fields: [
            {
              key: 'export.background',
              type: 'select',
              label: 'Export Background',
              description: 'Background style when exporting diagrams as images',
              options: [
                { value: 'solid', label: 'Solid (Theme Background)' },
                { value: 'transparent', label: 'Transparent' },
              ],
              defaultValue: DEFAULT_MERMAID_PREFERENCES.export.background,
            },
          ],
        },
        {
          id: 'colors',
          title: 'Diagram Colors',
          fields: [
            {
              key: 'colors.labelBackground',
              type: 'color-pair',
              label: 'Label Background',
              description: 'Background color for edge labels',
              defaultValue: DEFAULT_MERMAID_PREFERENCES.colors.labelBackground,
            },
            {
              key: 'colors.nodeFill',
              type: 'color-pair',
              label: 'Node Fill',
              description: 'Fill color for diagram nodes',
              defaultValue: DEFAULT_MERMAID_PREFERENCES.colors.nodeFill,
            },
            {
              key: 'colors.nodeStroke',
              type: 'color-pair',
              label: 'Node Stroke',
              description: 'Border color for diagram nodes',
              defaultValue: DEFAULT_MERMAID_PREFERENCES.colors.nodeStroke,
            },
            {
              key: 'colors.edgeStroke',
              type: 'color-pair',
              label: 'Edge Stroke',
              description: 'Color for diagram edges/arrows',
              defaultValue: DEFAULT_MERMAID_PREFERENCES.colors.edgeStroke,
            },
          ],
        },
      ],
    };
  }

  /**
   * Handle preference changes from the UI
   */
  onPreferencesChange(preferences: unknown): void {
    if (preferences && typeof preferences === 'object') {
      const prefs = preferences as Partial<MermaidPreferences>;

      // Update export settings
      if (prefs.export?.background) {
        this.preferences.export.background = prefs.export.background;
      }

      // Update color preferences
      if (prefs.colors) {
        if (prefs.colors.labelBackground) {
          this.preferences.colors.labelBackground = prefs.colors.labelBackground;
        }
        if (prefs.colors.nodeFill) {
          this.preferences.colors.nodeFill = prefs.colors.nodeFill;
        }
        if (prefs.colors.nodeStroke) {
          this.preferences.colors.nodeStroke = prefs.colors.nodeStroke;
        }
        if (prefs.colors.edgeStroke) {
          this.preferences.colors.edgeStroke = prefs.colors.edgeStroke;
        }
      }
    }
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
   * @param container - The .mermaid-container element containing the rendered SVG
   * @returns Base64 PNG string (without data: prefix)
   */
  async renderToPng(container: HTMLElement): Promise<string> {
    const svg = container.querySelector('svg');
    if (!svg) {
      throw new Error('SVG element not found');
    }

    const padding = 40; // Final padding around content (will be halved due to pixelRatio)

    // Determine background color based on preferences
    let backgroundColor: string;
    if (this.preferences.export.background === 'transparent') {
      backgroundColor = 'rgba(0,0,0,0)';
    } else {
      const bgColor = getComputedStyle(document.documentElement)
        .getPropertyValue('--bg')
        .trim();
      backgroundColor = bgColor || '#ffffff';
    }

    // First, capture the SVG to a canvas
    const dataUrl = await toPng(svg as unknown as HTMLElement, {
      pixelRatio: 2,
    });

    // Load as image to get pixel data
    const img = await this.loadImage(dataUrl);

    // Create canvas to analyze pixels
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);

    // Find content bounds by scanning for non-transparent pixels
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const bounds = this.findContentBounds(imageData);

    if (!bounds) {
      // No content found, return original
      return dataUrl.split(',')[1] ?? '';
    }

    // Create final canvas with padding
    const finalWidth = bounds.width + padding * 2;
    const finalHeight = bounds.height + padding * 2;

    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = finalWidth;
    finalCanvas.height = finalHeight;
    const finalCtx = finalCanvas.getContext('2d')!;

    // Fill with background color
    finalCtx.fillStyle = backgroundColor;
    finalCtx.fillRect(0, 0, finalWidth, finalHeight);

    // Draw cropped content centered
    finalCtx.drawImage(
      canvas,
      bounds.x, bounds.y, bounds.width, bounds.height,
      padding, padding, bounds.width, bounds.height
    );

    // Export as PNG
    const finalDataUrl = finalCanvas.toDataURL('image/png');
    return finalDataUrl.split(',')[1] ?? '';
  }

  /**
   * Load an image from a data URL
   */
  private loadImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  /**
   * Find the bounding box of non-transparent content in an image
   */
  private findContentBounds(imageData: ImageData): { x: number; y: number; width: number; height: number } | null {
    const { data, width, height } = imageData;

    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let hasContent = false;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const alpha = data[i + 3];

        // Consider pixel as content if it has any opacity
        if (alpha !== undefined && alpha > 0) {
          hasContent = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (!hasContent) {
      return null;
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    };
  }

  /**
   * Generate a mermaid.live edit URL for the given code
   * @param code - Raw mermaid diagram code
   * @returns Full mermaid.live URL
   */
  generateMermaidLiveUrl(code: string): string {
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
