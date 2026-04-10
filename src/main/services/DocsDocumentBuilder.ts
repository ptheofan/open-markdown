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
  pendingTables: PendingTable[];
}

export interface PendingTable {
  placeholderText: string;
  rows: DocsTextRun[][][];
}

export interface BuildResult {
  requests: any[];
  pendingTables: PendingTable[];
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

  // Insert a unique placeholder — real table will be inserted in phase 2
  const tableId = ctx.pendingTables.length;
  const placeholderText = `<<TABLE_${tableId}>>\n`;

  ctx.requests.push({
    insertText: {
      text: placeholderText,
      location: { index: ctx.index },
    },
  });

  ctx.pendingTables.push({ placeholderText, rows });
  ctx.index += placeholderText.length;
}

function buildHorizontalRule(ctx: BuildContext): void {
  // Insert an empty paragraph, then style it with a bottom border to create a clean line
  const startIndex = ctx.index;

  ctx.requests.push({
    insertText: {
      text: '\n',
      location: { index: startIndex },
    },
  });

  ctx.requests.push({
    updateParagraphStyle: {
      range: { startIndex, endIndex: startIndex + 1 },
      paragraphStyle: {
        borderBottom: {
          color: { color: { rgbColor: { red: 0.855, green: 0.82, blue: 0.878 } } }, // #dadce0
          width: { magnitude: 1, unit: 'PT' },
          dashStyle: 'SOLID',
          padding: { magnitude: 8, unit: 'PT' },
        },
      },
      fields: 'borderBottom',
    },
  });

  ctx.index += 1;
}

function buildImage(ctx: BuildContext, element: DocsElement): void {
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

  // Add "Edit in Mermaid Live" link after the image
  if (element.mermaidLiveUrl) {
    const linkText = '\nEdit in Mermaid Live\n';
    const linkStart = ctx.index;
    ctx.requests.push({
      insertText: {
        text: linkText,
        location: { index: linkStart },
      },
    });
    ctx.requests.push({
      updateTextStyle: {
        range: { startIndex: linkStart + 1, endIndex: linkStart + linkText.length - 1 },
        textStyle: {
          link: { url: element.mermaidLiveUrl },
          fontSize: { magnitude: 9, unit: 'PT' },
        },
        fields: 'link,fontSize',
      },
    });
    ctx.index += linkText.length;
  } else {
    // Just a newline after the image
    ctx.requests.push({
      insertText: {
        text: '\n',
        location: { index: ctx.index },
      },
    });
    ctx.index += 1;
  }
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
  const startIndex = ctx.index;

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

  // Reset foreground color after each element to prevent color bleeding
  // (e.g., heading styles setting a color that subsequent text inherits)
  const endIndex = ctx.index;
  if (endIndex > startIndex && element.type !== 'table' && element.type !== 'image') {
    ctx.requests.push({
      updateTextStyle: {
        range: { startIndex, endIndex },
        textStyle: {
          foregroundColor: {},
        },
        fields: 'foregroundColor',
      },
    });
  }
}

export function buildInsertRequests(doc: DocsDocument, startIndex: number): BuildResult {
  const ctx: BuildContext = {
    index: startIndex,
    requests: [],
    pendingTables: [],
  };

  for (const element of doc.elements) {
    buildElement(ctx, element);
  }

  return { requests: ctx.requests, pendingTables: ctx.pendingTables };
}
