/**
 * DocsDocumentBuilder - Converts a DocsDocument into Google Docs API batchUpdate requests
 *
 * Takes a parsed DocsDocument (array of DocsElement) and produces an array of
 * Google Docs API request objects that, when applied via batchUpdate, will
 * insert the document content starting at the given index.
 */
import type { DocsDocument, DocsElement, DocsTextRun } from '@shared/types/google-docs';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface BuildContext {
  index: number;
  requests: any[];
}

function collectFields(style: Record<string, unknown>): string {
  const fieldNames: string[] = [];
  if ('bold' in style) fieldNames.push('bold');
  if ('italic' in style) fieldNames.push('italic');
  if ('strikethrough' in style) fieldNames.push('strikethrough');
  if ('link' in style) fieldNames.push('link');
  if ('weightedFontFamily' in style) fieldNames.push('weightedFontFamily');
  if ('fontSize' in style) fieldNames.push('fontSize');
  return fieldNames.join(',');
}

function buildTextStyleForRun(run: DocsTextRun): Record<string, unknown> | null {
  const style: Record<string, unknown> = {};
  if (run.bold) style['bold'] = true;
  if (run.italic) style['italic'] = true;
  if (run.strikethrough) style['strikethrough'] = true;
  if (run.link) style['link'] = { url: run.link };
  if (run.code) {
    style['weightedFontFamily'] = { fontFamily: 'Courier New' };
    style['fontSize'] = { magnitude: 9, unit: 'PT' };
  }
  if (Object.keys(style).length === 0) return null;
  return style;
}

function insertRunsWithFormatting(
  ctx: BuildContext,
  runs: DocsTextRun[],
  paragraphStartIndex: number,
): void {
  let runOffset = 0;
  for (const run of runs) {
    const textStyle = buildTextStyleForRun(run);
    if (textStyle) {
      const startIdx = paragraphStartIndex + runOffset;
      const endIdx = startIdx + run.text.length;
      ctx.requests.push({
        updateTextStyle: {
          range: { startIndex: startIdx, endIndex: endIdx },
          textStyle,
          fields: collectFields(textStyle),
        },
      });
    }
    runOffset += run.text.length;
  }
}

function getRunsText(runs: DocsTextRun[]): string {
  return runs.map(r => r.text).join('');
}

function buildParagraph(ctx: BuildContext, element: DocsElement): void {
  const runs = element.runs ?? [];
  const fullText = getRunsText(runs) + '\n';
  const startIndex = ctx.index;

  ctx.requests.push({
    insertText: {
      text: fullText,
      location: { index: startIndex },
    },
  });

  insertRunsWithFormatting(ctx, runs, startIndex);

  ctx.index += fullText.length;
}

function buildHeading(ctx: BuildContext, element: DocsElement): void {
  const runs = element.runs ?? [];
  const fullText = getRunsText(runs) + '\n';
  const startIndex = ctx.index;

  ctx.requests.push({
    insertText: {
      text: fullText,
      location: { index: startIndex },
    },
  });

  insertRunsWithFormatting(ctx, runs, startIndex);

  const level = element.headingLevel ?? 1;
  ctx.requests.push({
    updateParagraphStyle: {
      range: { startIndex, endIndex: startIndex + fullText.length },
      paragraphStyle: { namedStyleType: `HEADING_${level}` },
      fields: 'namedStyleType',
    },
  });

  ctx.index += fullText.length;
}

function buildCodeBlock(ctx: BuildContext, element: DocsElement): void {
  const code = element.code ?? '';
  // Ensure code ends with newline
  const fullText = code.endsWith('\n') ? code : code + '\n';
  const startIndex = ctx.index;

  ctx.requests.push({
    insertText: {
      text: fullText,
      location: { index: startIndex },
    },
  });

  // Apply monospace font to entire code block (exclude trailing newline for style)
  const styledEnd = startIndex + fullText.length - 1;
  if (styledEnd > startIndex) {
    ctx.requests.push({
      updateTextStyle: {
        range: { startIndex, endIndex: styledEnd },
        textStyle: {
          weightedFontFamily: { fontFamily: 'Courier New' },
          fontSize: { magnitude: 9, unit: 'PT' },
        },
        fields: 'weightedFontFamily,fontSize',
      },
    });
  }

  ctx.requests.push({
    updateParagraphStyle: {
      range: { startIndex, endIndex: startIndex + fullText.length },
      paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
      fields: 'namedStyleType',
    },
  });

  ctx.index += fullText.length;
}

