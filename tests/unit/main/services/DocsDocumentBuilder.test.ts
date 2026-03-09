import { describe, it, expect } from 'vitest';
import { buildInsertRequests } from '@main/services/DocsDocumentBuilder';
import type { DocsDocument } from '@shared/types/google-docs';

describe('DocsDocumentBuilder', () => {
  it('should build insert requests for a simple paragraph', () => {
    const doc: DocsDocument = {
      elements: [{ type: 'paragraph', runs: [{ text: 'Hello world' }] }],
    };
    const { requests } = buildInsertRequests(doc, 1);
    const insertText = requests.find((r: any) => r.insertText);
    expect(insertText).toBeDefined();
    expect(insertText.insertText.text).toBe('Hello world\n');
    expect(insertText.insertText.location.index).toBe(1);
  });

  it('should build style requests for bold text', () => {
    const doc: DocsDocument = {
      elements: [{
        type: 'paragraph',
        runs: [
          { text: 'normal ' },
          { text: 'bold', bold: true },
          { text: ' end' },
        ],
      }],
    };
    const { requests } = buildInsertRequests(doc, 1);
    const boldStyle = requests.find((r: any) =>
      r.updateTextStyle?.textStyle?.bold === true
    );
    expect(boldStyle).toBeDefined();
    // 'normal ' is 7 chars, so bold starts at index 1+7=8
    expect(boldStyle.updateTextStyle.range.startIndex).toBe(8);
    expect(boldStyle.updateTextStyle.range.endIndex).toBe(12); // 'bold' is 4 chars
  });

  it('should build heading style requests', () => {
    const doc: DocsDocument = {
      elements: [{ type: 'heading', headingLevel: 1, runs: [{ text: 'Title' }] }],
    };
    const { requests } = buildInsertRequests(doc, 1);
    const paragraphStyle = requests.find((r: any) =>
      r.updateParagraphStyle?.paragraphStyle?.namedStyleType === 'HEADING_1'
    );
    expect(paragraphStyle).toBeDefined();
  });

  it('should build requests for h2-h6', () => {
    for (let level = 2; level <= 6; level++) {
      const doc: DocsDocument = {
        elements: [{ type: 'heading', headingLevel: level as any, runs: [{ text: 'H' }] }],
      };
      const { requests } = buildInsertRequests(doc, 1);
      const style = requests.find((r: any) =>
        r.updateParagraphStyle?.paragraphStyle?.namedStyleType === `HEADING_${level}`
      );
      expect(style).toBeDefined();
    }
  });

  it('should build requests for code blocks with monospace font', () => {
    const doc: DocsDocument = {
      elements: [{ type: 'code_block', code: 'const x = 1;\n' }],
    };
    const { requests } = buildInsertRequests(doc, 1);
    const fontStyle = requests.find((r: any) =>
      r.updateTextStyle?.textStyle?.weightedFontFamily?.fontFamily === 'Courier New'
    );
    expect(fontStyle).toBeDefined();
  });

  it('should build requests for list items', () => {
    const doc: DocsDocument = {
      elements: [
        { type: 'list_item', listOrdered: false, listDepth: 0, runs: [{ text: 'Item 1' }] },
      ],
    };
    const { requests } = buildInsertRequests(doc, 1);
    const bullets = requests.find((r: any) => r.createParagraphBullets);
    expect(bullets).toBeDefined();
  });

  it('should build requests for ordered list items', () => {
    const doc: DocsDocument = {
      elements: [
        { type: 'list_item', listOrdered: true, listDepth: 0, runs: [{ text: 'Item 1' }] },
      ],
    };
    const { requests } = buildInsertRequests(doc, 1);
    const bullets = requests.find((r: any) => r.createParagraphBullets);
    expect(bullets).toBeDefined();
    expect(bullets.createParagraphBullets.bulletPreset).toContain('NUMBERED');
  });

  it('should build requests for a table', () => {
    const doc: DocsDocument = {
      elements: [{
        type: 'table',
        rows: [
          [[{ text: 'H1' }], [{ text: 'H2' }]],
          [[{ text: 'C1' }], [{ text: 'C2' }]],
        ],
      }],
    };
    const { requests, pendingTables } = buildInsertRequests(doc, 1);

    // Tables now produce a placeholder insertText and a pendingTables entry
    const insertTexts = requests.filter((r: any) => r.insertText);
    const placeholderInsert = insertTexts.find((r: any) => r.insertText.text === '<<TABLE_0>>\n');
    expect(placeholderInsert).toBeDefined();

    // Should have exactly one pending table with the correct row data
    expect(pendingTables).toHaveLength(1);
    expect(pendingTables[0]!.placeholderText).toBe('<<TABLE_0>>\n');
    expect(pendingTables[0]!.rows).toEqual([
      [[{ text: 'H1' }], [{ text: 'H2' }]],
      [[{ text: 'C1' }], [{ text: 'C2' }]],
    ]);
  });

  it('should build requests for horizontal rule', () => {
    const doc: DocsDocument = {
      elements: [{ type: 'horizontal_rule' }],
    };
    const { requests } = buildInsertRequests(doc, 1);
    const insertText = requests.find((r: any) => r.insertText);
    expect(insertText).toBeDefined();
  });

  it('should build requests for link text', () => {
    const doc: DocsDocument = {
      elements: [{
        type: 'paragraph',
        runs: [{ text: 'Click here', link: 'https://example.com' }],
      }],
    };
    const { requests } = buildInsertRequests(doc, 1);
    const linkStyle = requests.find((r: any) =>
      r.updateTextStyle?.textStyle?.link?.url === 'https://example.com'
    );
    expect(linkStyle).toBeDefined();
  });

  it('should handle multiple elements and advance index correctly', () => {
    const doc: DocsDocument = {
      elements: [
        { type: 'paragraph', runs: [{ text: 'First' }] },  // 'First\n' = 6 chars
        { type: 'paragraph', runs: [{ text: 'Second' }] }, // starts at 1+6=7
      ],
    };
    const { requests } = buildInsertRequests(doc, 1);
    const insertTexts = requests.filter((r: any) => r.insertText);
    expect(insertTexts).toHaveLength(2);
    expect(insertTexts[0].insertText.location.index).toBe(1);
    expect(insertTexts[1].insertText.location.index).toBe(7); // 1 + 'First\n'.length
  });

  it('should build italic style requests', () => {
    const doc: DocsDocument = {
      elements: [{
        type: 'paragraph',
        runs: [{ text: 'italic', italic: true }],
      }],
    };
    const { requests } = buildInsertRequests(doc, 1);
    const italicStyle = requests.find((r: any) =>
      r.updateTextStyle?.textStyle?.italic === true
    );
    expect(italicStyle).toBeDefined();
  });

  it('should build inline code style with Courier New', () => {
    const doc: DocsDocument = {
      elements: [{
        type: 'paragraph',
        runs: [{ text: 'code', code: true }],
      }],
    };
    const { requests } = buildInsertRequests(doc, 1);
    const codeStyle = requests.find((r: any) =>
      r.updateTextStyle?.textStyle?.weightedFontFamily?.fontFamily === 'Courier New'
    );
    expect(codeStyle).toBeDefined();
  });

  it('should return empty requests for empty document', () => {
    const doc: DocsDocument = { elements: [] };
    const { requests, pendingTables } = buildInsertRequests(doc, 1);
    expect(requests).toEqual([]);
    expect(pendingTables).toEqual([]);
  });

  it('should build requests for blockquote with indentation', () => {
    const doc: DocsDocument = {
      elements: [{
        type: 'blockquote',
        children: [{ type: 'paragraph', runs: [{ text: 'Quoted' }] }],
      }],
    };
    const { requests } = buildInsertRequests(doc, 1);
    const insertText = requests.find((r: any) => r.insertText);
    expect(insertText).toBeDefined();
    expect(insertText.insertText.text).toBe('Quoted\n');
    const indentStyle = requests.find((r: any) =>
      r.updateParagraphStyle?.paragraphStyle?.indentStart
    );
    expect(indentStyle).toBeDefined();
  });

  it('should build requests for image with imageLink', () => {
    const doc: DocsDocument = {
      elements: [{
        type: 'image',
        imageLink: 'https://drive.google.com/uc?id=FILE_ID',
        imageAlt: 'test image',
      }],
    };
    const { requests } = buildInsertRequests(doc, 1);

    // Images with imageLink produce an insertInlineImage request
    const inlineImage = requests.find((r: any) => r.insertInlineImage);
    expect(inlineImage).toBeDefined();
    expect(inlineImage.insertInlineImage.uri).toBe('https://drive.google.com/uc?id=FILE_ID');
    expect(inlineImage.insertInlineImage.location.index).toBe(1);

    // Should also have an insertText for the newline after the image
    const insertText = requests.find((r: any) => r.insertText);
    expect(insertText).toBeDefined();
    expect(insertText.insertText.text).toBe('\n');
  });

  it('should skip image without imageLink', () => {
    const doc: DocsDocument = {
      elements: [{
        type: 'image',
        imageAlt: 'test image',
      }],
    };
    const { requests } = buildInsertRequests(doc, 1);

    // Images without imageLink are skipped entirely (buildImage returns early)
    expect(requests).toEqual([]);
  });

  it('should build strikethrough style requests', () => {
    const doc: DocsDocument = {
      elements: [{
        type: 'paragraph',
        runs: [{ text: 'deleted', strikethrough: true }],
      }],
    };
    const { requests } = buildInsertRequests(doc, 1);
    const strikethroughStyle = requests.find((r: any) =>
      r.updateTextStyle?.textStyle?.strikethrough === true
    );
    expect(strikethroughStyle).toBeDefined();
  });

  it('should apply indentation for nested list items', () => {
    const doc: DocsDocument = {
      elements: [
        { type: 'list_item', listOrdered: false, listDepth: 1, runs: [{ text: 'Nested' }] },
      ],
    };
    const { requests } = buildInsertRequests(doc, 1);
    const indentStyle = requests.find((r: any) =>
      r.updateParagraphStyle?.paragraphStyle?.indentStart
    );
    expect(indentStyle).toBeDefined();
    expect(indentStyle.updateParagraphStyle.paragraphStyle.indentStart.magnitude).toBe(36);
  });

  it('should handle paragraph with no runs', () => {
    const doc: DocsDocument = {
      elements: [{ type: 'paragraph' }],
    };
    const { requests } = buildInsertRequests(doc, 1);
    const insertText = requests.find((r: any) => r.insertText);
    expect(insertText).toBeDefined();
    expect(insertText.insertText.text).toBe('\n');
  });

  it('should use custom startIndex', () => {
    const doc: DocsDocument = {
      elements: [{ type: 'paragraph', runs: [{ text: 'Hello' }] }],
    };
    const { requests } = buildInsertRequests(doc, 10);
    const insertText = requests.find((r: any) => r.insertText);
    expect(insertText.insertText.location.index).toBe(10);
  });
});
