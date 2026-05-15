/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { serializeInline } from '../../../../src/renderer/services/inlineMarkdownSerializer';

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
