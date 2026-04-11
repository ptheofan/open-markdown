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

  // Map markdown heading levels to Google Docs named styles:
  // # (h1) → TITLE, ## (h2) → HEADING_1, ### (h3) → HEADING_2, etc.
  const level = element.headingLevel ?? 1;
  const namedStyleType = level === 1 ? 'TITLE' : `HEADING_${level - 1}`;
  ctx.requests.push({
    updateParagraphStyle: {
      range: { startIndex, endIndex: startIndex + fullText.length },
      paragraphStyle: { namedStyleType },
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

// ── Heading level → Google Docs named style ─────────────────────────

export function headingLevelToNamedStyle(level: number): string {
  return level === 1 ? 'TITLE' : `HEADING_${level - 1}`;
}

// ── Formatting-only requests from API doc structure ─────────────────
//
// After a text diff is applied, the document text is correct but
// paragraph styles and inline formatting may be wrong.  This function
// walks the Google Docs API response alongside our DocsDocument model
// and generates updateParagraphStyle / updateTextStyle / bullet
// requests using the *actual* paragraph indices from the API.

export interface ApiParagraph {
  text: string;
  startIndex: number;
  endIndex: number;
  textStartIndex: number;
}

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
export function extractApiParagraphs(apiDoc: any): ApiParagraph[] {
  const result: ApiParagraph[] = [];
  const content = apiDoc?.body?.content;
  if (!Array.isArray(content)) return result;

  for (const el of content) {
    if (el.paragraph) {
      let text = '';
      let firstTextIndex = el.startIndex;
      let foundText = false;
      for (const pe of el.paragraph.elements ?? []) {
        if (pe.textRun?.content) {
          if (!foundText) {
            firstTextIndex = pe.startIndex;
            foundText = true;
          }
          text += pe.textRun.content;
        }
      }
      result.push({
        text,
        startIndex: el.startIndex,
        endIndex: el.endIndex,
        textStartIndex: firstTextIndex,
      });
    }
    // Skip table and other structural elements — they keep their
    // original formatting from the initial populate.
  }
  return result;
}
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */

/**
 * Flatten DocsDocument elements into an ordered list of leaf elements
 * (paragraphs, headings, list items, code blocks, horizontal rules).
 * Blockquotes are expanded recursively; tables and images are skipped
 * because they are structural and handled separately.
 */
export function flattenElements(elements: DocsElement[]): DocsElement[] {
  const flat: DocsElement[] = [];
  for (const el of elements) {
    if (el.type === 'blockquote') {
      if (el.children) flat.push(...flattenElements(el.children));
    } else if (el.type === 'table' || el.type === 'image') {
      // Structural — skip in paragraph matching
    } else {
      flat.push(el);
    }
  }
  return flat;
}

/**
 * Get the plain text of a leaf element (without trailing newline).
 */
export function getLeafText(element: DocsElement): string {
  switch (element.type) {
    case 'paragraph':
    case 'heading':
    case 'list_item':
      return (element.runs ?? []).map(r => r.text).join('');
    case 'code_block':
      return (element.code ?? '').replace(/\n$/, '');
    case 'horizontal_rule':
      return '';
    default:
      return '';
  }
}

/**
 * Apply formatting for a single model element to an API paragraph.
 * Generates updateParagraphStyle, updateTextStyle, and bullet requests
 * using the actual API paragraph indices.
 */
function applyElementFormatting(
  requests: any[],
  elem: DocsElement,
  apiPara: ApiParagraph,
): void {
  // ── Paragraph style ──────────────────────────────────────────
  if (elem.type === 'heading') {
    const level = elem.headingLevel ?? 1;
    requests.push({
      updateParagraphStyle: {
        range: { startIndex: apiPara.startIndex, endIndex: apiPara.endIndex },
        paragraphStyle: { namedStyleType: headingLevelToNamedStyle(level) },
        fields: 'namedStyleType',
      },
    });
  } else if (elem.type === 'code_block') {
    requests.push({
      updateParagraphStyle: {
        range: { startIndex: apiPara.startIndex, endIndex: apiPara.endIndex },
        paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
        fields: 'namedStyleType',
      },
    });
  } else if (elem.type === 'list_item') {
    const bulletPreset = elem.listOrdered
      ? 'NUMBERED_DECIMAL_ALPHA_ROMAN'
      : 'BULLET_DISC_CIRCLE_SQUARE';
    requests.push({
      createParagraphBullets: {
        range: { startIndex: apiPara.startIndex, endIndex: apiPara.endIndex },
        bulletPreset,
      },
    });
    const depth = elem.listDepth ?? 0;
    if (depth > 0) {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: apiPara.startIndex, endIndex: apiPara.endIndex },
          paragraphStyle: {
            indentStart: { magnitude: 36 * depth, unit: 'PT' },
            indentFirstLine: { magnitude: 36 * depth, unit: 'PT' },
          },
          fields: 'indentStart,indentFirstLine',
        },
      });
    }
  } else if (elem.type === 'horizontal_rule') {
    requests.push({
      updateParagraphStyle: {
        range: { startIndex: apiPara.startIndex, endIndex: apiPara.endIndex },
        paragraphStyle: {
          borderBottom: {
            color: { color: { rgbColor: { red: 0.855, green: 0.82, blue: 0.878 } } },
            width: { magnitude: 1, unit: 'PT' },
            dashStyle: 'SOLID',
            padding: { magnitude: 8, unit: 'PT' },
          },
        },
        fields: 'borderBottom',
      },
    });
  } else {
    // Regular paragraph — ensure NORMAL_TEXT
    requests.push({
      updateParagraphStyle: {
        range: { startIndex: apiPara.startIndex, endIndex: apiPara.endIndex },
        paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
        fields: 'namedStyleType',
      },
    });
  }

  // ── Inline text styles ───────────────────────────────────────
  if (elem.runs && elem.runs.length > 0) {
    let runOffset = 0;
    for (const run of elem.runs) {
      const textStyle = buildTextStyleForRun(run);
      if (textStyle) {
        const start = apiPara.textStartIndex + runOffset;
        const end = start + run.text.length;
        requests.push({
          updateTextStyle: {
            range: { startIndex: start, endIndex: end },
            textStyle,
            fields: collectFields(textStyle),
          },
        });
      }
      runOffset += run.text.length;
    }
  }

  // Code block: apply monospace to entire text (excluding trailing newline,
  // consistent with buildCodeBlock which styles up to fullText.length - 1)
  if (elem.type === 'code_block') {
    const codeText = (elem.code ?? '').replace(/\n$/, '');
    const styledEnd = apiPara.textStartIndex + codeText.length;
    if (styledEnd > apiPara.textStartIndex) {
      requests.push({
        updateTextStyle: {
          range: { startIndex: apiPara.textStartIndex, endIndex: styledEnd },
          textStyle: {
            weightedFontFamily: { fontFamily: 'Courier New' },
            fontSize: { magnitude: 9, unit: 'PT' },
          },
          fields: 'weightedFontFamily,fontSize',
        },
      });
    }
  }

  // Reset foreground color to prevent bleeding
  requests.push({
    updateTextStyle: {
      range: { startIndex: apiPara.startIndex, endIndex: apiPara.endIndex },
      textStyle: { foregroundColor: {} },
      fields: 'foregroundColor',
    },
  });
}

