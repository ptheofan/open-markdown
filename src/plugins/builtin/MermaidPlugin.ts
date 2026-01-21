/**
 * MermaidPlugin - Renders Mermaid diagrams in markdown
 */
import { BUILTIN_PLUGINS } from '@shared/constants';

import type { MarkdownPlugin, PluginMetadata, PluginOptions } from '@shared/types';
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
      flowchart: {
        useMaxWidth: true,
        htmlLabels: true,
      },
      sequence: {
        useMaxWidth: true,
      },
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

  getStyles(): string {
    return `
      /* Mermaid Diagram Styles */
      .mermaid-container {
        margin: 1em 0;
        text-align: center;
        overflow-x: auto;
      }

      .mermaid-container svg {
        max-width: 100%;
        height: auto;
      }

      .mermaid-loading {
        padding: 2em;
        color: var(--text-muted, #6e7781);
        font-style: italic;
      }

      .mermaid-error {
        padding: 1em;
        background-color: var(--error-bg, #ffebe9);
        border: 1px solid var(--error-border, #ff8182);
        border-radius: 6px;
        color: var(--error-text, #cf222e);
        text-align: left;
      }

      .mermaid-error pre {
        margin: 0.5em 0 0;
        padding: 0.5em;
        background-color: var(--code-bg, rgba(0, 0, 0, 0.05));
        border-radius: 4px;
        overflow-x: auto;
        font-size: 0.85em;
      }

      .mermaid-error details {
        margin-top: 0.5em;
      }

      .mermaid-error summary {
        cursor: pointer;
        color: var(--link-color, #0969da);
      }

      .mermaid-error summary:hover {
        text-decoration: underline;
      }
    `;
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
