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
