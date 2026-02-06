import MarkdownIt from 'markdown-it';
import { applySourceMapRule } from '@plugins/core/SourceMapRule';
import { describe, it, expect, beforeEach } from 'vitest';

describe('SourceMapRule', () => {
  let md: MarkdownIt;

  beforeEach(() => {
    md = new MarkdownIt({ html: true });
    applySourceMapRule(md);
  });

  it('should add data-source-lines to headings', () => {
    const result = md.render('# Hello');
    expect(result).toContain('data-source-lines="0-1"');
    expect(result).toContain('<h1');
  });

  it('should add data-source-lines to paragraphs', () => {
    const result = md.render('Hello world');
    expect(result).toContain('data-source-lines="0-1"');
    expect(result).toContain('<p');
  });

  it('should add data-source-lines to code blocks', () => {
    const result = md.render('```\ncode\n```');
    expect(result).toContain('data-source-lines=');
    expect(result).toContain('<pre');
  });

  it('should add data-source-lines to blockquotes', () => {
    const result = md.render('> quote');
    expect(result).toContain('data-source-lines="0-1"');
    expect(result).toContain('<blockquote');
  });

  it('should add data-source-lines to lists', () => {
    const result = md.render('- item 1\n- item 2');
    expect(result).toContain('data-source-lines=');
    expect(result).toContain('<ul');
  });

  it('should track correct line ranges for multi-line blocks', () => {
    const result = md.render('# Title\n\nParagraph text\n\n## Subtitle');
    expect(result).toContain('data-source-lines="0-1"');
    expect(result).toContain('data-source-lines="2-3"');
    expect(result).toContain('data-source-lines="4-5"');
  });

  it('should not add data-source-lines to inline elements', () => {
    const result = md.render('Hello **bold** world');
    const strongMatch = result.match(/<strong[^>]*>/);
    expect(strongMatch?.[0]).not.toContain('data-source-lines');
  });

  it('should handle empty input', () => {
    const result = md.render('');
    expect(result).toBe('');
  });
});
