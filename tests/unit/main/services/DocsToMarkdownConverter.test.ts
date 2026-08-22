import { describe, it, expect } from 'vitest';
import { convertDocsToMarkdown } from '@main/services/DocsToMarkdownConverter';
import { CODE_FONT_FAMILY } from '@main/services/DocsDocumentBuilder';
import type { GDocsApiDocument, GDocsStructuralElement } from '@shared/types/google-docs';

type Style = Record<string, unknown>;

function para(
  runs: Array<{ text: string; style?: Style }>,
  paragraphStyle?: Style,
  bullet?: { listId?: string; nestingLevel?: number },
): GDocsStructuralElement {
  return {
    paragraph: {
      elements: runs.map((r) => ({ textRun: { content: r.text, textStyle: r.style ?? {} } })),
      ...(paragraphStyle ? { paragraphStyle } : {}),
      ...(bullet ? { bullet } : {}),
    },
  };
}

function doc(content: GDocsStructuralElement[], extra: Partial<GDocsApiDocument> = {}): GDocsApiDocument {
  return { body: { content }, ...extra };
}

describe('convertDocsToMarkdown', () => {
  describe('headings', () => {
    it('maps the Docs named styles back to the levels that produced them', () => {
      const md = convertDocsToMarkdown(doc([
        para([{ text: 'Title\n' }], { namedStyleType: 'TITLE' }),
        para([{ text: 'Sub\n' }], { namedStyleType: 'HEADING_1' }),
        para([{ text: 'Deep\n' }], { namedStyleType: 'HEADING_5' }),
      ]));

      expect(md).toBe('# Title\n\n## Sub\n\n###### Deep\n');
    });
  });

  describe('inline marks', () => {
    it('emits bold, italic and strikethrough', () => {
      const md = convertDocsToMarkdown(doc([
        para([
          { text: 'a ' },
          { text: 'bold', style: { bold: true } },
          { text: ' and ' },
          { text: 'it', style: { italic: true } },
          { text: ' and ' },
          { text: 'gone', style: { strikethrough: true } },
          { text: '\n' },
        ]),
      ]));

      expect(md).toBe('a **bold** and *it* and ~~gone~~\n');
    });

    it('keeps trailing whitespace outside the markers', () => {
      // Bolding a word in Docs usually catches the space after it. Left inside
      // the markers CommonMark refuses to close the emphasis, and the reader
      // sees literal asterisks.
      const md = convertDocsToMarkdown(doc([
        para([
          { text: 'attribute ' },
          { text: 'Testt2 ', style: { bold: true } },
          { text: 'schema\n' },
        ]),
      ]));

      expect(md).toBe('attribute **Testt2** schema\n');
    });

    it('joins runs that Docs split mid-word', () => {
      // Docs splits runs wherever it likes -- one bolded word routinely comes
      // back as two. Emitted separately they give `**Test****t2**`, and the
      // output would depend on where the split happened to fall.
      const md = convertDocsToMarkdown(doc([
        para([
          { text: 'attribute ' },
          { text: 'Test', style: { bold: true } },
          { text: 't2', style: { bold: true } },
          { text: ' schema\n' },
        ]),
      ]));

      expect(md).toBe('attribute **Testt2** schema\n');
    });

    it('emits a link', () => {
      const md = convertDocsToMarkdown(doc([
        para([
          { text: 'see ' },
          { text: 'the docs', style: { link: { url: 'https://example.com' } } },
          { text: '\n' },
        ]),
      ]));

      expect(md).toBe('see [the docs](https://example.com)\n');
    });

    it('escapes characters that would otherwise be read as syntax', () => {
      const md = convertDocsToMarkdown(doc([para([{ text: 'a * b _ c\n' }])]));
      expect(md).toBe('a \\* b \\_ c\n');
    });
  });

  describe('block structures', () => {
    it('fences consecutive monospace paragraphs as one code block', () => {
      const codeStyle = { weightedFontFamily: { fontFamily: CODE_FONT_FAMILY } };
      const md = convertDocsToMarkdown(doc([
        para([{ text: 'const a = 1;\n', style: codeStyle }]),
        para([{ text: 'const b = 2;\n', style: codeStyle }]),
        para([{ text: 'after\n' }]),
      ]));

      expect(md).toBe('```\nconst a = 1;\nconst b = 2;\n```\n\nafter\n');
    });

    it('reads bullets back as a nested list', () => {
      const md = convertDocsToMarkdown(doc(
        [
          para([{ text: 'one\n' }], undefined, { listId: 'L1', nestingLevel: 0 }),
          para([{ text: 'nested\n' }], undefined, { listId: 'L1', nestingLevel: 1 }),
        ],
        { lists: { L1: { listProperties: { nestingLevels: [{ glyphSymbol: '●' }, { glyphSymbol: '○' }] } } } },
      ));

      expect(md).toBe('- one\n  - nested\n');
    });

    it('reads a decimal glyph back as an ordered list', () => {
      const md = convertDocsToMarkdown(doc(
        [para([{ text: 'first\n' }], undefined, { listId: 'L1', nestingLevel: 0 })],
        { lists: { L1: { listProperties: { nestingLevels: [{ glyphType: 'DECIMAL' }] } } } },
      ));

      expect(md).toBe('1. first\n');
    });

    it('reads an indented run of paragraphs back as a blockquote', () => {
      const md = convertDocsToMarkdown(doc([
        para([{ text: 'quoted\n' }], { indentStart: { magnitude: 36, unit: 'PT' } }),
      ]));

      expect(md).toBe('> quoted\n');
    });

    it('reads a bottom-bordered empty paragraph back as a rule', () => {
      const md = convertDocsToMarkdown(doc([
        para([{ text: '\n' }], { borderBottom: { width: { magnitude: 1, unit: 'PT' } } }),
      ]));

      expect(md).toBe('---\n');
    });

    it('rebuilds a table as GFM pipes', () => {
      const md = convertDocsToMarkdown(doc([
        {
          table: {
            tableRows: [
              { tableCells: [{ content: [para([{ text: 'H1\n' }])] }, { content: [para([{ text: 'H2\n' }])] }] },
              { tableCells: [{ content: [para([{ text: 'a\n' }])] }, { content: [para([{ text: 'b\n' }])] }] },
            ],
          },
        },
      ]));

      expect(md).toBe('| H1 | H2 |\n| --- | --- |\n| a | b |\n');
    });
  });

  describe('images', () => {
    it('uses the stable source URL, not the per-fetch content URL', () => {
      const md = convertDocsToMarkdown(doc(
        [{ paragraph: { elements: [{ inlineObjectElement: { inlineObjectId: 'obj-1' } }] } }],
        {
          inlineObjects: {
            'obj-1': {
              inlineObjectProperties: {
                embeddedObject: {
                  title: 'Flow',
                  imageProperties: {
                    sourceUri: 'https://drive.google.com/uc?id=abc',
                    contentUri: 'https://lh3.googleusercontent.com/ephemeral-xyz',
                  },
                },
              },
            },
          },
        },
      ));

      expect(md).toBe('![Flow](https://drive.google.com/uc?id=abc)\n');
    });
  });

  describe('determinism', () => {
    // The converter is allowed to be lossy -- a mermaid fence is only a PNG in
    // the Doc. It is not allowed to be unstable: each side of the sync is
    // diffed against its own previous output, so identical input must give
    // byte-identical output or every unchanged block looks edited.
    it('gives byte-identical output for the same document', () => {
      const sample = doc([
        para([{ text: 'Title\n' }], { namedStyleType: 'TITLE' }),
        para([{ text: 'body ' }, { text: 'bold', style: { bold: true } }, { text: '\n' }]),
        { paragraph: { elements: [{ inlineObjectElement: { inlineObjectId: 'obj-1' } }] } },
      ], {
        inlineObjects: {
          'obj-1': {
            inlineObjectProperties: {
              embeddedObject: { imageProperties: { sourceUri: 'https://drive.google.com/uc?id=abc' } },
            },
          },
        },
      });

      expect(convertDocsToMarkdown(sample)).toBe(convertDocsToMarkdown(sample));
    });
  });
});

