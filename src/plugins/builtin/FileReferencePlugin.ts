/**
 * FileReferencePlugin - turns `src/foo.ts:42` into a link
 *
 * Code spans that read as a path, and paths with a directory or a line
 * number in running text, become anchors carrying the path and position as
 * data attributes. Whether the file exists, and what opening it means, is
 * the viewer's business: it resolves each reference against the document's
 * folder and the project root, marks the ones that go nowhere, and opens
 * the rest in the editor or, for markdown, in the viewer itself.
 */
import { BUILTIN_PLUGINS } from '@shared/constants';
import { findFileReferences, parseFileReference, type FileReference } from '@shared/markdown/fileReferences';

import type { MarkdownPlugin, PluginMetadata } from '@shared/types';
import type MarkdownIt from 'markdown-it';
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs';
import type Token from 'markdown-it/lib/token.mjs';

/** Class on every anchor this plugin produces */
export const FILE_REF_CLASS = 'file-ref';

function linkTokens(state: StateCore, ref: FileReference, inner: Token[]): Token[] {
  const open = new state.Token('link_open', 'a', 1);
  open.attrSet('href', '#');
  open.attrSet('class', FILE_REF_CLASS);
  open.attrSet('data-file-ref', ref.path);
  if (ref.line !== null) open.attrSet('data-file-line', String(ref.line));
  if (ref.column !== null) open.attrSet('data-file-column', String(ref.column));
  open.info = 'file-ref';

  const close = new state.Token('link_close', 'a', -1);
  return [open, ...inner, close];
}

/**
 * Replace path-like text and code spans inside one inline token's children.
 * Children already inside a link are left alone.
 */
function linkReferences(state: StateCore, inline: Token): void {
  const children = inline.children;
  if (!children) return;

  const out: Token[] = [];
  let linkDepth = 0;
  let changed = false;

  for (const child of children) {
    if (child.type === 'link_open') linkDepth++;
    if (child.type === 'link_close') linkDepth--;

    if (linkDepth > 0 || (child.type !== 'text' && child.type !== 'code_inline')) {
      out.push(child);
      continue;
    }

    if (child.type === 'code_inline') {
      const ref = parseFileReference(child.content);
      if (ref) {
        out.push(...linkTokens(state, ref, [child]));
        changed = true;
      } else {
        out.push(child);
      }
      continue;
    }

    const matches = findFileReferences(child.content);
    if (matches.length === 0) {
      out.push(child);
      continue;
    }

    let last = 0;
    for (const match of matches) {
      if (match.start > last) {
        const before = new state.Token('text', '', 0);
        before.content = child.content.slice(last, match.start);
        out.push(before);
      }
      const text = new state.Token('text', '', 0);
      text.content = child.content.slice(match.start, match.end);
      out.push(...linkTokens(state, match, [text]));
      last = match.end;
    }
    if (last < child.content.length) {
      const after = new state.Token('text', '', 0);
      after.content = child.content.slice(last);
      out.push(after);
    }
    changed = true;
  }

  if (changed) inline.children = out;
}

/**
 * File reference plugin
 */
export class FileReferencePlugin implements MarkdownPlugin {
  metadata: PluginMetadata = {
    id: BUILTIN_PLUGINS.FILE_REFERENCES,
    name: 'File References',
    version: '1.0.0',
    description: 'Links file paths such as src/app.ts:42 to the file',
  };

  apply(md: MarkdownIt): void {
    // After linkify, so URLs are already links and skipped here
    md.core.ruler.after('linkify', 'file_references', (state: StateCore) => {
      for (const token of state.tokens) {
        if (token.type === 'inline') linkReferences(state, token);
      }
    });
  }

  getStyles(): string {
    return `
      /* File references */
      a.file-ref {
        color: var(--doc-link-color, var(--link-color));
        text-decoration: none;
        border-bottom: 1px dotted currentColor;
      }

      a.file-ref:hover {
        text-decoration: none;
        border-bottom-style: solid;
      }

      a.file-ref code {
        color: inherit;
      }

      /* A reference that resolves to nothing is just text */
      a.file-ref.file-ref-unresolved,
      a.file-ref.file-ref-unresolved:hover {
        color: inherit;
        border-bottom: none;
        cursor: text;
        text-decoration: none;
      }
    `;
  }
}

/**
 * Factory function for creating the plugin
 */
export function createFileReferencePlugin(): MarkdownPlugin {
  return new FileReferencePlugin();
}
