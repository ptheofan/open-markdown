/**
 * SyntaxHighlightPlugin - Adds code syntax highlighting using highlight.js
 */
import { BUILTIN_PLUGINS } from '@shared/constants';
import hljs from 'highlight.js';


import type { MarkdownPlugin, PluginMetadata, PluginOptions } from '@shared/types';
import type MarkdownIt from 'markdown-it';

/**
 * Options for the SyntaxHighlightPlugin
 */
export interface SyntaxHighlightOptions extends PluginOptions {
  /** List of languages to register (empty = all common languages) */
  languages?: string[];
  /** Whether to enable line numbers */
  lineNumbers?: boolean;
  /** Theme name for highlight.js */
  theme?: 'github' | 'github-dark' | 'monokai' | 'vs' | 'atom-one-dark';
}

/**
 * Syntax highlighting plugin using highlight.js
 */
export class SyntaxHighlightPlugin implements MarkdownPlugin {
  metadata: PluginMetadata = {
    id: BUILTIN_PLUGINS.SYNTAX_HIGHLIGHT,
    name: 'Syntax Highlighting',
    version: '1.0.0',
    description: 'Code syntax highlighting using highlight.js',
  };

  private options: SyntaxHighlightOptions;

  constructor(options: SyntaxHighlightOptions = {}) {
    this.options = {
      lineNumbers: false,
      theme: 'github',
      ...options,
    };
  }

  apply(md: MarkdownIt): void {
    // Configure markdown-it to use highlight.js for code blocks
    md.set({
      highlight: (str: string, lang: string): string => {
        return this.highlight(str, lang);
      },
    });
  }

  /**
   * Highlight code with highlight.js
   */
  private highlight(code: string, lang: string): string {
    // Try to highlight with specified language
    if (lang && hljs.getLanguage(lang)) {
      try {
        const result = hljs.highlight(code, {
          language: lang,
          ignoreIllegals: true,
        });
        return this.wrapCode(result.value, lang);
      } catch {
        // Fall through to auto-detect
      }
    }

    // Try auto-detection
    try {
      const result = hljs.highlightAuto(code);
      return this.wrapCode(result.value, result.language || 'plaintext');
    } catch {
      // Fall back to plain text
      return this.wrapCode(this.escapeHtml(code), 'plaintext');
    }
  }

