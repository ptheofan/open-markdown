import { describe, it, expect } from 'vitest';
import { convertMarkdownToDocs } from '@main/services/MarkdownToDocsConverter';

describe('MarkdownToDocsConverter', () => {
  it('should convert a plain paragraph', () => {
    const doc = convertMarkdownToDocs('Hello world');
    expect(doc.elements).toHaveLength(1);
    expect(doc.elements[0]!.type).toBe('paragraph');
    expect(doc.elements[0]!.runs).toEqual([{ text: 'Hello world' }]);
  });

  it('should convert headings', () => {
    const doc = convertMarkdownToDocs('# Title\n\n## Subtitle');
    expect(doc.elements).toHaveLength(2);
    expect(doc.elements[0]!.type).toBe('heading');
    expect(doc.elements[0]!.headingLevel).toBe(1);
    expect(doc.elements[0]!.runs).toEqual([{ text: 'Title' }]);
    expect(doc.elements[1]!.type).toBe('heading');
    expect(doc.elements[1]!.headingLevel).toBe(2);
  });

  it('should convert bold text', () => {
    const doc = convertMarkdownToDocs('Hello **bold** text');
    const runs = doc.elements[0]!.runs!;
    expect(runs).toHaveLength(3);
    expect(runs[0]).toEqual({ text: 'Hello ' });
    expect(runs[1]).toEqual({ text: 'bold', bold: true });
    expect(runs[2]).toEqual({ text: ' text' });
  });

  it('should convert italic text', () => {
    const doc = convertMarkdownToDocs('Hello *italic* text');
    const runs = doc.elements[0]!.runs!;
    expect(runs[1]).toEqual({ text: 'italic', italic: true });
  });

  it('should convert bold italic text', () => {
    const doc = convertMarkdownToDocs('Hello ***bold italic*** text');
    const runs = doc.elements[0]!.runs!;
    expect(runs[1]).toEqual({ text: 'bold italic', bold: true, italic: true });
  });

  it('should convert links', () => {
    const doc = convertMarkdownToDocs('[Click here](https://example.com)');
    const runs = doc.elements[0]!.runs!;
    expect(runs[0]).toEqual({ text: 'Click here', link: 'https://example.com' });
  });

  it('should convert inline code', () => {
    const doc = convertMarkdownToDocs('Use `console.log()` here');
    const runs = doc.elements[0]!.runs!;
    expect(runs).toHaveLength(3);
    expect(runs[1]).toEqual({ text: 'console.log()', code: true });
  });

  it('should convert code blocks', () => {
    const doc = convertMarkdownToDocs('```js\nconst x = 1;\n```');
    expect(doc.elements[0]!.type).toBe('code_block');
    expect(doc.elements[0]!.code).toBe('const x = 1;\n');
    expect(doc.elements[0]!.language).toBe('js');
  });

  it('should convert code blocks without language', () => {
    const doc = convertMarkdownToDocs('```\nhello\n```');
    expect(doc.elements[0]!.type).toBe('code_block');
    expect(doc.elements[0]!.language).toBeUndefined();
  });

  it('should convert unordered lists', () => {
    const doc = convertMarkdownToDocs('- Item 1\n- Item 2');
    const items = doc.elements.filter(e => e.type === 'list_item');
    expect(items).toHaveLength(2);
    expect(items[0]!.listOrdered).toBe(false);
    expect(items[0]!.listDepth).toBe(0);
    expect(items[0]!.runs).toEqual([{ text: 'Item 1' }]);
  });

  it('should convert ordered lists', () => {
    const doc = convertMarkdownToDocs('1. First\n2. Second');
    const items = doc.elements.filter(e => e.type === 'list_item');
    expect(items).toHaveLength(2);
    expect(items[0]!.listOrdered).toBe(true);
  });

  it('should convert nested lists', () => {
    const doc = convertMarkdownToDocs('- Parent\n  - Child');
    const items = doc.elements.filter(e => e.type === 'list_item');
    expect(items).toHaveLength(2);
    expect(items[0]!.listDepth).toBe(0);
    expect(items[1]!.listDepth).toBe(1);
  });

  it('should convert tables', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |';
    const doc = convertMarkdownToDocs(md);
    const table = doc.elements.find(e => e.type === 'table');
    expect(table).toBeDefined();
    expect(table!.rows).toHaveLength(2); // header + 1 data row
    expect(table!.rows![0]).toHaveLength(2); // 2 columns
    expect(table!.rows![0]![0]).toEqual([{ text: 'A' }]);
    expect(table!.rows![1]![0]).toEqual([{ text: '1' }]);
  });

  it('should convert horizontal rules', () => {
    const doc = convertMarkdownToDocs('---');
    expect(doc.elements[0]!.type).toBe('horizontal_rule');
  });

  it('should convert blockquotes', () => {
    const doc = convertMarkdownToDocs('> Quoted text');
    expect(doc.elements[0]!.type).toBe('blockquote');
    expect(doc.elements[0]!.children).toBeDefined();
    expect(doc.elements[0]!.children![0]!.type).toBe('paragraph');
    expect(doc.elements[0]!.children![0]!.runs).toEqual([{ text: 'Quoted text' }]);
  });

  it('should detect mermaid code blocks as images', () => {
    const doc = convertMarkdownToDocs('```mermaid\ngraph LR\n  A --> B\n```');
    expect(doc.elements[0]!.type).toBe('image');
    expect(doc.elements[0]!.imageAlt).toBe('Mermaid diagram');
    expect(doc.elements[0]!.code).toBe('graph LR\n  A --> B');
  });

  it('should convert strikethrough text', () => {
    const doc = convertMarkdownToDocs('~~deleted~~ text');
    const runs = doc.elements[0]!.runs!;
    expect(runs[0]).toEqual({ text: 'deleted', strikethrough: true });
  });

  it('should handle multiple paragraphs', () => {
    const doc = convertMarkdownToDocs('First paragraph\n\nSecond paragraph');
    expect(doc.elements).toHaveLength(2);
    expect(doc.elements[0]!.runs).toEqual([{ text: 'First paragraph' }]);
    expect(doc.elements[1]!.runs).toEqual([{ text: 'Second paragraph' }]);
  });

  it('should convert link with formatted text', () => {
    const doc = convertMarkdownToDocs('[**bold link**](https://example.com)');
    const runs = doc.elements[0]!.runs!;
    expect(runs[0]).toEqual({ text: 'bold link', bold: true, link: 'https://example.com' });
  });
});