// Maximum number of API paragraphs to scan ahead when looking for
// a match.  Structural gaps (table cells, image-adjacent paragraphs)
// are typically 1-5 paragraphs wide.
const LOOKAHEAD_WINDOW = 10;

/**
 * Build formatting-only requests by matching API paragraphs to model
 * elements with **lookahead recovery**.
 *
 * After a paragraph-level diff is applied, the document's text paragraphs
 * appear in the same order as the model elements — but the API paragraph
 * list also contains structural gaps (table cell paragraphs, image-adjacent
 * text).  When a mismatch occurs the algorithm scans ahead in the API list
 * (up to LOOKAHEAD_WINDOW) to find the next matching paragraph.
 */
export function buildFormattingFromApiDoc(apiDoc: any, docsDoc: DocsDocument): any[] {
  const requests: any[] = [];
  const apiParas = extractApiParagraphs(apiDoc);
  const modelElements = flattenElements(docsDoc.elements);

  // Collect blockquote child indices for indentation
  const blockquoteChildIndices = new Set<number>();
  collectBlockquoteChildIndices(docsDoc.elements, modelElements, blockquoteChildIndices);

  let apiIdx = 0;

  for (let modelIdx = 0; modelIdx < modelElements.length; modelIdx++) {
    if (apiIdx >= apiParas.length) break;

    const elem = modelElements[modelIdx]!;
    const elemText = getLeafText(elem);

    // Try to find a matching API paragraph starting at apiIdx
    let matchOffset = -1;
    const searchEnd = Math.min(apiIdx + LOOKAHEAD_WINDOW, apiParas.length);
    for (let j = apiIdx; j < searchEnd; j++) {
      if (apiParas[j]!.text.replace(/\n$/, '') === elemText) {
        matchOffset = j - apiIdx;
        break;
      }
    }

    if (matchOffset < 0) {
      // No match found in lookahead window — skip this model element
      continue;
    }

    // Skip the structural-gap paragraphs and land on the match
    apiIdx += matchOffset;
    const apiPara = apiParas[apiIdx]!;

    applyElementFormatting(requests, elem, apiPara);

    // Apply blockquote indentation if this element is inside a blockquote
    if (blockquoteChildIndices.has(modelIdx)) {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: apiPara.startIndex, endIndex: apiPara.endIndex },
          paragraphStyle: { indentStart: { magnitude: 36, unit: 'PT' } },
          fields: 'indentStart',
        },
      });
    }

    apiIdx++;
  }

  return requests;
}

/**
 * Collect model-element indices that are children of blockquotes.
 */
function collectBlockquoteChildIndices(
  elements: DocsElement[],
  flatElements: DocsElement[],
  result: Set<number>,
): void {
  for (const el of elements) {
    if (el.type === 'blockquote' && el.children) {
      const children = flattenElements(el.children);
      for (const child of children) {
        const idx = flatElements.indexOf(child);
        if (idx >= 0) result.add(idx);
      }
    }
  }
}
