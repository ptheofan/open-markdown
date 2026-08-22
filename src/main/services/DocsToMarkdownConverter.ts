/**
 * DocsToMarkdownConverter - the reverse of MarkdownToDocsConverter.
 *
 * Reads a Google Docs API document and emits markdown. Used to pull a
 * collaborator's edits back into the local file.
 *
 * ## This converter is lossy on purpose
 *
 * A ```mermaid fence is only a PNG once it reaches the Doc, and a code block's
 * language has nowhere to live in the Docs model at all. Round-tripping cannot
 * recover them, and pretending otherwise would quietly destroy the user's
 * source.
 *
 * What it must be instead is **deterministic**. Each side of a sync is diffed
 * against its own previous output from this same function, so a block nobody
 * touched has to produce byte-identical text every time. When it does, the
 * lossiness cancels: unchanged regions raise no diff hunk and keep their
 * original markdown, and only text a human actually edited in the Doc is ever
 * rewritten from here.
 *
 * That is why image URLs come from `sourceUri` rather than `contentUri` --
 * Google regenerates the latter on every read.
 */

import { delimit, escapeText } from '@shared/markdown/inlineMarks';
import { DOCS_LINE_BREAK } from '@shared/constants';
import { CODE_FONT_FAMILY } from './DocsDocumentBuilder';
import type {
  GDocsApiDocument,
  GDocsStructuralElement,
} from '@shared/types/google-docs';

/** Indent, in points, that MarkdownToDocsConverter gives one nesting level. */
const INDENT_STEP_PT = 36;

interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  code: boolean;
  link?: string;
}

type StyleBag = Record<string, unknown>;

function readRuns(el: GDocsStructuralElement): Run[] {
  const runs: Run[] = [];
  for (const pe of el.paragraph?.elements ?? []) {
    const content = pe.textRun?.content;
    if (content == null) continue;
    const ts = (pe.textRun?.textStyle ?? {}) as StyleBag;
    const family = (ts['weightedFontFamily'] as { fontFamily?: string } | undefined)?.fontFamily;
    runs.push({
      // A vertical tab is a line break inside the paragraph; markdown spells
      // that as two spaces and a newline. Leaving it as a raw control
      // character would show up as a difference on every later sync.
      text: content.split(DOCS_LINE_BREAK).join('  \n'),
      bold: ts['bold'] === true,
      italic: ts['italic'] === true,
      strikethrough: ts['strikethrough'] === true,
      code: family === CODE_FONT_FAMILY,
      link: (ts['link'] as { url?: string } | undefined)?.url,
    });
  }
  return runs;
}

function sameStyle(a: Run, b: Run): boolean {
  return a.bold === b.bold && a.italic === b.italic
    && a.strikethrough === b.strikethrough && a.code === b.code && a.link === b.link;
}

/**
 * Join runs that carry identical styling.
 *
 * Docs splits a run wherever it likes -- a single bolded word routinely comes
 * back as two runs. Emitting each separately would give `**Test****t2**`, and
 * would also make the output depend on where Docs happened to split, which
 * breaks the determinism the whole design rests on.
 */
function coalesce(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    const last = out.at(-1);
    if (last && sameStyle(last, run)) last.text += run.text;
    else out.push({ ...run });
  }
  return out;
}

function renderRun(run: Run): string {
  if (!run.text) return '';
  if (run.code) {
    const inner = `\`${run.text}\``;
    return run.link ? `[${inner}](${run.link})` : inner;
  }
  let out = escapeText(run.text);
  if (run.bold) out = delimit(out, '**');
  if (run.italic) out = delimit(out, '*');
  if (run.strikethrough) out = delimit(out, '~~');
  if (run.link) out = `[${out}](${run.link})`;
  return out;
}

/** Inline markdown for one paragraph, without its trailing newline. */
function inlineText(el: GDocsStructuralElement): string {
  const runs = coalesce(readRuns(el));
  const last = runs.at(-1);
  if (last) last.text = last.text.replace(/\n$/, '');
  return runs.map(renderRun).join('');
}

/** Plain, unformatted text of a paragraph -- for emptiness checks. */
function rawText(el: GDocsStructuralElement): string {
  return readRuns(el).map((r) => r.text).join('').replace(/\n$/, '');
}

function paragraphStyle(el: GDocsStructuralElement): StyleBag {
  return (el.paragraph?.paragraphStyle ?? {}) as StyleBag;
}

function indentLevel(el: GDocsStructuralElement): number {
  const indent = paragraphStyle(el)['indentStart'] as { magnitude?: number } | undefined;
  return Math.floor((indent?.magnitude ?? 0) / INDENT_STEP_PT);
}

/** A paragraph whose every run is monospace is a code block, not inline code. */
function isCodeParagraph(el: GDocsStructuralElement): boolean {
  const runs = readRuns(el).filter((r) => r.text.trim() !== '');
  return runs.length > 0 && runs.every((r) => r.code);
}

function isHorizontalRule(el: GDocsStructuralElement): boolean {
  return paragraphStyle(el)['borderBottom'] != null && rawText(el).trim() === '';
}

function isImage(el: GDocsStructuralElement): boolean {
  return (el.paragraph?.elements ?? []).some((pe) => pe.inlineObjectElement != null);
}

