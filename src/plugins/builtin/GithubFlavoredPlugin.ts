/**
 * GithubFlavoredPlugin - Adds GitHub Flavored Markdown support
 */
import { BUILTIN_PLUGINS } from '@shared/constants';

import type { MarkdownPlugin, PluginMetadata } from '@shared/types';
import type MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';



/**
 * Type definitions for markdown-it render rules
 */
interface MarkdownItOptions {
  html?: boolean;
  xhtmlOut?: boolean;
  breaks?: boolean;
  langPrefix?: string;
  linkify?: boolean;
  typographer?: boolean;
  quotes?: string | string[];
  highlight?: ((str: string, lang: string, attrs: string) => string) | null;
}

interface MarkdownItRenderer {
  renderToken(tokens: Token[], idx: number, options: MarkdownItOptions): string;
}

type RenderRule = (
  tokens: Token[],
  idx: number,
  options: MarkdownItOptions,
  env: unknown,
  self: MarkdownItRenderer
) => string;

/**
 * GitHub Flavored Markdown plugin
 * Enables: tables, strikethrough, task lists, autolinks
 */
export class GithubFlavoredPlugin implements MarkdownPlugin {
  metadata: PluginMetadata = {
    id: BUILTIN_PLUGINS.GITHUB_FLAVORED,
    name: 'GitHub Flavored Markdown',
    version: '1.0.0',
    description: 'Adds GitHub Flavored Markdown support (tables, strikethrough, task lists)',
  };

  apply(md: MarkdownIt): void {
    // Enable tables (already built-in to markdown-it)
    // No additional configuration needed

    // Add strikethrough support (~~text~~)
    this.addStrikethrough(md);

    // Add task list support
    this.addTaskLists(md);

    // Add GitHub-style ids to headings so in-document anchors work
    this.addHeadingAnchors(md);
  }

  /**
   * Assign GitHub-style slug ids to headings (e.g. "TextField API" ->
   * "textfield-api") so that in-document links like [foo](#textfield-api)
   * resolve. Duplicate slugs get a numeric suffix, matching GitHub.
   */
  private addHeadingAnchors(md: MarkdownIt): void {
    md.core.ruler.push('heading_anchors', (state) => {
      const usedSlugs = new Map<string, number>();
      const tokens = state.tokens;

      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (!token || token.type !== 'heading_open') continue;

        const inline = tokens[i + 1];
        if (!inline || inline.type !== 'inline') continue;

        const text = (inline.children ?? [])
          .filter((t) => t.type === 'text' || t.type === 'code_inline')
          .map((t) => t.content)
          .join('');

        let slug = text
          .trim()
          .toLowerCase()
          // Unicode-aware: an ASCII-only class empties a Greek/CJK heading,
          // leaving a bogus id its anchors can never resolve to.
          .replace(/[^\p{L}\p{N}_\- ]+/gu, '')
          .replace(/\s+/g, '-');
        if (!slug) continue;

        const count = usedSlugs.get(slug) ?? 0;
        usedSlugs.set(slug, count + 1);
        if (count > 0) {
          slug = `${slug}-${count}`;
        }

        token.attrSet('id', slug);
      }
    });
  }

  /**
   * Add strikethrough support using ~~text~~
   */
  private addStrikethrough(md: MarkdownIt): void {
    // Add inline rule for ~~text~~
    md.inline.ruler.before('emphasis', 'strikethrough', (state, silent) => {
      const start = state.pos;
      const marker = state.src.charCodeAt(start);

      if (silent) {
        return false;
      }

      // Check for ~~ marker
      if (marker !== 0x7e /* ~ */) {
        return false;
      }

      if (state.src.charCodeAt(start + 1) !== 0x7e) {
        return false;
      }

      // Find closing ~~
      const max = state.posMax;
      let pos = start + 2;

      while (pos < max) {
        if (
          state.src.charCodeAt(pos) === 0x7e &&
          state.src.charCodeAt(pos + 1) === 0x7e
        ) {
          // Found closing ~~
          const content = state.src.slice(start + 2, pos);
          if (content.length > 0) {
            const tokenOpen = state.push('s_open', 's', 1);
            tokenOpen.markup = '~~';

            const tokenText = state.push('text', '', 0);
            tokenText.content = content;

            const tokenClose = state.push('s_close', 's', -1);
            tokenClose.markup = '~~';

            state.pos = pos + 2;
            return true;
          }
        }
        pos++;
      }

      return false;
    });

    // Add renderer rules
    md.renderer.rules['s_open'] = (): string => '<del>';
    md.renderer.rules['s_close'] = (): string => '</del>';
  }

  /**
   * Add task list support for - [ ] and - [x]
   */
  private addTaskLists(md: MarkdownIt): void {
    const defaultListItemRender: RenderRule =
      (md.renderer.rules['list_item_open'] as RenderRule | undefined) ||
      ((tokens: Token[], idx: number, options: MarkdownItOptions, _env: unknown, self: MarkdownItRenderer): string =>
        self.renderToken(tokens, idx, options));

    md.renderer.rules['list_item_open'] = (
      tokens: Token[],
      idx: number,
      options: MarkdownItOptions,
      env: unknown,
      self: MarkdownItRenderer
    ): string => {
      const token = tokens[idx];
      const nextToken = tokens[idx + 1];
      const inlineToken = tokens[idx + 2];

      if (!token) {
        return defaultListItemRender(tokens, idx, options, env, self);
      }

      // Check if the next token contains task list markup
      if (
        nextToken &&
        nextToken.type === 'paragraph_open' &&
        inlineToken?.type === 'inline'
      ) {
        const content = inlineToken.content || '';

        if (content.startsWith('[ ] ')) {
          // Unchecked task
          inlineToken.content = content.slice(4);
          token.attrSet('class', 'task-list-item');
          const result = defaultListItemRender(tokens, idx, options, env, self);
          return (
            result +
            '<input type="checkbox" class="task-list-checkbox" disabled>'
          );
        } else if (content.startsWith('[x] ') || content.startsWith('[X] ')) {
          // Checked task
          inlineToken.content = content.slice(4);
          token.attrSet('class', 'task-list-item');
          const result = defaultListItemRender(tokens, idx, options, env, self);
          return (
            result +
            '<input type="checkbox" class="task-list-checkbox" checked disabled>'
          );
        }
      }

      return defaultListItemRender(tokens, idx, options, env, self);
    };
  }

  getStyles(): string {
    return `
      /* GitHub Flavored Markdown Styles */
      .task-list-item {
        list-style-type: none;
        position: relative;
        padding-left: 0;
      }

      .task-list-item input.task-list-checkbox {
        margin-right: 0.5em;
        vertical-align: middle;
      }

      del {
        text-decoration: line-through;
        opacity: 0.65;
      }

      table {
        border-spacing: 0;
        border-collapse: collapse;
        margin: 1em 0;
        width: 100%;
      }

      table th,
      table td {
        padding: 6px 13px;
        border: 1px solid var(--table-border);
      }

      table th {
        font-weight: 600;
        background-color: var(--table-header-bg);
      }

      table tr:nth-child(2n) {
        background-color: var(--table-row-alt-bg);
      }
    `;
  }
}

/**
 * Factory function for creating the plugin
 */
export function createGithubFlavoredPlugin(): MarkdownPlugin {
  return new GithubFlavoredPlugin();
}
