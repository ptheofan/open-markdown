/**
 * Shared helpers for emitting markdown inline marks.
 *
 * Both the edit-mode serializer (which walks inline DOM) and the Google Docs
 * reverse converter (which walks API text runs) have to turn styled spans back
 * into `**`, `*` and `~~`. The CommonMark flanking rules are subtle enough that
 * duplicating them once produced a real bug, so they live here.
 */

/** Characters that, appearing literally in rendered text, would be re-parsed
 *  as markdown syntax. Block-level characters (#, -, etc.) are intentionally
 *  not escaped — they are inert inside inline content. */
const ESCAPE_RE = /([\\`*_~[\]])/g;

export function escapeText(text: string): string {
  return text.replace(ESCAPE_RE, '\\$1');
}

/**
 * Wrap content in an inline delimiter, keeping any leading or trailing
 * whitespace *outside* the markers.
 *
 * CommonMark will not close emphasis on a delimiter preceded by whitespace,
 * so `**word **` is not bold at all -- it renders as literal asterisks. Both
 * callers hand us exactly that shape routinely: the browser because
 * double-clicking a word selects its trailing space, and Google Docs because
 * a user bolding a word usually catches the space after it.
 */
export function delimit(inner: string, marker: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  if (!match) return `${marker}${inner}${marker}`;
  const [, lead = '', core, trail = ''] = match;
  // Nothing but whitespace: `** **` is not emphasis either, so emit it bare.
  if (!core) return inner;
  return `${lead}${marker}${core}${marker}${trail}`;
}
