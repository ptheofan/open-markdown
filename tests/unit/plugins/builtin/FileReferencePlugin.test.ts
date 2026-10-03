/**
 * FileReferencePlugin: paths in code spans and prose become anchors.
 */
import { FileReferencePlugin } from '@plugins/builtin/FileReferencePlugin';
import { GithubFlavoredPlugin } from '@plugins/builtin/GithubFlavoredPlugin';
import { MarkdownRenderer } from '@plugins/core/MarkdownRenderer';
import { describe, it, expect, beforeEach } from 'vitest';

describe('FileReferencePlugin', () => {
  let renderer: MarkdownRenderer;

  beforeEach(async () => {
    renderer = new MarkdownRenderer();
    await renderer.registerPlugin(new GithubFlavoredPlugin());
    await renderer.registerPlugin(new FileReferencePlugin());
  });

  it('links a code span that is a path, carrying line and column', () => {
    const html = renderer.render('Fix `src/foo.ts:42:7` please.');
    expect(html).toContain(
      '<a href="#" class="file-ref" data-file-ref="src/foo.ts" data-file-line="42" data-file-column="7"><code>src/foo.ts:42:7</code></a>'
    );
  });

  it('links a bare file name in a code span but not in prose', () => {
    expect(renderer.render('See `README.md`.')).toContain('data-file-ref="README.md"');
    expect(renderer.render('See README.md.')).not.toContain('file-ref');
  });

  it('links paths in prose, splitting the text around them', () => {
    const html = renderer.render('Edit src/a.ts:3 and docs/b.md now.');
    expect(html).toContain('Edit <a href="#" class="file-ref" data-file-ref="src/a.ts" data-file-line="3">src/a.ts:3</a> and ');
    expect(html).toContain('<a href="#" class="file-ref" data-file-ref="docs/b.md">docs/b.md</a> now.');
  });

  it('leaves code spans that are not paths alone', () => {
    const html = renderer.render('Call `array.map` or `foo()`.');
    expect(html).not.toContain('file-ref');
  });

  it('does not touch text already inside a link, or URLs', () => {
    expect(renderer.render('[src/a.ts](https://example.com/src/a.ts)')).not.toContain('file-ref');
    expect(renderer.render('https://example.com/src/a.ts')).not.toContain('file-ref');
  });

  it('does not touch fenced code', () => {
    expect(renderer.render('```\nsrc/a.ts:3\n```')).not.toContain('file-ref');
  });

  it('works inside list items and headings', () => {
    const html = renderer.render('- see `src/a.ts`\n\n## In src/b.ts:9');
    expect(html.match(/class="file-ref"/g)?.length).toBe(2);
  });

  it('styles unresolved references as plain text', () => {
    expect(new FileReferencePlugin().getStyles()).toContain('.file-ref-unresolved');
  });
});
