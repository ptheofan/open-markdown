/**
 * Formatting is re-applied to every paragraph on every sync, which on a large
 * document costs thousands of no-op API requests and dominates sync time.
 * Only paragraphs whose formatting actually differs should be touched.
 */
import { describe, it, expect } from 'vitest';
import { buildFormattingFromApiDoc } from '@main/services/DocsDocumentBuilder';
import type { GDocsApiDocument, DocsDocument } from '@shared/types/google-docs';

/** An API paragraph carrying explicit run styles, as Google returns them. */
interface TestApiPara {
  startIndex: number;
  endIndex: number;
  paragraph: unknown;
}

function apiPara(
  runs: { text: string; bold?: boolean; italic?: boolean }[],
  startIndex: number,
  namedStyleType = 'NORMAL_TEXT',
): TestApiPara {
  let idx = startIndex;
  const elements = runs.map((r) => {
    const el = {
      startIndex: idx,
      endIndex: idx + r.text.length,
      textRun: {
        content: r.text,
        textStyle: { ...(r.bold ? { bold: true } : {}), ...(r.italic ? { italic: true } : {}) },
      },
    };
    idx += r.text.length;
    return el;
  });
  return {
    startIndex,
    endIndex: idx + 1,
    paragraph: { elements, paragraphStyle: { namedStyleType } },
  };
}

function doc(paras: ReturnType<typeof apiPara>[]): GDocsApiDocument {
  return { body: { content: paras } } as unknown as GDocsApiDocument;
}

describe('buildFormattingFromApiDoc — only touch what changed', () => {
  it('emits nothing for a paragraph whose formatting already matches', () => {
    const apiDoc = doc([apiPara([{ text: 'attribute ' }, { text: 'Testt2', bold: true }, { text: ' schema' }], 1)]);
    const model: DocsDocument = {
      elements: [
        {
          type: 'paragraph',
          runs: [{ text: 'attribute ' }, { text: 'Testt2', bold: true }, { text: ' schema' }],
        },
      ],
    };

    expect(buildFormattingFromApiDoc(apiDoc, model)).toEqual([]);
  });

  it('still emits for the one paragraph whose formatting changed', () => {
    const apiDoc = doc([
      apiPara([{ text: 'unchanged one' }], 1),
      apiPara([{ text: 'attribute Testt2 schema' }], 20),
      apiPara([{ text: 'unchanged two' }], 50),
    ]);
    const model: DocsDocument = {
      elements: [
        { type: 'paragraph', runs: [{ text: 'unchanged one' }] },
        // Testt2 becomes bold: same text, different formatting.
        {
          type: 'paragraph',
          runs: [{ text: 'attribute ' }, { text: 'Testt2', bold: true }, { text: ' schema' }],
        },
        { type: 'paragraph', runs: [{ text: 'unchanged two' }] },
      ],
    };

    const requests = buildFormattingFromApiDoc(apiDoc, model);

    expect(requests.length).toBeGreaterThan(0);
    // Everything emitted must fall inside the paragraph that actually changed.
    for (const r of requests as { updateTextStyle?: { range: { startIndex: number } }; updateParagraphStyle?: { range: { startIndex: number } } }[]) {
      const start = r.updateTextStyle?.range.startIndex ?? r.updateParagraphStyle?.range.startIndex ?? -1;
      expect(start).toBeGreaterThanOrEqual(20);
      expect(start).toBeLessThan(50);
    }
  });

  it('emits for a heading whose level changed', () => {
    const apiDoc = doc([apiPara([{ text: 'Title' }], 1, 'HEADING_2')]);
    const model: DocsDocument = {
      elements: [{ type: 'heading', headingLevel: 1, runs: [{ text: 'Title' }] }],
    };

    expect(buildFormattingFromApiDoc(apiDoc, model).length).toBeGreaterThan(0);
  });
});
