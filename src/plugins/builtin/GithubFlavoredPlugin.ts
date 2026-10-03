/**
 * GithubFlavoredPlugin - Adds GitHub Flavored Markdown support
 */
import markdownItFootnote from 'markdown-it-footnote';

import { BUILTIN_PLUGINS } from '@shared/constants';

import type { MarkdownPlugin, PluginMetadata } from '@shared/types';
import type { PluginThemeDeclaration } from '../../themes/types';
import type MarkdownIt from 'markdown-it';
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs';
import type Token from 'markdown-it/lib/token.mjs';

/**
 * GitHub's five alert kinds, with their titles and octicons.
 */
const ALERT_KINDS: Record<string, { title: string; icon: string }> = {
  note: {
    title: 'Note',
    icon: 'M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z',
  },
  tip: {
    title: 'Tip',
    icon: 'M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z',
  },
  important: {
    title: 'Important',
    icon: 'M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z',
  },
  warning: {
    title: 'Warning',
    icon: 'M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z',
  },
  caution: {
    title: 'Caution',
    icon: 'M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z',
  },
};

const ALERT_MARKER = /^\[!(note|tip|important|warning|caution)\][ \t]*/i;



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

    // > [!NOTE] and friends
    this.addAlerts(md);

    // [^1] footnotes
    md.use(markdownItFootnote);
  }

  /**
   * Turn a blockquote opening with `[!NOTE]` (or TIP, IMPORTANT, WARNING,
   * CAUTION) into an alert: a div with a titled header instead of a quote
   * with the marker printed in it. The marker may stand alone on its first
   * line, as GitHub requires, or run straight into the text, as generated
   * markdown often has it.
   */
  private addAlerts(md: MarkdownIt): void {
    md.core.ruler.after('inline', 'github_alerts', (state: StateCore) => {
      const tokens = state.tokens;

      for (let i = 0; i < tokens.length; i++) {
        const open = tokens[i];
        if (!open || open.type !== 'blockquote_open') continue;

        const paragraph = tokens[i + 1];
        const inline = tokens[i + 2];
        if (paragraph?.type !== 'paragraph_open' || inline?.type !== 'inline') continue;

        const children = inline.children ?? [];
        const first = children[0];
        if (!first || first.type !== 'text') continue;

        const match = ALERT_MARKER.exec(first.content);
        if (!match) continue;

        const kind = (match[1] ?? '').toLowerCase();
        const spec = ALERT_KINDS[kind];
        if (!spec) continue;

        // Take the marker out of the text, and the line break after it when
        // it stood on its own line
        const remainder = first.content.slice(match[0].length);
        if (remainder) {
          first.content = remainder;
        } else {
          children.shift();
          if (children[0]?.type === 'softbreak') children.shift();
        }
        inline.children = children;

        // The matching close
        let depth = 0;
        let closeIndex = -1;
        for (let j = i; j < tokens.length; j++) {
          const t = tokens[j]!;
          if (t.type === 'blockquote_open') depth++;
          else if (t.type === 'blockquote_close' && --depth === 0) {
            closeIndex = j;
            break;
          }
        }
        if (closeIndex === -1) continue;

        open.tag = 'div';
        tokens[closeIndex]!.tag = 'div';
        open.attrJoin('class', `markdown-alert markdown-alert-${kind}`);

        const title = new state.Token('html_block', '', 0);
        title.block = true;
        title.content =
          `<p class="markdown-alert-title">` +
          `<svg class="markdown-alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="${spec.icon}"/></svg>` +
          `${spec.title}</p>\n`;

        if (children.length === 0) {
          // The marker was the whole first paragraph: replace it with the title
          tokens.splice(i + 1, 3, title);
        } else {
          tokens.splice(i + 1, 0, title);
        }
      }
    });
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

        const isUnchecked = content.startsWith('[ ] ');
        const isChecked = content.startsWith('[x] ') || content.startsWith('[X] ');

        if (isUnchecked || isChecked) {
          // The inline content was parsed into children before this renders,
          // so the marker has to come off the first text child too or it is
          // printed next to the checkbox.
          inlineToken.content = content.slice(4);
          const firstText = inlineToken.children?.find((t) => t.type === 'text');
          if (firstText && /^\[[ xX]\] /.test(firstText.content)) {
            firstText.content = firstText.content.slice(4);
          }
          token.attrSet('class', 'task-list-item');
          // Checkboxes render disabled; the viewer enables them where toggling
          // is wired up, using the item's data-source-lines to find the marker.
          const result = defaultListItemRender(tokens, idx, options, env, self);
          const checked = isChecked ? ' checked' : '';
          return (
            result +
            `<input type="checkbox" class="task-list-checkbox"${checked} disabled>`
          );
        }
      }

      return defaultListItemRender(tokens, idx, options, env, self);
    };
  }

  getThemeVariables(): PluginThemeDeclaration {
    return {
      'alert-note-color': { light: '#0969da', dark: '#4493f8', description: 'Note alert accent' },
      'alert-tip-color': { light: '#1a7f37', dark: '#3fb950', description: 'Tip alert accent' },
      'alert-important-color': { light: '#8250df', dark: '#ab7df8', description: 'Important alert accent' },
      'alert-warning-color': { light: '#9a6700', dark: '#d29922', description: 'Warning alert accent' },
      'alert-caution-color': { light: '#cf222e', dark: '#f85149', description: 'Caution alert accent' },
    };
  }

  getStyles(): string {
    return `
      /* GitHub alerts */
      .markdown-alert {
        margin: 0 0 16px;
        padding: 8px 16px;
        border-left: 0.25em solid var(--alert-color, var(--border-color));
        color: inherit;
      }

      .markdown-alert > :last-child {
        margin-bottom: 0;
      }

      .markdown-alert-title {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0 0 8px;
        font-weight: 600;
        line-height: 1;
        color: var(--alert-color, inherit);
      }

      .markdown-alert-icon {
        flex-shrink: 0;
      }

      .markdown-alert-note { --alert-color: var(--alert-note-color); }
      .markdown-alert-tip { --alert-color: var(--alert-tip-color); }
      .markdown-alert-important { --alert-color: var(--alert-important-color); }
      .markdown-alert-warning { --alert-color: var(--alert-warning-color); }
      .markdown-alert-caution { --alert-color: var(--alert-caution-color); }

      /* Footnotes */
      .footnotes-sep {
        margin: 32px 0 16px;
      }

      .footnotes {
        font-size: 0.9em;
        color: var(--text-muted);
      }

      .footnotes-list {
        padding-left: 1.5em;
      }

      .footnote-item p {
        margin-bottom: 4px;
      }

      .footnote-ref a,
      .footnote-backref {
        text-decoration: none;
      }

      .footnote-ref a {
        font-size: 0.85em;
        padding: 0 2px;
      }

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