  /**
   * Wrap highlighted code in proper HTML structure
   */
  private wrapCode(highlightedCode: string, lang: string): string {
    const lineNumberAttr = this.options.lineNumbers ? ' data-line-numbers' : '';
    return `<pre class="hljs"${lineNumberAttr}><code class="language-${lang}">${highlightedCode}</code></pre>`;
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
    // Base styles - theme-specific styles should be loaded separately
    return `
      /* Syntax Highlighting Base Styles */
      pre.hljs {
        padding: 16px;
        overflow: auto;
        font-size: 85%;
        line-height: 1.45;
        background-color: var(--code-bg, #f6f8fa);
        border-radius: 6px;
        margin: 1em 0;
      }

      pre.hljs code {
        background: transparent;
        padding: 0;
        border: none;
        font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
      }

      /* Line numbers (optional) */
      pre.hljs[data-line-numbers] {
        padding-left: 3.5em;
        position: relative;
      }

      pre.hljs[data-line-numbers]::before {
        content: attr(data-line-numbers);
        position: absolute;
        left: 0;
        top: 16px;
        width: 3em;
        text-align: right;
        padding-right: 0.5em;
        color: var(--line-number-color, #6e7781);
        border-right: 1px solid var(--border-color, #d0d7de);
        user-select: none;
        font-size: 85%;
        line-height: 1.45;
      }

      /* Inline code */
      :not(pre) > code {
        padding: 0.2em 0.4em;
        margin: 0;
        font-size: 85%;
        background-color: var(--inline-code-bg, rgba(175, 184, 193, 0.2));
        border-radius: 6px;
        font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
      }

      /* GitHub Light Theme Colors */
      .hljs {
        color: #24292f;
        background: #f6f8fa;
      }

      .hljs-doctag,
      .hljs-keyword,
      .hljs-meta .hljs-keyword,
      .hljs-template-tag,
      .hljs-template-variable,
      .hljs-type,
      .hljs-variable.language_ {
        color: #cf222e;
      }

      .hljs-title,
      .hljs-title.class_,
      .hljs-title.class_.inherited__,
      .hljs-title.function_ {
        color: #8250df;
      }

      .hljs-attr,
      .hljs-attribute,
      .hljs-literal,
      .hljs-meta,
      .hljs-number,
      .hljs-operator,
      .hljs-variable,
      .hljs-selector-attr,
      .hljs-selector-class,
      .hljs-selector-id {
        color: #0550ae;
      }

      .hljs-regexp,
      .hljs-string,
      .hljs-meta .hljs-string {
        color: #0a3069;
      }

      .hljs-built_in,
      .hljs-symbol {
        color: #e36209;
      }

      .hljs-comment,
      .hljs-code,
      .hljs-formula {
        color: #6e7781;
      }

      .hljs-name,
      .hljs-quote,
      .hljs-selector-tag,
      .hljs-selector-pseudo {
        color: #116329;
      }

      .hljs-subst {
        color: #24292f;
      }

      .hljs-section {
        color: #0550ae;
        font-weight: bold;
      }

      .hljs-bullet {
        color: #953800;
      }

      .hljs-emphasis {
        color: #24292f;
        font-style: italic;
      }

      .hljs-strong {
        color: #24292f;
        font-weight: bold;
      }

      .hljs-addition {
        color: #116329;
        background-color: #dafbe1;
      }

      .hljs-deletion {
        color: #82071e;
        background-color: #ffebe9;
      }

      /* GitHub Dark Theme Colors */
      [data-theme="dark"] .hljs {
        color: #c9d1d9;
        background: #161b22;
      }

      [data-theme="dark"] .hljs-doctag,
      [data-theme="dark"] .hljs-keyword,
      [data-theme="dark"] .hljs-meta .hljs-keyword,
      [data-theme="dark"] .hljs-template-tag,
      [data-theme="dark"] .hljs-template-variable,
      [data-theme="dark"] .hljs-type,
      [data-theme="dark"] .hljs-variable.language_ {
        color: #ff7b72;
      }

      [data-theme="dark"] .hljs-title,
      [data-theme="dark"] .hljs-title.class_,
      [data-theme="dark"] .hljs-title.class_.inherited__,
      [data-theme="dark"] .hljs-title.function_ {
        color: #d2a8ff;
      }

      [data-theme="dark"] .hljs-attr,
      [data-theme="dark"] .hljs-attribute,
      [data-theme="dark"] .hljs-literal,
      [data-theme="dark"] .hljs-meta,
      [data-theme="dark"] .hljs-number,
      [data-theme="dark"] .hljs-operator,
      [data-theme="dark"] .hljs-variable,
      [data-theme="dark"] .hljs-selector-attr,
      [data-theme="dark"] .hljs-selector-class,
      [data-theme="dark"] .hljs-selector-id {
        color: #79c0ff;
      }

      [data-theme="dark"] .hljs-regexp,
      [data-theme="dark"] .hljs-string,
      [data-theme="dark"] .hljs-meta .hljs-string {
        color: #a5d6ff;
      }

      [data-theme="dark"] .hljs-built_in,
      [data-theme="dark"] .hljs-symbol {
        color: #ffa657;
      }

      [data-theme="dark"] .hljs-comment,
      [data-theme="dark"] .hljs-code,
      [data-theme="dark"] .hljs-formula {
        color: #8b949e;
      }

      [data-theme="dark"] .hljs-name,
      [data-theme="dark"] .hljs-quote,
      [data-theme="dark"] .hljs-selector-tag,
      [data-theme="dark"] .hljs-selector-pseudo {
        color: #7ee787;
      }

      [data-theme="dark"] .hljs-subst {
        color: #c9d1d9;
      }

      [data-theme="dark"] .hljs-section {
        color: #79c0ff;
        font-weight: bold;
      }

      [data-theme="dark"] .hljs-bullet {
        color: #ffa657;
      }

      [data-theme="dark"] .hljs-emphasis {
        color: #c9d1d9;
        font-style: italic;
      }

      [data-theme="dark"] .hljs-strong {
        color: #c9d1d9;
        font-weight: bold;
      }

      [data-theme="dark"] .hljs-addition {
        color: #aff5b4;
        background-color: #033a16;
      }

      [data-theme="dark"] .hljs-deletion {
        color: #ffdcd7;
        background-color: #67060c;
      }
    `;
  }
}

/**
 * Factory function for creating the plugin
 */
export function createSyntaxHighlightPlugin(
  options?: SyntaxHighlightOptions
): MarkdownPlugin {
  return new SyntaxHighlightPlugin(options);
}
