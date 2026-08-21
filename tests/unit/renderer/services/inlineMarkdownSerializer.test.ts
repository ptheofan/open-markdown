/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { serializeInline, canSerialize } from '../../../../src/renderer/services/inlineMarkdownSerializer';
import { convertMarkdownToDocs } from '../../../../src/main/services/MarkdownToDocsConverter';

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

  it('serializes br to a markdown hard line break (two spaces + newline)', () => {
    // markdown-it has breaks:false, so a bare '\n' renders as whitespace.
    // "  \n" is the markdown hard-break syntax that round-trips back to <br>.
    expect(serializeInline(div('line one<br>line two'))).toBe('line one  \nline two');
  });

  it('serializes nested marks', () => {
    expect(serializeInline(div('<strong>bold <em>and italic</em></strong>')))
      .toBe('**bold *and italic***');
  });

  it('escapes literal markdown characters in text nodes', () => {
    expect(serializeInline(div('a literal * and _ and ` and [ and ]')))
      .toBe('a literal \\* and \\_ and \\` and \\[ and \\]');
  });

  it('leaves a lone tilde alone but escapes a doubled one', () => {
    // Only ~~ opens strikethrough. Escaping a single ~ made the Doc's
    // reverse conversion differ from the markdown that produced it, so every
    // paragraph holding one was reported as changed.
    expect(serializeInline(div('about ~11 rows'))).toBe('about ~11 rows');
    expect(serializeInline(div('not ~~struck~~ here'))).toBe('not \\~~struck\\~~ here');
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

describe('emphasis spanning trailing whitespace', () => {
  // Selecting a word by double-click takes the trailing space with it, so the
  // browser wraps "Testt2 " rather than "Testt2". Emitting that verbatim gives
  // `**Testt2 **`, whose closing delimiter is preceded by a space -- not a
  // valid CommonMark closer, so the asterisks survive into the output as text.
  it('keeps a trailing space outside bold markers', () => {
    expect(serializeInline(div('attribute <strong>Testt2 </strong>schema'))).toBe(
      'attribute **Testt2** schema'
    );
  });

  it('keeps a leading space outside bold markers', () => {
    expect(serializeInline(div('attribute<strong> Testt2</strong> schema'))).toBe(
      'attribute **Testt2** schema'
    );
  });

  it('applies the same rule to italic and strikethrough', () => {
    expect(serializeInline(div('a <em>b </em>c'))).toBe('a *b* c');
    expect(serializeInline(div('a <del>b </del>c'))).toBe('a ~~b~~ c');
  });

  it('emits no markers at all around whitespace-only emphasis', () => {
    // `** **` is not valid emphasis either; there is nothing to embolden.
    expect(serializeInline(div('a<strong> </strong>b'))).toBe('a b');
  });

  it('survives the round trip into actual bold formatting', () => {
    // The property that matters: not the intermediate markdown, but that the
    // synced document ends up with a bold run and no stray asterisks.
    const markdown = serializeInline(div('attribute <strong>Testt2 </strong>schema'));
    const runs = convertMarkdownToDocs(markdown).elements[0]?.runs ?? [];

    expect(runs.some((r) => r.text === 'Testt2' && r.bold)).toBe(true);
    expect(runs.map((r) => r.text).join('')).not.toContain('*');
  });
});