function buildListItem(ctx: BuildContext, element: DocsElement): void {
  const runs = element.runs ?? [];
  const fullText = getRunsText(runs) + '\n';
  const startIndex = ctx.index;

  ctx.requests.push({
    insertText: {
      text: fullText,
      location: { index: startIndex },
    },
  });

  insertRunsWithFormatting(ctx, runs, startIndex);

  const bulletPreset = element.listOrdered
    ? 'NUMBERED_DECIMAL_ALPHA_ROMAN'
    : 'BULLET_DISC_CIRCLE_SQUARE';

  ctx.requests.push({
    createParagraphBullets: {
      range: { startIndex, endIndex: startIndex + fullText.length },
      bulletPreset,
    },
  });

  // Apply indentation for nested list items
  const depth = element.listDepth ?? 0;
  if (depth > 0) {
    const indentMagnitude = 36 * depth; // 36pt per level
    ctx.requests.push({
      updateParagraphStyle: {
        range: { startIndex, endIndex: startIndex + fullText.length },
        paragraphStyle: {
          indentStart: { magnitude: indentMagnitude, unit: 'PT' },
          indentFirstLine: { magnitude: indentMagnitude, unit: 'PT' },
        },
        fields: 'indentStart,indentFirstLine',
      },
    });
  }

  ctx.index += fullText.length;
}

function buildTable(ctx: BuildContext, element: DocsElement): void {
  const rows = element.rows ?? [];
  if (rows.length === 0) return;

  const numRows = rows.length;
  const numCols = rows[0]!.length;
  const startIndex = ctx.index;

  ctx.requests.push({
    insertTable: {
      rows: numRows,
      columns: numCols,
      location: { index: startIndex },
    },
  });

  // Table structure occupies indices. For v1, we just insert the table
  // without populating cell content. Cell content population would require
  // knowing the exact cell indices, which needs a document re-read.
  // The table itself takes: 1 (table start) + for each row: 1 (row start) + for each cell: 3 (cell start + paragraph + newline) + 1 (row end) + 1 (table end)
  // Total = 1 + numRows * (1 + numCols * 3 + 1) + 1 + 1 (trailing newline)
  const tableSize = 1 + numRows * (1 + numCols * 3) + numRows + 1 + 1;
  ctx.index += tableSize;
}

function buildHorizontalRule(ctx: BuildContext): void {
  const ruleText = '\u2015'.repeat(30) + '\n'; // horizontal bar character
  const startIndex = ctx.index;

  ctx.requests.push({
    insertText: {
      text: ruleText,
      location: { index: startIndex },
    },
  });

  ctx.index += ruleText.length;
}

function buildImage(ctx: BuildContext, element: DocsElement): void {
  // Only insert if imageLink is available (uploaded to Drive)
  if (!element.imageLink) return;

  ctx.requests.push({
    insertInlineImage: {
      uri: element.imageLink,
      location: { index: ctx.index },
      objectSize: {
        width: { magnitude: 400, unit: 'PT' },
        height: { magnitude: 300, unit: 'PT' },
      },
    },
  });

  // Inline image occupies 1 index position
  ctx.index += 1;

  // Add a newline after the image
  ctx.requests.push({
    insertText: {
      text: '\n',
      location: { index: ctx.index },
    },
  });
  ctx.index += 1;
}

function buildBlockquote(ctx: BuildContext, element: DocsElement): void {
  const children = element.children ?? [];
  const startIndex = ctx.index;

  // Recursively build children
  for (const child of children) {
    buildElement(ctx, child);
  }

  const endIndex = ctx.index;

  // Apply indentation to the entire blockquote range
  if (endIndex > startIndex) {
    ctx.requests.push({
      updateParagraphStyle: {
        range: { startIndex, endIndex },
        paragraphStyle: {
          indentStart: { magnitude: 36, unit: 'PT' },
        },
        fields: 'indentStart',
      },
    });
  }
}

function buildElement(ctx: BuildContext, element: DocsElement): void {
  switch (element.type) {
    case 'paragraph':
      buildParagraph(ctx, element);
      break;
    case 'heading':
      buildHeading(ctx, element);
      break;
    case 'code_block':
      buildCodeBlock(ctx, element);
      break;
    case 'list_item':
      buildListItem(ctx, element);
      break;
    case 'table':
      buildTable(ctx, element);
      break;
    case 'horizontal_rule':
      buildHorizontalRule(ctx);
      break;
    case 'image':
      buildImage(ctx, element);
      break;
    case 'blockquote':
      buildBlockquote(ctx, element);
      break;
  }
}

export function buildInsertRequests(doc: DocsDocument, startIndex: number): any[] {
  const ctx: BuildContext = {
    index: startIndex,
    requests: [],
  };

  for (const element of doc.elements) {
    buildElement(ctx, element);
  }

  return ctx.requests;
}
