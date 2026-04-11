/**
 * Tests for paragraph-level diff with actual API indices.
 *
 * Validates that generateParagraphDiffOperations produces correct
 * Google Docs API operations using real API paragraph indices,
 * NOT flat-text offsets.
 */
import { describe, it, expect } from 'vitest';
import { generateParagraphDiffOperations } from '@main/services/GoogleDocsSyncService';
import type { ApiParagraph } from '@main/services/DocsDocumentBuilder';
import type { DocsElement } from '@shared/types/google-docs';

/** Typed view of the Google Docs batch update requests this function emits */
interface TestDocsRequest {
  deleteContentRange?: {
    range: { startIndex: number; endIndex: number };
  };
  insertText?: {
    text: string;
    location: { index: number };
  };
}


function makePara(text: string, startIndex: number): ApiParagraph {
  return {
    text: text + '\n',
    startIndex,
    endIndex: startIndex + text.length + 1,
    textStartIndex: startIndex,
  };
}

function makeElem(type: DocsElement['type'], text: string, extra?: Partial<DocsElement>): DocsElement {
  if (type === 'code_block') {
    return { type, code: text, ...extra };
  }
  if (type === 'horizontal_rule') {
    return { type, ...extra };
  }
  return { type, runs: [{ text }], ...extra };
}

