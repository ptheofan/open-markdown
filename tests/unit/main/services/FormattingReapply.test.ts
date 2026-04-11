/**
 * Tests for buildFormattingFromApiDoc with lookahead recovery,
 * and for edge cases in structural element extraction.
 */
import { describe, it, expect } from 'vitest';
import { buildFormattingFromApiDoc } from '@main/services/DocsDocumentBuilder';
import type { DocsDocument } from '@shared/types/google-docs';

/* eslint-disable @typescript-eslint/no-explicit-any */

function makeApiDoc(content: any[]): any {
  return { body: { content } };
}

function makePara(text: string, startIndex: number) {
  const endIndex = startIndex + text.length + 1;
  return {
    paragraph: {
      elements: [{ textRun: { content: text + '\n' }, startIndex }],
    },
    startIndex,
    endIndex,
  };
}

describe('buildFormattingFromApiDoc', () => {
  describe('lookahead recovery', () => {
    it('should skip structural gap paragraphs (table cells) and match correctly', () => {
      const apiDoc = makeApiDoc([
        makePara('Title', 1),
        // Simulate table cell paragraphs that appear in the API
        makePara('Cell A', 7),
        makePara('Cell B', 14),
        makePara('After table', 21),
      ]);
      const docsDoc: DocsDocument = {
        elements: [
          { type: 'heading', headingLevel: 1, runs: [{ text: 'Title' }] },
          // Table is skipped by flattenElements
          { type: 'paragraph', runs: [{ text: 'After table' }] },
        ],
      };

      const reqs = buildFormattingFromApiDoc(apiDoc, docsDoc);

      // Should format "Title" at index 1 as TITLE
      const titleReq = reqs.find((r: any) =>
        r.updateParagraphStyle?.paragraphStyle?.namedStyleType === 'TITLE' &&
        r.updateParagraphStyle?.range?.startIndex === 1
      );
      expect(titleReq).toBeDefined();

      // Should format "After table" at index 21 as NORMAL_TEXT (not at cell indices)
      const afterReq = reqs.find((r: any) =>
        r.updateParagraphStyle?.paragraphStyle?.namedStyleType === 'NORMAL_TEXT' &&
        r.updateParagraphStyle?.range?.startIndex === 21
      );
      expect(afterReq).toBeDefined();
    });

    it('should skip model element when lookahead window is exceeded', () => {
      // Create 15 unrelated API paragraphs — exceeds LOOKAHEAD_WINDOW of 10
      const content = Array.from({ length: 15 }, (_, i) =>
        makePara(`Unrelated ${i}`, i * 20 + 1)
      );
      const apiDoc = makeApiDoc(content);
      const docsDoc: DocsDocument = {
        elements: [
          { type: 'paragraph', runs: [{ text: 'Not in API at all' }] },
        ],
      };

      const reqs = buildFormattingFromApiDoc(apiDoc, docsDoc);

      // No match found → no formatting applied
      // (Only foreground color resets and paragraph style would exist if matched)
      const paraStyles = reqs.filter((r: any) =>
        r.updateParagraphStyle?.paragraphStyle?.namedStyleType === 'NORMAL_TEXT'
      );
      expect(paraStyles.length).toBe(0);
    });

    it('should apply blockquote indentation via child index tracking', () => {
      const apiDoc = makeApiDoc([
        makePara('Quoted text', 1),
      ]);
      const docsDoc: DocsDocument = {
        elements: [
          {
            type: 'blockquote',
            children: [
              { type: 'paragraph', runs: [{ text: 'Quoted text' }] },
            ],
          },
        ],
      };

      const reqs = buildFormattingFromApiDoc(apiDoc, docsDoc);

      const indentReq = reqs.find((r: any) =>
        r.updateParagraphStyle?.paragraphStyle?.indentStart?.magnitude === 36
      );
      expect(indentReq).toBeDefined();
      expect(indentReq.updateParagraphStyle.range.startIndex).toBe(1);
    });

    it('should handle all heading levels with correct named styles', () => {
      const content = [];
      const docsElements = [];
      for (let level = 1; level <= 6; level++) {
        const text = `Heading ${level}`;
        content.push(makePara(text, (level - 1) * 15 + 1));
        docsElements.push({
          type: 'heading' as const,
          headingLevel: level as 1 | 2 | 3 | 4 | 5 | 6,
          runs: [{ text }],
        });
      }
      const apiDoc = makeApiDoc(content);
      const docsDoc: DocsDocument = { elements: docsElements };

      const reqs = buildFormattingFromApiDoc(apiDoc, docsDoc);

      const styles = reqs
        .filter((r: any) => r.updateParagraphStyle?.paragraphStyle?.namedStyleType)
        .map((r: any) => r.updateParagraphStyle.paragraphStyle.namedStyleType);

      expect(styles).toContain('TITLE');
      expect(styles).toContain('HEADING_1');
      expect(styles).toContain('HEADING_2');
      expect(styles).toContain('HEADING_3');
      expect(styles).toContain('HEADING_4');
      expect(styles).toContain('HEADING_5');
    });

    it('should handle empty model document', () => {
      const apiDoc = makeApiDoc([makePara('Some text', 1)]);
      const docsDoc: DocsDocument = { elements: [] };

      const reqs = buildFormattingFromApiDoc(apiDoc, docsDoc);
      expect(reqs).toEqual([]);
    });

    it('should handle empty API document', () => {
      const apiDoc = makeApiDoc([]);
      const docsDoc: DocsDocument = {
        elements: [{ type: 'paragraph', runs: [{ text: 'Hello' }] }],
      };

      const reqs = buildFormattingFromApiDoc(apiDoc, docsDoc);
      expect(reqs).toEqual([]);
    });

    it('should apply list bullets with correct depth', () => {
      const apiDoc = makeApiDoc([
        makePara('Item 1', 1),
        makePara('Nested', 8),
      ]);
      const docsDoc: DocsDocument = {
        elements: [
          { type: 'list_item', listOrdered: false, listDepth: 0, runs: [{ text: 'Item 1' }] },
          { type: 'list_item', listOrdered: false, listDepth: 1, runs: [{ text: 'Nested' }] },
        ],
      };

      const reqs = buildFormattingFromApiDoc(apiDoc, docsDoc);

      const bullets = reqs.filter((r: any) => r.createParagraphBullets);
      expect(bullets.length).toBe(2);

      const indent = reqs.find((r: any) =>
        r.updateParagraphStyle?.paragraphStyle?.indentStart?.magnitude === 36
      );
      expect(indent).toBeDefined();
      expect(indent.updateParagraphStyle.range.startIndex).toBe(8);
    });

    it('should apply inline text formatting using correct API indices', () => {
      const apiDoc = makeApiDoc([
        makePara('Hello bold world', 1),
      ]);
      const docsDoc: DocsDocument = {
        elements: [{
          type: 'paragraph',
          runs: [
            { text: 'Hello ' },
            { text: 'bold', bold: true },
            { text: ' world' },
          ],
        }],
      };

      const reqs = buildFormattingFromApiDoc(apiDoc, docsDoc);

      const boldReq = reqs.find((r: any) =>
        r.updateTextStyle?.textStyle?.bold === true
      );
      expect(boldReq).toBeDefined();
      // "bold" starts at index 1 + 6 = 7, ends at 7 + 4 = 11
      expect(boldReq.updateTextStyle.range.startIndex).toBe(7);
      expect(boldReq.updateTextStyle.range.endIndex).toBe(11);
    });
  });
});
