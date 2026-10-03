/**
 * Task-list markers in markdown source.
 *
 * A rendered checkbox knows which source line it came from; toggling it means
 * flipping the `[ ]` / `[x]` on that one line and nothing else. The item's
 * text, its list marker, its indentation, any blockquote prefix and the rest
 * of the document all stay byte-for-byte as they were -- the user ticked a
 * box, they did not reformat their file.
 */

/**
 * A task marker at the start of a list item: optional blockquote prefixes,
 * indentation, a bullet (`-`, `*`, `+`) or ordered marker (`1.`, `1)`), at
 * least one space, then `[ ]`, `[x]` or `[X]` followed by whitespace or the
 * end of the line.
 */
const TASK_MARKER = /^((?:\s*>)*\s*(?:[-*+]|\d{1,9}[.)])\s+)\[( |x|X)\](?=\s|$)/;

/**
 * Where a line's task marker sits and whether it is ticked.
 */
export interface TaskMarker {
  /** Offset of the character inside the brackets, relative to the line start */
  stateIndex: number;
  /** Whether the marker reads as checked */
  checked: boolean;
}

/**
 * Describe the task marker on one line of source, or null when the line does
 * not start a task item. A trailing `\r` (CRLF files) is tolerated.
 */
export function readTaskMarker(line: string): TaskMarker | null {
  const match = TASK_MARKER.exec(line);
  if (!match) return null;
  const prefix = match[1] ?? '';
  const state = match[2] ?? ' ';
  return {
    stateIndex: prefix.length + 1,
    checked: state !== ' ',
  };
}

/**
 * Flip the task marker on the given 0-based line.
 *
 * Returns the updated markdown, or null when that line carries no task marker
 * (the document changed under the rendered view, say). Line endings are left
 * as found: a CRLF file stays CRLF.
 *
 * Unchecking always writes a space. Checking writes a lowercase `x` -- the
 * form GitHub itself writes -- unless the document already uses uppercase on
 * that line, which is kept.
 */
export function toggleTaskAtLine(markdown: string, line: number): string | null {
  const lines = markdown.split('\n');
  const source = lines[line];
  if (source === undefined) return null;

  const marker = readTaskMarker(source);
  if (!marker) return null;

  const current = source.charAt(marker.stateIndex);
  const next = marker.checked ? ' ' : current === 'X' ? 'X' : 'x';

  lines[line] =
    source.slice(0, marker.stateIndex) + next + source.slice(marker.stateIndex + 1);
  return lines.join('\n');
}