describe('generateParagraphDiffOperations', () => {
  it('should produce no operations when paragraphs are identical', () => {
    const apiParas: ApiParagraph[] = [
      makePara('Hello', 1),
      makePara('World', 7),
    ];
    const modelElements: DocsElement[] = [
      makeElem('paragraph', 'Hello'),
      makeElem('paragraph', 'World'),
    ];

    const ops = generateParagraphDiffOperations(apiParas, modelElements) as TestDocsRequest[];
    expect(ops).toEqual([]);
  });

  it('should ONLY touch the changed paragraph, leaving unchanged ones intact (comment preservation)', () => {
    // This is the core guarantee: unchanged paragraphs must generate ZERO
    // operations so Google Docs comment anchors on them are preserved.
    const apiParas: ApiParagraph[] = [
      makePara('Keep this with comments', 1),   // indices 1-25
      makePara('Change me', 25),                 // indices 25-35
      makePara('Also keep with comments', 35),   // indices 35-58
    ];
    const modelElements: DocsElement[] = [
      makeElem('paragraph', 'Keep this with comments'),   // identical
      makeElem('paragraph', 'Changed to new text'),       // modified
      makeElem('paragraph', 'Also keep with comments'),   // identical
    ];

    const ops = generateParagraphDiffOperations(apiParas, modelElements) as TestDocsRequest[];

    // Should have operations (the middle paragraph changed)
    expect(ops.length).toBeGreaterThan(0);

    // ALL operations must target indices within [25, 35) — the changed paragraph
    // NO operation may touch [1, 25) or [35, 58) — the unchanged paragraphs
    for (const op of ops) {
      const idx = op.deleteContentRange?.range?.startIndex
        ?? op.insertText?.location?.index;
      expect(idx).toBeGreaterThanOrEqual(25);
      expect(idx).toBeLessThan(35);
    }
  });

  it('should use character-level diff for 1:1 paragraph modification', () => {
    // "Hello world" at indices 1-13 in the API doc
    const apiParas: ApiParagraph[] = [
      makePara('Hello world', 1),
    ];
    const modelElements: DocsElement[] = [
      makeElem('paragraph', 'Hello universe'),
    ];

    const ops = generateParagraphDiffOperations(apiParas, modelElements) as TestDocsRequest[];

    // Should use character-level diff (NOT delete entire paragraph + re-insert)
    const deletes = ops.filter((r) => r.deleteContentRange);
    const inserts = ops.filter((r) => r.insertText);

    expect(deletes.length).toBeGreaterThan(0);
    expect(inserts.length).toBeGreaterThan(0);

    // All operations must target actual API indices within the paragraph [1, 12]
    for (const op of deletes) {
      expect(op.deleteContentRange!.range.startIndex).toBeGreaterThanOrEqual(1);
      expect(op.deleteContentRange!.range.endIndex).toBeLessThanOrEqual(12);
    }
    for (const op of inserts) {
      expect(op.insertText!.location.index).toBeGreaterThanOrEqual(1);
      expect(op.insertText!.location.index).toBeLessThanOrEqual(12);
    }

    // The "Hello " prefix should NOT be deleted (comment preservation)
    const deletesStartingAt1 = deletes.filter((r) =>
      r.deleteContentRange?.range.startIndex === 1
    );
    expect(deletesStartingAt1.length).toBe(0);
  });

  it('should use actual API indices even when paragraphs are after a table', () => {
    // Simulate a doc with: Paragraph(1-10), Table(10-50), Paragraph(50-60)
    // extractApiParagraphs skips tables, so we only see the two paragraphs
    const apiParas: ApiParagraph[] = [
      makePara('Before', 1),   // indices 1-8
      makePara('After', 50),   // indices 50-56 (after table)
    ];
    const modelElements: DocsElement[] = [
      makeElem('paragraph', 'Before'),
      makeElem('paragraph', 'After changed'),
    ];

    const ops = generateParagraphDiffOperations(apiParas, modelElements) as TestDocsRequest[];

    // Should produce character-level diff for "After" → "After changed"
    // using actual API index 50, NOT flat-text index 8
    const inserts = ops.filter((r) => r.insertText);
    expect(inserts.length).toBeGreaterThan(0);

    // All insert operations should reference indices >= 50
    for (const op of inserts) {
      expect(op.insertText!.location.index).toBeGreaterThanOrEqual(50);
    }
  });

  it('should handle paragraph deletion', () => {
    const apiParas: ApiParagraph[] = [
      makePara('Keep', 1),
      makePara('Delete me', 6),
      makePara('Also keep', 16),
    ];
    const modelElements: DocsElement[] = [
      makeElem('paragraph', 'Keep'),
      makeElem('paragraph', 'Also keep'),
    ];

    const ops = generateParagraphDiffOperations(apiParas, modelElements) as TestDocsRequest[];

    const deletes = ops.filter((r) => r.deleteContentRange);
    expect(deletes.length).toBe(1);
    expect(deletes[0]!.deleteContentRange!.range.startIndex).toBe(6);
    expect(deletes[0]!.deleteContentRange!.range.endIndex).toBe(16);
  });

  it('should handle paragraph addition', () => {
    const apiParas: ApiParagraph[] = [
      makePara('First', 1),
      makePara('Third', 7),
    ];
    const modelElements: DocsElement[] = [
      makeElem('paragraph', 'First'),
      makeElem('paragraph', 'Second'),
      makeElem('paragraph', 'Third'),
    ];

    const ops = generateParagraphDiffOperations(apiParas, modelElements) as TestDocsRequest[];

    const inserts = ops.filter((r) => r.insertText);
    expect(inserts.length).toBe(1);
    // Should insert "Second\n" at index 7 (end of "First\n")
    expect(inserts[0]!.insertText!.text).toBe('Second\n');
    expect(inserts[0]!.insertText!.location.index).toBe(7);
  });

  it('should handle N:M replacement (multiple paragraphs changed)', () => {
    const apiParas: ApiParagraph[] = [
      makePara('Keep', 1),
      makePara('Old A', 6),
      makePara('Old B', 12),
      makePara('Keep end', 18),
    ];
    const modelElements: DocsElement[] = [
      makeElem('paragraph', 'Keep'),
      makeElem('paragraph', 'New X'),
      makeElem('paragraph', 'New Y'),
      makeElem('paragraph', 'New Z'),
      makeElem('paragraph', 'Keep end'),
    ];

    const ops = generateParagraphDiffOperations(apiParas, modelElements) as TestDocsRequest[];

    // Should delete old A + old B range and insert new X + Y + Z
    const deletes = ops.filter((r) => r.deleteContentRange);
    const inserts = ops.filter((r) => r.insertText);
    expect(deletes.length).toBeGreaterThan(0);
    expect(inserts.length).toBeGreaterThan(0);
  });

  it('should handle empty document (no API paragraphs)', () => {
    const apiParas: ApiParagraph[] = [];
    const modelElements: DocsElement[] = [
      makeElem('paragraph', 'New content'),
    ];

    const ops = generateParagraphDiffOperations(apiParas, modelElements) as TestDocsRequest[];

    const inserts = ops.filter((r) => r.insertText);
    expect(inserts.length).toBe(1);
    expect(inserts[0]!.insertText!.text).toBe('New content\n');
    expect(inserts[0]!.insertText!.location.index).toBe(1);
  });

  it('should handle complete document replacement', () => {
    const apiParas: ApiParagraph[] = [
      makePara('Old content', 1),
    ];
    const modelElements: DocsElement[] = [
      makeElem('paragraph', 'Completely new'),
    ];

    const ops = generateParagraphDiffOperations(apiParas, modelElements) as TestDocsRequest[];

    // Should use character-level diff (1:1 modification)
    const deletes = ops.filter((r) => r.deleteContentRange);
    const inserts = ops.filter((r) => r.insertText);
    expect(deletes.length + inserts.length).toBeGreaterThan(0);
  });

  it('should handle code_block elements correctly', () => {
    const apiParas: ApiParagraph[] = [
      makePara('const x = 1;', 1),
    ];
    const modelElements: DocsElement[] = [
      makeElem('code_block', 'const x = 2;'),
    ];

    const ops = generateParagraphDiffOperations(apiParas, modelElements) as TestDocsRequest[];

    // Should produce character-level diff for the code change
    expect(ops.length).toBeGreaterThan(0);
  });

  it('should produce operations in reverse order for index stability', () => {
    const apiParas: ApiParagraph[] = [
      makePara('First', 1),
      makePara('Second', 7),
      makePara('Third', 14),
    ];
    const modelElements: DocsElement[] = [
      makeElem('paragraph', 'First changed'),
      makeElem('paragraph', 'Second changed'),
      makeElem('paragraph', 'Third changed'),
    ];

    const ops = generateParagraphDiffOperations(apiParas, modelElements) as TestDocsRequest[];

    // Operations should be in reverse order (highest indices first)
    // so earlier operations don't invalidate later ones
    let lastIdx = Infinity;
    for (const op of ops) {
      const idx = op.deleteContentRange?.range?.startIndex
        ?? op.insertText?.location?.index
        ?? 0;
      expect(idx).toBeLessThanOrEqual(lastIdx);
      lastIdx = idx;
    }
  });
});