function headingPrefix(el: GDocsStructuralElement): string | null {
  const named = paragraphStyle(el)['namedStyleType'];
  if (named === 'TITLE') return '#';
  if (typeof named === 'string' && named.startsWith('HEADING_')) {
    const n = Number.parseInt(named.slice('HEADING_'.length), 10);
    if (Number.isFinite(n)) return '#'.repeat(Math.min(n + 1, 6));
  }
  return null;
}

function renderImage(el: GDocsStructuralElement, doc: GDocsApiDocument): string {
  const parts: string[] = [];
  for (const pe of el.paragraph?.elements ?? []) {
    const id = pe.inlineObjectElement?.inlineObjectId;
    if (id == null) continue;
    const embedded = doc.inlineObjects?.[id]?.inlineObjectProperties?.embeddedObject;
    const alt = embedded?.title ?? embedded?.description ?? '';
    // sourceUri is what we handed insertInlineImage; contentUri is regenerated
    // on every read and would make every sync look like a change.
    const url = embedded?.imageProperties?.sourceUri
      ?? embedded?.imageProperties?.contentUri
      ?? '';
    parts.push(`![${alt}](${url})`);
  }
  return parts.join('');
}

function isOrderedList(doc: GDocsApiDocument, listId: string | undefined, depth: number): boolean {
  if (listId == null) return false;
  const level = doc.lists?.[listId]?.listProperties?.nestingLevels?.[depth];
  // A bulleted level carries a glyph symbol; a numbered one carries a type.
  return level?.glyphSymbol == null && level?.glyphType != null;
}

function renderTable(el: GDocsStructuralElement): string {
  const rows = el.table?.tableRows ?? [];
  if (rows.length === 0) return '';

  const cellText = (cell: { content?: GDocsStructuralElement[] }): string =>
    (cell.content ?? [])
      .filter((c) => c.paragraph)
      .map((c) => inlineText(c))
      .join(' ')
      .replace(/\|/g, '\\|')
      .trim();

  const grid = rows.map((row) => (row.tableCells ?? []).map(cellText));
  const width = Math.max(...grid.map((r) => r.length));
  const line = (cells: string[]): string => {
    const padded = [...cells, ...Array<string>(width - cells.length).fill('')];
    return `| ${padded.join(' | ')} |`;
  };

  const [header = [], ...body] = grid;
  return [
    line(header),
    `| ${Array<string>(width).fill('---').join(' | ')} |`,
    ...body.map(line),
  ].join('\n');
}

/**
 * Convert a Google Docs API document to markdown.
 */
export function convertDocsToMarkdown(doc: GDocsApiDocument): string {
  const content = doc?.body?.content ?? [];
  const blocks: string[] = [];

  // Runs of adjacent paragraphs that belong to one markdown block.
  let codeLines: string[] | null = null;
  let listLines: string[] | null = null;
  let quoteLines: string[] | null = null;

  const flush = (): void => {
    if (codeLines) { blocks.push(['```', ...codeLines, '```'].join('\n')); codeLines = null; }
    if (listLines) { blocks.push(listLines.join('\n')); listLines = null; }
    if (quoteLines) { blocks.push(quoteLines.join('\n')); quoteLines = null; }
  };

  for (const el of content) {
    if (el.table) {
      flush();
      const table = renderTable(el);
      if (table) blocks.push(table);
      continue;
    }
    if (!el.paragraph) continue;

    if (isCodeParagraph(el)) {
      if (!codeLines) { flush(); codeLines = []; }
      codeLines.push(rawText(el));
      continue;
    }

    const bullet = el.paragraph.bullet;
    if (bullet) {
      if (!listLines) { flush(); listLines = []; }
      const depth = bullet.nestingLevel ?? 0;
      const marker = isOrderedList(doc, bullet.listId, depth) ? '1.' : '-';
      // An empty bullet is a Docs spacer, and a bare "- " in the middle of a
      // list splits it into two blocks that the source markdown never had.
      const item = inlineText(el);
      if (item.trim() !== '') listLines.push(`${'  '.repeat(depth)}${marker} ${item}`);
      continue;
    }

    if (isHorizontalRule(el)) { flush(); blocks.push('---'); continue; }

    if (isImage(el)) {
      flush();
      const image = renderImage(el, doc);
      if (image) blocks.push(image);
      continue;
    }

    const heading = headingPrefix(el);
    if (heading) {
      flush();
      // An empty heading paragraph is a Docs spacer. Emitting "## " would put
      // a block in the markdown that the file it came from never had.
      const title = inlineText(el);
      if (title.trim() !== '') blocks.push(`${heading} ${title}`);
      continue;
    }

    // An indented paragraph with no bullet is what a blockquote became.
    if (indentLevel(el) > 0) {
      if (!quoteLines) { flush(); quoteLines = []; }
      quoteLines.push(`> ${inlineText(el)}`);
      continue;
    }

    flush();
    // Empty paragraphs are Docs' block separators; markdown uses blank lines.
    const text = inlineText(el);
    if (text.trim() !== '') blocks.push(text);
  }
  flush();

  return blocks.length > 0 ? `${blocks.join('\n\n')}\n` : '';
}
