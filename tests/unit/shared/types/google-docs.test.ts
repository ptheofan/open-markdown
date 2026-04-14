import { describe, it, expect } from 'vitest';
import type { GoogleDocLink, DocsElement, DocsDocument } from '@shared/types/google-docs';

describe('Google Docs types', () => {
  it('should create a valid GoogleDocLink', () => {
    const link: GoogleDocLink = {
      docId: '1aBcDeFg',
      lastSyncedAt: '2026-03-09T14:30:00Z',
    };
    expect(link.docId).toBe('1aBcDeFg');
  });

  it('should create a valid DocsElement paragraph with runs', () => {
    const el: DocsElement = {
      type: 'paragraph',
      runs: [
        { text: 'Hello ' },
        { text: 'bold', bold: true },
        { text: ' world' },
      ],
    };
    expect(el.runs).toHaveLength(3);
    expect(el.runs?.[1]?.bold).toBe(true);
  });

  it('should create a valid heading element', () => {
    const el: DocsElement = {
      type: 'heading',
      headingLevel: 2,
      runs: [{ text: 'Section Title' }],
    };
    expect(el.headingLevel).toBe(2);
  });

  it('should create a valid DocsDocument', () => {
    const doc: DocsDocument = {
      elements: [
        { type: 'heading', headingLevel: 1, runs: [{ text: 'Title' }] },
        { type: 'paragraph', runs: [{ text: 'Content' }] },
      ],
    };
    expect(doc.elements).toHaveLength(2);
  });
});
