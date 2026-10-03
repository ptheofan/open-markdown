/**
 * MathPlugin - TeX math rendered with KaTeX
 *
 * Generated markdown writes math four ways: `$x$` and `$$x$$` as GitHub does,
 * and `\(x\)` / `\[x\]` as LaTeX does. All four are recognised. Rendering is
 * local -- KaTeX and its fonts ship with the app -- so nothing is fetched.
 *
 * Currency is not math. `$5 and $10` stays text because a single `$` only
 * opens math when the character after it is not whitespace, and only closes
 * it when the character before it is not whitespace and the one after is not
 * a digit -- the same rule GitHub applies.
 */
import katex from 'katex';

import { BUILTIN_PLUGINS } from '@shared/constants';

import type { MarkdownPlugin, PluginMetadata } from '@shared/types';
import type MarkdownIt from 'markdown-it';
import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs';
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs';
import type Token from 'markdown-it/lib/token.mjs';

const DOLLAR = 0x24;
const BACKSLASH = 0x5c;

function isWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

/**
 * Inline math: `$...$`, `$$...$$`, `\(...\)` and `\[...\]` inside a paragraph.
 * Runs before markdown-it's `escape` rule so `\(` is seen whole.
 */
function mathInline(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  const max = state.posMax;
  const first = src.charCodeAt(start);

  let open: string;
  let close: string;
  let display = false;

  if (first === DOLLAR) {
    if (src.charCodeAt(start + 1) === DOLLAR) {
      open = '$$';
      close = '$$';
      display = true;
    } else {
      open = '$';
      close = '$';
    }
  } else if (first === BACKSLASH) {
    const next = src[start + 1];
    if (next === '(') {
      open = '\\(';
      close = '\\)';
    } else if (next === '[') {
      open = '\\[';
      close = '\\]';
      display = true;
    } else {
      return false;
    }
  } else {
    return false;
  }

  const contentStart = start + open.length;
  if (contentStart >= max) return false;

  // A single dollar followed by a space is a price or a shell variable, not math
  if (open === '$' && isWhitespace(src.charCodeAt(contentStart))) return false;

  let pos = contentStart;
  let end = -1;
  while (pos < max) {
    const idx = src.indexOf(close, pos);
    if (idx === -1 || idx + close.length > max) break;

    // An escaped delimiter (\$) belongs to the formula
    if (open[0] === '$' && src.charCodeAt(idx - 1) === BACKSLASH) {
      pos = idx + 1;
      continue;
    }

    if (open === '$') {
      const before = src.charCodeAt(idx - 1);
      const after = src.charCodeAt(idx + 1);
      if (isWhitespace(before) || isDigit(after)) {
        pos = idx + 1;
        continue;
      }
    }

    end = idx;
    break;
  }

  if (end === -1) return false;

  const content = src.slice(contentStart, end);
  if (!content.trim()) return false;
  // Single-dollar math stays on one line; across lines `$` is far more often prose
  if (open === '$' && content.includes('\n')) return false;

  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.content = content;
    token.markup = open;
    token.meta = { display };
  }

  state.pos = end + close.length;
  return true;
}

/**
 * Block math: a line starting with `$$` or `\[`, closed by `$$` / `\]` at the
 * end of the same or a later line.
 */
function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  if (state.sCount[startLine]! - state.blkIndent >= 4) return false;

  const lineText = (line: number): string =>
    state.src.slice((state.bMarks[line] ?? 0) + (state.tShift[line] ?? 0), state.eMarks[line]);

  const first = lineText(startLine);
  let open: string;
  let close: string;
  if (first.startsWith('$$')) {
    open = '$$';
    close = '$$';
  } else if (first.startsWith('\\[')) {
    open = '\\[';
    close = '\\]';
  } else {
    return false;
  }

  const rest = first.slice(open.length);
  const lines: string[] = [];
  let nextLine = startLine;
  let found = false;

  // Everything on one line: $$ x $$
  const trimmedRest = rest.trimEnd();
  if (trimmedRest.length > close.length && trimmedRest.endsWith(close)) {
    lines.push(trimmedRest.slice(0, -close.length));
    found = true;
  } else {
    if (rest.trim()) lines.push(rest);
    for (nextLine = startLine + 1; nextLine < endLine; nextLine++) {
      // Leaving the enclosing list item or blockquote ends the search
      if (state.sCount[nextLine]! < state.blkIndent) break;
      const text = lineText(nextLine);
      const trimmed = text.trimEnd();
      if (trimmed.endsWith(close)) {
        const last = trimmed.slice(0, -close.length);
        if (last.trim()) lines.push(last);
        found = true;
        break;
      }
      lines.push(text);
    }
  }

  if (!found) return false;
  if (silent) return true;

  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.content = lines.join('\n').trim();
  token.markup = open;
  token.map = [startLine, nextLine + 1];

  state.line = nextLine + 1;
  return true;
}

/**
 * Math plugin: KaTeX rendering of TeX in markdown
 */
export class MathPlugin implements MarkdownPlugin {
  metadata: PluginMetadata = {
    id: BUILTIN_PLUGINS.MATH,
    name: 'Math',
    version: '1.0.0',
    description: 'TeX math ($…$, $$…$$, \\(…\\), \\[…\\]) rendered with KaTeX',
  };

  apply(md: MarkdownIt): void {
    md.inline.ruler.before('escape', 'math_inline', mathInline);
    md.block.ruler.before('fence', 'math_block', mathBlock, {
      alt: ['paragraph', 'reference', 'blockquote', 'list'],
    });

    md.renderer.rules['math_inline'] = (tokens: Token[], idx: number): string => {
      const token = tokens[idx]!;
      const display = Boolean((token.meta as { display?: boolean } | null)?.display);
      return this.render(token.content, display);
    };

    md.renderer.rules['math_block'] = (tokens: Token[], idx: number): string => {
      const token = tokens[idx]!;
      const lines = token.map ? ` data-source-lines="${token.map[0]}-${token.map[1]}"` : '';
      return `<div class="math-block"${lines}>${this.renderKatex(token.content, true)}</div>\n`;
    };
  }

  /**
   * Render TeX to HTML. Errors never throw: KaTeX prints the offending TeX in
   * its error colour instead, so one bad formula cannot blank a document.
   */
  private render(tex: string, display: boolean): string {
    const html = this.renderKatex(tex, display);
    return display
      ? `<span class="math-display">${html}</span>`
      : `<span class="math-inline">${html}</span>`;
  }

  private renderKatex(tex: string, display: boolean): string {
    return katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      output: 'html',
      strict: 'ignore',
      trust: false,
    });
  }

  getStyles(): string {
    return `
      /* Math (KaTeX) */
      .math-block {
        margin: 1em 0;
        overflow-x: auto;
        overflow-y: hidden;
      }

      .math-block .katex-display {
        margin: 0;
      }

      .math-display {
        display: block;
        margin: 1em 0;
        overflow-x: auto;
      }

      .math-inline .katex {
        font-size: 1.05em;
      }

      .katex .katex-error {
        color: var(--error-text);
      }
    `;
  }
}

/**
 * Factory function for creating the plugin
 */
export function createMathPlugin(): MarkdownPlugin {
  return new MathPlugin();
}
