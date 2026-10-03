/**
 * Sections of a markdown document: a heading and everything under it.
 *
 * A section runs from its heading to the next heading of the same or a
 * higher level, or to the end of the document. Fenced code is skipped, so a
 * `# comment` inside a shell snippet does not end a section early.
 */

/** Opening fence of a code block: three or more backticks or tildes. */
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/** ATX heading: one to six hashes, then at least one space or end of line. */
const ATX_HEADING = /^\s{0,3}(#{1,6})(?:\s|$)/;

/**
 * The 1-6 level of the ATX heading on this line, or null when the line is
 * not one. Setext headings (underlined with `===` / `---`) are not detected;
 * the renderer gives them a source line too, but they are rare in generated
 * markdown and never nest.
 */
function headingLevel(line: string): number | null {
  const match = ATX_HEADING.exec(line);
  return match ? (match[1]?.length ?? null) : null;
}

/**
 * The source lines of the section whose heading is on the given 0-based
 * line, or null when that line is not a heading. The result ends at the last
 * non-blank line of the section; trailing blank lines belong to nobody.
 */
export function extractSection(markdown: string, headingLine: number): string | null {
  const lines = markdown.split('\n');
  const heading = lines[headingLine];
  if (heading === undefined) return null;

  const level = headingLevel(heading);
  if (level === null) return null;

  let fence: string | null = null;
  let end = lines.length;

  for (let i = headingLine + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const fenceMatch = FENCE.exec(line);

    if (fence !== null) {
      // A closing fence uses the same character and is at least as long.
      const closer = fenceMatch?.[1];
      if (closer && closer[0] === fence[0] && closer.length >= fence.length) {
        fence = null;
      }
      continue;
    }

    if (fenceMatch?.[1]) {
      fence = fenceMatch[1];
      continue;
    }

    const nextLevel = headingLevel(line);
    if (nextLevel !== null && nextLevel <= level) {
      end = i;
      break;
    }
  }

  const section = lines.slice(headingLine, end);
  while (section.length > 0 && (section.at(-1) ?? '').trim() === '') section.pop();
  return section.join('\n');
}