describe('artefacts that make a document differ from itself', () => {
  // Each of these produced a block with no counterpart in the markdown that
  // built the Doc, so the merge reported a change on text nobody had touched.
  it('drops an empty heading rather than emitting a bare marker', () => {
    const md = convertDocsToMarkdown(doc([
      para([{ text: 'Real\n' }], { namedStyleType: 'HEADING_2' }),
      para([{ text: '\n' }], { namedStyleType: 'HEADING_2' }),
      para([{ text: 'After\n' }]),
    ]));

    expect(md).toBe('### Real\n\nAfter\n');
  });

  it('drops an empty list item rather than emitting a bare dash', () => {
    const md = convertDocsToMarkdown(doc([
      para([{ text: 'one\n' }], undefined, { listId: 'L' }),
      para([{ text: '\n' }], undefined, { listId: 'L' }),
      para([{ text: 'two\n' }], undefined, { listId: 'L' }),
    ]));

    expect(md).toBe('- one\n- two\n');
  });

  it('leaves a lone tilde alone, since only a doubled one means anything', () => {
    const md = convertDocsToMarkdown(doc([para([{ text: '~11 columns\n' }])]));
    expect(md).toBe('~11 columns\n');
  });

  it('still escapes a doubled tilde, which would read as strikethrough', () => {
    const md = convertDocsToMarkdown(doc([para([{ text: 'a ~~b~~ c\n' }])]));
    expect(md).toContain('\\~~b');
  });
});

describe('a line break inside a paragraph', () => {
  it('comes back as a markdown hard break, not a control character', () => {
    // Docs spells a within-paragraph break as a vertical tab. Left raw it
    // would read as a difference against the file on every later sync.
    const md = convertDocsToMarkdown({
      body: {
        content: [
          {
            startIndex: 1,
            endIndex: 26,
            paragraph: { elements: [{ textRun: { content: 'First line.\u000bSecond line.\n' } }] },
          },
        ],
      },
    });

    expect(md).not.toContain('\u000b');
    expect(md).toContain('First line.  \nSecond line.');
  });
});
