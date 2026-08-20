/**
 * Tests for code-block rendering in synced Google Docs.
 *
 * Google Docs code blocks are a building block — an editor-only feature with
 * no API request behind it and no language field. The sync approximates one:
 * a shaded NORMAL_TEXT paragraph, monospace text, and syntax colours computed
 * locally with highlight.js.
 *
 * The subtle part is the reapply pass. A code block is a single model element
 * but becomes one API paragraph per line, so matching it against a single
 * paragraph's text always fails — which used to leave multi-line blocks
 * unformatted whenever their contents changed.
 */
import { describe, it, expect } from 'vitest';
import { highlightCode, isSupportedLanguage } from '@main/services/CodeHighlighter';
import {
  buildCodeBlockStyleRequests,
  buildFormattingFromApiDoc,
  buildInsertRequests,
  CODE_FONT_FAMILY,
} from '@main/services/DocsDocumentBuilder';
import { convertMarkdownToDocs } from '@main/services/MarkdownToDocsConverter';
import type { DocsBatchUpdateRequest } from '@main/services/GoogleDocsService';
import type {
  DocsDocument,
  GDocsApiDocument,
  GDocsStructuralElement,
} from '@shared/types/google-docs';

type ParaStyle = Extract<DocsBatchUpdateRequest, { updateParagraphStyle: unknown }>;
type TextStyle = Extract<DocsBatchUpdateRequest, { updateTextStyle: unknown }>;

const isPara = (r: DocsBatchUpdateRequest): r is ParaStyle => 'updateParagraphStyle' in r;
const isText = (r: DocsBatchUpdateRequest): r is TextStyle => 'updateTextStyle' in r;

function makePara(text: string, startIndex: number): GDocsStructuralElement {
  return {
    paragraph: { elements: [{ textRun: { content: text + '\n' }, startIndex }] },
    startIndex,
    endIndex: startIndex + text.length + 1,
  };
}

describe('highlightCode', () => {
  it('reproduces the source exactly, entities and all', () => {
    const code = 'const s = "a & b < c";\n// <tag>\n';
    const spans = highlightCode(code, 'typescript');

    expect(spans.map((s) => s.text).join('')).toBe(code);
  });

  it('colours tokens but not every span', () => {
    const spans = highlightCode('const x = 42; // note', 'typescript');

    expect(spans.some((s) => s.color)).toBe(true);
    expect(spans.some((s) => !s.color)).toBe(true);
  });

  it('leaves a fence alone when it names a language highlight.js lacks', () => {
    // The author said what it is; substituting a guess would be worse.
    expect(highlightCode('x = 1', 'not-a-language')).toEqual([{ text: 'x = 1' }]);
  });

  it('detects an untagged fence against a constrained candidate list', () => {
    // Unconstrained detection calls this RouterOS config, outscoring Python.
    const code = [
      '# Shape (types only)',
      'CoreAttribute(',
      '    key="devices",',
      '    label="Devices",',
      '    value_schema=ArraySchema(item=SchemaRef("Device")),',
      '    write=None,',
      ')',
    ].join('\n');

    const spans = highlightCode(code);

    expect(spans.map((s) => s.text).join('')).toBe(code);
    expect(spans.filter((s) => s.color).length).toBeGreaterThan(0);
  });

  it('refuses to colour text that is not convincingly code', () => {
    const prose = 'This is just a paragraph of English text, nothing like code at all.';
    expect(highlightCode(prose)).toEqual([{ text: prose }]);
  });

  it('reports which languages it can actually highlight', () => {
    expect(isSupportedLanguage('python')).toBe(true);
    expect(isSupportedLanguage('brainfuck-9000')).toBe(false);
    expect(isSupportedLanguage(undefined)).toBe(false);
  });

  it('has nothing to do with empty code', () => {
    expect(highlightCode('', 'typescript')).toEqual([]);
  });
});

describe('buildCodeBlockStyleRequests', () => {
  const code = 'const x = 42;';
  const requests = (): DocsBatchUpdateRequest[] =>
    buildCodeBlockStyleRequests(100, code.length, code, 'typescript');

  it('shades the block and keeps it Normal Text', () => {
    const para = requests().filter(isPara)[0]!.updateParagraphStyle;

    expect(para.paragraphStyle['namedStyleType']).toBe('NORMAL_TEXT');
    expect(para.paragraphStyle['shading']).toBeDefined();
    expect(para.fields).toBe('namedStyleType,shading');
  });

  it('applies the code font across the whole block', () => {
    const mono = requests()
      .filter(isText)
      .find((r) => r.updateTextStyle.textStyle['weightedFontFamily']);

    expect(mono!.updateTextStyle.textStyle['weightedFontFamily']).toEqual({
      fontFamily: CODE_FONT_FAMILY,
    });
    expect(mono!.updateTextStyle.range).toEqual({
      startIndex: 100,
      endIndex: 100 + code.length,
    });
  });

  it('names a font Docs recognises, since unknown names render as Arial', () => {
    // Arial is not monospace, so a typo here silently destroys code layout.
    const DOCS_MONOSPACE = ['Consolas', 'Roboto Mono', 'JetBrains Mono', 'Inconsolata', 'Source Code Pro', 'Courier New', 'Cousine'];
    expect(DOCS_MONOSPACE).toContain(CODE_FONT_FAMILY);
  });

  it('clears colour before painting, so re-syncs leave no stale tokens', () => {
    const colourOps = requests()
      .filter(isText)
      .filter((r) => 'foregroundColor' in r.updateTextStyle.textStyle);

    const [reset, ...painted] = colourOps;
    expect(reset!.updateTextStyle.textStyle['foregroundColor']).toEqual({});
    expect(reset!.updateTextStyle.range).toEqual({ startIndex: 100, endIndex: 100 + code.length });
    expect(painted.length).toBeGreaterThan(0);
  });

  it('keeps every colour range inside the block', () => {
    for (const r of requests().filter(isText)) {
      expect(r.updateTextStyle.range.startIndex).toBeGreaterThanOrEqual(100);
      expect(r.updateTextStyle.range.endIndex).toBeLessThanOrEqual(100 + code.length);
    }
  });

  it('emits nothing for an empty block', () => {
    expect(buildCodeBlockStyleRequests(100, 0, '', 'typescript')).toEqual([]);
  });

  it('still shades and spaces an unhighlightable language', () => {
    const reqs = buildCodeBlockStyleRequests(5, 4, 'code', 'not-a-language');

    expect(reqs.filter(isPara)).toHaveLength(1);
    expect(reqs.filter(isText).some((r) => r.updateTextStyle.textStyle['weightedFontFamily'])).toBe(true);
  });
});

