/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { serializeInline, canSerialize } from '../../../../src/renderer/services/inlineMarkdownSerializer';

function div(html: string): HTMLElement {
  const el = document.createElement('div');
  el.insertAdjacentHTML('afterbegin', html);
  return el;
}

describe('serializeInline — text and flat marks', () => {
  it('returns plain text unchanged', () => {
    expect(serializeInline(div('Scala 2.13 is supported.'))).toBe('Scala 2.13 is supported.');
  });

  it('serializes strong and b to **', () => {
    expect(serializeInline(div('a <strong>bold</strong> b'))).toBe('a **bold** b');
    expect(serializeInline(div('a <b>bold</b> b'))).toBe('a **bold** b');
  });

  it('serializes em and i to *', () => {
    expect(serializeInline(div('a <em>it</em> b'))).toBe('a *it* b');
    expect(serializeInline(div('a <i>it</i> b'))).toBe('a *it* b');
  });

  it('serializes del and s to ~~', () => {
    expect(serializeInline(div('a <del>x</del> b'))).toBe('a ~~x~~ b');
    expect(serializeInline(div('a <s>x</s> b'))).toBe('a ~~x~~ b');
  });

  it('serializes code to backticks using raw text content', () => {
    expect(serializeInline(div('use <code>npm i</code> now'))).toBe('use `npm i` now');
  });
});

describe('serializeInline — links, breaks, nesting, escaping', () => {
  it('serializes anchors to [text](href)', () => {
    expect(serializeInline(div('see <a href="https://x.com">the site</a>')))
      .toBe('see [the site](https://x.com)');
  });

  it('serializes br to a newline', () => {
    expect(serializeInline(div('line one<br>line two'))).toBe('line one\nline two');
  });

  it('serializes nested marks', () => {
    expect(serializeInline(div('<strong>bold <em>and italic</em></strong>')))
      .toBe('**bold *and italic***');
  });

  it('escapes literal markdown characters in text nodes', () => {
    expect(serializeInline(div('a literal * and _ and ` and ~ and [ and ]')))
      .toBe('a literal \\* and \\_ and \\` and \\~ and \\[ and \\]');
  });

  it('does not escape inside inline code', () => {
    expect(serializeInline(div('<code>a * b</code>'))).toBe('`a * b`');
  });

  it('round-trips: emphasis text survives markdown -> render -> serialize', () => {
    // markdown-it would render "**only**" as <strong>only</strong>; serializing
    // returns the original syntax.
    expect(serializeInline(div('the <strong>only</strong> version')))
      .toBe('the **only** version');
  });
});

describe('canSerialize', () => {
  it('accepts content with only supported inline tags', () => {
    expect(canSerialize(div('a <strong>b <em>c</em></strong> <a href="x">d</a>'))).toBe(true);
    expect(canSerialize(div('plain text'))).toBe(true);
    expect(canSerialize(div('line<br>break'))).toBe(true);
  });

  it('rejects content with an inline image', () => {
    expect(canSerialize(div('text <img src="x.png"> more'))).toBe(false);
  });

  it('rejects content with unsupported elements', () => {
    expect(canSerialize(div('text <sup>2</sup>'))).toBe(false);
    expect(canSerialize(div('text <span style="color:red">x</span>'))).toBe(false);
  });
});
