/**
 * MathPlugin: which delimiters open math, and which dollars are money.
 */
import { MathPlugin } from '@plugins/builtin/MathPlugin';
import { MarkdownRenderer } from '@plugins/core/MarkdownRenderer';
import { BUILTIN_PLUGINS } from '@shared/constants';
import { describe, it, expect, beforeEach } from 'vitest';

describe('MathPlugin', () => {
  let renderer: MarkdownRenderer;

  beforeEach(async () => {
    renderer = new MarkdownRenderer();
    await renderer.registerPlugin(new MathPlugin());
  });

  it('has the math plugin id', () => {
    expect(new MathPlugin().metadata.id).toBe(BUILTIN_PLUGINS.MATH);
  });

  describe('inline', () => {
    it('renders $...$ with KaTeX', () => {
      const html = renderer.render('Complexity is $O(n \\log n)$ here.');
      expect(html).toContain('<span class="math-inline"><span class="katex">');
      expect(html).toContain('Complexity is ');
      expect(html).not.toContain('$O');
    });

    it('renders \\(...\\) with KaTeX', () => {
      const html = renderer.render('Let \\(x = 2\\) hold.');
      expect(html).toContain('class="math-inline"');
      expect(html).not.toContain('\\(');
    });

    it('renders inline $$...$$ and \\[...\\] in display mode', () => {
      expect(renderer.render('a $$x^2$$ b')).toContain('class="math-display"');
      expect(renderer.render('a \\[x^2\\] b')).toContain('class="math-display"');
      expect(renderer.render('a $$x^2$$ b')).toContain('katex-display');
    });

    it('leaves prices alone', () => {
      const html = renderer.render('It costs $5 and $10 today.');
      expect(html).not.toContain('katex');
      expect(html).toContain('$5 and $10');
    });

    it('needs the opening dollar followed by a non-space and the closing one preceded by a non-space', () => {
      expect(renderer.render('a $ b $ c')).not.toContain('katex');
      expect(renderer.render('a $b $ c')).not.toContain('katex');
      expect(renderer.render('a $ b$ c')).not.toContain('katex');
      expect(renderer.render('a $b$ c')).toContain('katex');
    });

    it('does not close on a dollar followed by a digit', () => {
      // "$x$5" -- the second $ is a price, so there is no math here
      const html = renderer.render('pay $x$5 now');
      expect(html).not.toContain('katex');
    });

    it('does not span lines with a single dollar', () => {
      const html = renderer.render('cost $5\nand $6');
      expect(html).not.toContain('katex');
    });

    it('keeps an escaped dollar inside the formula', () => {
      const html = renderer.render('$\\$5 + x$');
      expect(html).toContain('katex');
    });

    it('still escapes \\$ outside math', () => {
      const html = renderer.render('Pay \\$5 now');
      expect(html).toContain('Pay $5 now');
      expect(html).not.toContain('katex');
    });

    it('leaves math in code spans and fences alone', () => {
      expect(renderer.render('`$x$`')).toContain('<code>$x$</code>');
      expect(renderer.render('```\n$x$\n```')).not.toContain('katex');
    });
  });

  describe('block', () => {
    it('renders $$ on its own lines', () => {
      const html = renderer.render('Before\n\n$$\nE = mc^2\n$$\n\nAfter');
      expect(html).toContain('<div class="math-block" data-source-lines="2-5">');
      expect(html).toContain('katex-display');
      expect(html).toMatch(/<p[^>]*>After<\/p>/);
    });

    it('renders a one-line $$ … $$ block', () => {
      const html = renderer.render('$$ a + b $$');
      expect(html).toContain('class="math-block"');
      expect(html).toContain('katex-display');
    });

    it('renders \\[ … \\] on its own lines', () => {
      const html = renderer.render('\\[\n\\int_0^1 x\\,dx\n\\]');
      expect(html).toContain('class="math-block"');
    });

    it('accepts the formula starting on the opening line and ending on the closing one', () => {
      const html = renderer.render('$$ a\n+ b $$');
      expect(html).toContain('class="math-block"');
      expect(html).not.toContain('<p>');
    });

    it('leaves an unterminated $$ as text', () => {
      const html = renderer.render('$$\nnot closed');
      expect(html).not.toContain('math-block');
      expect(html).toMatch(/<p[^>]*>\$\$/);
    });

    it('does not throw on bad TeX', () => {
      const html = renderer.render('$\\frac{$');
      expect(html).toContain('katex-error');
    });

    it('works inside a list item', () => {
      const html = renderer.render('- item\n\n  $$\n  x\n  $$');
      expect(html).toContain('math-block');
    });
  });

  it('ships styles for both forms', () => {
    const styles = new MathPlugin().getStyles();
    expect(styles).toContain('.math-block');
    expect(styles).toContain('.math-inline');
  });
});
