/**
 * SyntaxHighlightPlugin - Adds code syntax highlighting using highlight.js
 */
import { BUILTIN_PLUGINS } from '@shared/constants';
import hljs from 'highlight.js';

import type { MarkdownPlugin, PluginMetadata, PluginOptions } from '@shared/types';
import type { PluginThemeDeclaration } from '../../themes/types';
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
 * The copy button rendered into every code block. Two icons; CSS shows the
 * check mark while the block carries `is-copied`.
 */
const COPY_BUTTON_HTML =
  '<button type="button" class="code-copy-btn" title="Copy code" aria-label="Copy code">' +
  '<svg class="code-copy-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' +
  '<path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/>' +
  '<path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/>' +
  '</svg>' +
  '<svg class="code-copied-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' +
  '<path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>' +
  '</svg>' +
  '</button>';

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
        return this.wrapCode(result.value, lang, lang);
      } catch {
        // Fall through to auto-detect
      }
    }

    // Try auto-detection
    try {
      const result = hljs.highlightAuto(code);
      return this.wrapCode(result.value, result.language || 'plaintext', lang);
    } catch {
      // Fall back to plain text
      return this.wrapCode(this.escapeHtml(code), 'plaintext', lang);
    }
  }

  /**
   * Wrap highlighted code in proper HTML structure.
   *
   * The block is `<div.code-block>` around the `<pre>`, carrying a copy
   * button. The button holds no text and the language label is drawn from
   * `data-lang` by CSS, so neither shows up in find-in-page, Select All or
   * the copied document. `data-lang` is only set for a language the author
   * wrote on the fence: a guess from auto-detection is not worth announcing.
   */
  private wrapCode(highlightedCode: string, lang: string, declaredLang: string): string {
    const lineNumberAttr = this.options.lineNumbers ? ' data-line-numbers' : '';
    const label = declaredLang.trim();
    const langAttr = label ? ` data-lang="${this.escapeHtml(label)}"` : '';
    return (
      `<div class="code-block"${langAttr}>` +
      COPY_BUTTON_HTML +
      `<pre class="hljs"${lineNumberAttr}><code class="language-${lang}">${highlightedCode}</code></pre>` +
      '</div>'
    );
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
   * Declare theme variables for syntax highlighting
   */
  getThemeVariables(): PluginThemeDeclaration {
    return {
      // Base colors
      'hljs-color': {
        light: '#24292f',
        dark: '#c9d1d9',
        description: 'Default text color in code blocks',
      },
      'hljs-bg': {
        light: '#f6f8fa',
        dark: '#161b22',
        description: 'Background color for code blocks',
      },
      // Keywords: doctag, keyword, template-tag, template-variable, type, variable.language_
      'hljs-keyword': {
        light: '#cf222e',
        dark: '#ff7b72',
        description: 'Keywords, types, and template syntax',
      },
      // Titles: function names, class names
      'hljs-title': {
        light: '#8250df',
        dark: '#d2a8ff',
        description: 'Function and class names',
      },
      // Attributes: attr, attribute, literal, meta, number, operator, variable, selectors
      'hljs-attr': {
        light: '#0550ae',
        dark: '#79c0ff',
        description: 'Attributes, numbers, operators, and variables',
      },
      // Strings: regexp, string
      'hljs-string': {
        light: '#0a3069',
        dark: '#a5d6ff',
        description: 'Strings and regular expressions',
      },
      // Built-ins: built_in, symbol
      'hljs-builtin': {
        light: '#e36209',
        dark: '#ffa657',
        description: 'Built-in functions and symbols',
      },
      // Comments: comment, code, formula
      'hljs-comment': {
        light: '#6e7781',
        dark: '#8b949e',
        description: 'Comments and code annotations',
      },
      // Names: name, quote, selector-tag, selector-pseudo
      'hljs-name': {
        light: '#116329',
        dark: '#7ee787',
        description: 'Tag names and quotes',
      },
      // Section headers
      'hljs-section': {
        light: '#0550ae',
        dark: '#79c0ff',
        description: 'Section headers (bold)',
      },
      // Bullets
      'hljs-bullet': {
        light: '#953800',
        dark: '#ffa657',
        description: 'List bullets',
      },
      // Addition diff
      'hljs-addition-color': {
        light: '#116329',
        dark: '#aff5b4',
        description: 'Diff addition text color',
      },
      'hljs-addition-bg': {
        light: '#dafbe1',
        dark: '#033a16',
        description: 'Diff addition background',
      },
      // Deletion diff
      'hljs-deletion-color': {
        light: '#82071e',
        dark: '#ffdcd7',
        description: 'Diff deletion text color',
      },
      'hljs-deletion-bg': {
        light: '#ffebe9',
        dark: '#67060c',
        description: 'Diff deletion background',
      },
    };
  }

  getStyles(): string {
    return `
      /* Syntax Highlighting Base Styles */
      .code-block {
        position: relative;
      }

      pre.hljs {
        padding: 16px;
        overflow: auto;
        font-size: 85%;
        line-height: 1.45;
        background-color: var(--hljs-bg);
        border-radius: 6px;
        margin: 1em 0;
      }

      /* Language label, top-right, from the fence's own info string */
      .code-block[data-lang]::before {
        content: attr(data-lang);
        position: absolute;
        top: 6px;
        right: 40px;
        font-family: var(--doc-font-mono);
        font-size: 11px;
        line-height: 16px;
        color: var(--hljs-comment);
        opacity: 0.8;
        pointer-events: none;
        user-select: none;
        -webkit-user-select: none;
      }

      /* Copy button: shown on hover or keyboard focus, hidden otherwise */
      .code-copy-btn {
        position: absolute;
        top: 6px;
        right: 6px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border: 1px solid var(--border-color);
        border-radius: 6px;
        background-color: var(--hljs-bg);
        color: var(--hljs-comment);
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.15s, color 0.15s, background-color 0.15s;
        user-select: none;
        -webkit-user-select: none;
      }

      .code-block:hover .code-copy-btn,
      .code-copy-btn:focus-visible,
      .code-block.is-copied .code-copy-btn {
        opacity: 1;
      }

      .code-copy-btn:hover {
        color: var(--hljs-color);
        background-color: var(--hover-bg);
      }

      .code-copy-btn .code-copied-icon {
        display: none;
      }

      .code-block.is-copied .code-copy-btn {
        color: var(--success-color);
      }

      .code-block.is-copied .code-copy-btn .code-copy-icon {
        display: none;
      }

      .code-block.is-copied .code-copy-btn .code-copied-icon {
        display: inline;
      }

      pre.hljs code {
        background: transparent;
        padding: 0;
        border: none;
        font-family: var(--doc-font-mono);
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
        color: var(--hljs-comment);
        border-right: 1px solid var(--border);
        user-select: none;
        font-size: 85%;
        line-height: 1.45;
      }

      /* Inline code */
      :not(pre) > code {
        padding: 0.2em 0.4em;
        margin: 0;
        font-size: 85%;
        background-color: var(--code-bg);
        border-radius: 6px;
        font-family: var(--doc-font-mono);
      }

      /* Highlight.js Token Colors */
      .hljs {
        color: var(--hljs-color);
        background: var(--hljs-bg);
      }

      .hljs-doctag,
      .hljs-keyword,
      .hljs-meta .hljs-keyword,
      .hljs-template-tag,
      .hljs-template-variable,
      .hljs-type,
      .hljs-variable.language_ {
        color: var(--hljs-keyword);
      }

      .hljs-title,
      .hljs-title.class_,
      .hljs-title.class_.inherited__,
      .hljs-title.function_ {
        color: var(--hljs-title);
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
        color: var(--hljs-attr);
      }

      .hljs-regexp,
      .hljs-string,
      .hljs-meta .hljs-string {
        color: var(--hljs-string);
      }

      .hljs-built_in,
      .hljs-symbol {
        color: var(--hljs-builtin);
      }

      .hljs-comment,
      .hljs-code,
      .hljs-formula {
        color: var(--hljs-comment);
      }

      .hljs-name,
      .hljs-quote,
      .hljs-selector-tag,
      .hljs-selector-pseudo {
        color: var(--hljs-name);
      }

      .hljs-subst {
        color: var(--hljs-color);
      }

      .hljs-section {
        color: var(--hljs-section);
        font-weight: bold;
      }

      .hljs-bullet {
        color: var(--hljs-bullet);
      }

      .hljs-emphasis {
        color: var(--hljs-color);
        font-style: italic;
      }

      .hljs-strong {
        color: var(--hljs-color);
        font-weight: bold;
      }

      .hljs-addition {
        color: var(--hljs-addition-color);
        background-color: var(--hljs-addition-bg);
      }

      .hljs-deletion {
        color: var(--hljs-deletion-color);
        background-color: var(--hljs-deletion-bg);
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