describe('buildFormattingFromApiDoc — multi-line code blocks', () => {
  // Docs splits inserted code into one paragraph per line.
  const lines = ['def f():', '    return 1'];
  const apiDoc: GDocsApiDocument = {
    body: {
      content: [
        makePara('Intro', 1),
        makePara(lines[0]!, 7),
        makePara(lines[1]!, 7 + lines[0]!.length + 1),
      ],
    },
  };
  const docsDoc: DocsDocument = {
    elements: [
      { type: 'paragraph', runs: [{ text: 'Intro' }] },
      { type: 'code_block', code: lines.join('\n'), language: 'python' },
    ],
  };

  it('formats a block that spans several paragraphs', () => {
    const reqs = buildFormattingFromApiDoc(apiDoc, docsDoc);
    const shaded = reqs.filter(isPara).filter((r) => r.updateParagraphStyle.paragraphStyle['shading']);

    expect(shaded).toHaveLength(1);
  });

  it('covers the block from its first line to its last', () => {
    const reqs = buildFormattingFromApiDoc(apiDoc, docsDoc);
    const shaded = reqs.filter(isPara).find((r) => r.updateParagraphStyle.paragraphStyle['shading'])!;

    // First line starts at 7; the last paragraph ends after its newline, which
    // styling excludes.
    const lastEnd = 7 + lines[0]!.length + 1 + lines[1]!.length + 1;
    expect(shaded.updateParagraphStyle.range).toEqual({ startIndex: 7, endIndex: lastEnd - 1 });
  });

  it('does not mistake a following paragraph for part of the block', () => {
    const withTrailer: GDocsApiDocument = {
      body: {
        content: [
          ...(apiDoc.body!.content ?? []),
          makePara('After', 7 + lines[0]!.length + 1 + lines[1]!.length + 1),
        ],
      },
    };
    const withTrailerModel: DocsDocument = {
      elements: [...docsDoc.elements, { type: 'paragraph', runs: [{ text: 'After' }] }],
    };

    const reqs = buildFormattingFromApiDoc(withTrailer, withTrailerModel);
    const shaded = reqs.filter(isPara).find((r) => r.updateParagraphStyle.paragraphStyle['shading'])!;
    const lastEnd = 7 + lines[0]!.length + 1 + lines[1]!.length + 1;

    expect(shaded.updateParagraphStyle.range.endIndex).toBe(lastEnd - 1);
  });

  it('leaves the document alone when the block is not found', () => {
    const mismatched: DocsDocument = {
      elements: [{ type: 'code_block', code: 'nothing like the doc', language: 'python' }],
    };

    const reqs = buildFormattingFromApiDoc(apiDoc, mismatched);
    expect(reqs.filter(isPara).filter((r) => r.updateParagraphStyle.paragraphStyle['shading'])).toHaveLength(0);
  });
});

describe('code block colours survive the document build', () => {
  /**
   * buildElement resets foregroundColor after every element to stop colour
   * bleeding between them. That reset used to run for code blocks too, landing
   * immediately after the token colours and erasing all of them — while leaving
   * the shading and monospace font, which it does not touch, correctly applied.
   * The block therefore looked styled but never coloured.
   */
  it('emits no reset that would erase a painted token colour', () => {
    const md = [
      '# Title',
      '',
      '```python',
      '# a comment',
      'def f(a, b=3):',
      '    return "text"',
      '```',
      '',
      'Trailing paragraph.',
    ].join('\n');

    const { requests } = buildInsertRequests(convertMarkdownToDocs(md), 1);

    const colourOps = requests
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => isText(r) && r.updateTextStyle.fields === 'foregroundColor')
      .map(({ r, i }) => ({ i, style: (r as TextStyle).updateTextStyle }));

    const painted = colourOps.filter(({ style }) => 'color' in (style.textStyle['foregroundColor'] as object));
    expect(painted.length).toBeGreaterThan(0);

    for (const p of painted) {
      const erased = colourOps.some(
        ({ i, style }) =>
          i > p.i &&
          !('color' in (style.textStyle['foregroundColor'] as object)) &&
          style.range.startIndex <= p.style.range.startIndex &&
          style.range.endIndex >= p.style.range.endIndex,
      );
      expect(erased).toBe(false);
    }
  });

  it('still resets colour after ordinary elements', () => {
    const { requests } = buildInsertRequests(
      convertMarkdownToDocs('# Heading\n\nSome text.\n'),
      1,
    );
    const resets = requests
      .filter(isText)
      .filter((r) => r.updateTextStyle.fields === 'foregroundColor');

    expect(resets.length).toBeGreaterThan(0);
  });
});
