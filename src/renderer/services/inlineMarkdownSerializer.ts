/**
 * inlineMarkdownSerializer - Converts a segment's inline DOM back into markdown.
 *
 * Edit mode's WYSIWYG surface lets the user toggle a fixed set of inline marks
 * (bold, italic, strikethrough, inline code, link). On commit, the inline DOM
 * of a slice's `.slice-content` is walked here and emitted as markdown. Only
 * the supported tag set is handled; `canSerialize` (added later) guards against
 * anything else so source is never silently mangled.
 */

/**
 * Serialize the inline children of `root` to a markdown string.
 */
export function serializeInline(root: HTMLElement): string {
  let out = '';
  root.childNodes.forEach((node) => {
    out += serializeNode(node);
  });
  return out;
}

/** Characters that, appearing literally in rendered text, would be re-parsed
 *  as markdown syntax. Block-level characters (#, -, etc.) are intentionally
 *  not escaped — they are inert inside inline content. */
const ESCAPE_RE = /([\\`*_~[\]])/g;

function escapeText(text: string): string {
  return text.replace(ESCAPE_RE, '\\$1');
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeText(node.textContent ?? '');
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }
  const el = node as HTMLElement;
  const inner = Array.from(el.childNodes).map(serializeNode).join('');
  switch (el.tagName) {
    case 'STRONG':
    case 'B':
      return `**${inner}**`;
    case 'EM':
    case 'I':
      return `*${inner}*`;
    case 'DEL':
    case 'S':
      return `~~${inner}~~`;
    case 'CODE':
      return `\`${el.textContent ?? ''}\``;
    case 'A': {
      const href = el.getAttribute('href') ?? '';
      return `[${inner}](${href})`;
    }
    case 'BR':
      return '\n';
    default:
      return inner;
  }
}

/** Element tags the serializer knows how to faithfully emit. The block-level
 *  tags (P, H1-H6, UL/OL/LI, BLOCKQUOTE) appear as the markdown-it-rendered
 *  wrappers around a slice's inline content; serializeNode's default case
 *  descends into them transparently, and the controller re-applies the slice's
 *  block prefix on commit. Anything outside this set (inline <img>, <sup>,
 *  styled <span>, raw HTML, tables, <pre>/code-block, <hr>) routes to the raw
 *  editor so source is never silently mangled. */
const SUPPORTED_TAGS = new Set([
  'STRONG', 'B', 'EM', 'I', 'DEL', 'S', 'CODE', 'A', 'BR',
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'UL', 'OL', 'LI', 'BLOCKQUOTE',
]);

/**
 * Returns true when every element inside `root` is one the serializer can
 * faithfully round-trip. When false, the caller must fall back to raw-markdown
 * editing rather than risk mangling the source.
 */
export function canSerialize(root: HTMLElement): boolean {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    if (!SUPPORTED_TAGS.has((node as Element).tagName)) {
      return false;
    }
    node = walker.nextNode();
  }
  return true;
}
