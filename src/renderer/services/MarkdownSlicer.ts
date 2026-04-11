/**
 * MarkdownSlicer - Parses markdown into individual slices (blocks)
 *
 * Each slice represents a discrete content block similar to Notion's block model:
 * headings, paragraphs, list items, code blocks, blockquotes, tables, etc.
 */
import MarkdownIt from 'markdown-it';

/**
 * Type of markdown slice
 */
export type SliceType =
  | 'heading'
  | 'paragraph'
  | 'list-item'
  | 'code'
  | 'blockquote'
  | 'table'
  | 'hr'
  | 'html'
  | 'unknown';

/**
 * A single markdown slice representing a content block
 */
export interface MarkdownSlice {
  /** Unique index of this slice */
  index: number;
  /** Type of content block */
  type: SliceType;
  /** Raw markdown source for this slice */
  raw: string;
  /** Starting line in the original markdown (0-based) */
  startLine: number;
  /** Ending line in the original markdown (exclusive, 0-based) */
  endLine: number;
}

/**
 * MarkdownSlicer class
 */
export class MarkdownSlicer {
  private md: MarkdownIt;

  constructor() {
    this.md = new MarkdownIt({
      html: true,
      linkify: true,
      typographer: true,
    });
  }

  /**
   * Parse markdown text into slices
   */
  slice(markdown: string): MarkdownSlice[] {
    const lines = markdown.split('\n');
    const tokens = this.md.parse(markdown, {});
    const slices: MarkdownSlice[] = [];
    let sliceIndex = 0;

    let i = 0;
    while (i < tokens.length) {
      const token = tokens[i]!;

      // Handle list blocks: split into individual list items
      if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
        const closeType = token.type === 'bullet_list_open'
          ? 'bullet_list_close'
          : 'ordered_list_close';

        i++; // skip list_open
        let depth = 0;

        while (i < tokens.length) {
          const t = tokens[i]!;

          if (t.type === closeType && depth === 0) {
            i++; // skip list_close
            break;
          }

          // Track nested list depth
          if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') {
            depth++;
          }
          if (t.type === 'bullet_list_close' || t.type === 'ordered_list_close') {
            depth--;
          }

          // Only extract top-level list items
          if (t.type === 'list_item_open' && depth === 0) {
            const startLine = t.map ? t.map[0] : -1;
            // Find matching list_item_close
            let itemDepth = 1;
            i++;
            while (i < tokens.length && itemDepth > 0) {
              if (tokens[i]!.type === 'list_item_open') itemDepth++;
              if (tokens[i]!.type === 'list_item_close') itemDepth--;
              if (itemDepth > 0) i++;
            }
            // tokens[i] is now list_item_close
            const closeToken = tokens[i]!;
            const endLine = closeToken.map ? closeToken.map[1] : startLine + 1;
            const raw = this.extractLines(lines, startLine, endLine);

            slices.push({
              index: sliceIndex++,
              type: 'list-item',
              raw,
              startLine,
              endLine,
            });
            i++; // skip list_item_close
          } else {
            i++;
          }
        }
        continue;
      }

      // Handle block tokens with source maps
      if (token.map && token.nesting !== -1) {
        const type = this.getSliceType(token.type);
        const startLine = token.map[0];

        // Find the closing token for paired elements
        let endLine = token.map[1];

        if (token.nesting === 1) {
          // Opening tag - find its closing pair
          const closeType = token.type.replace('_open', '_close');
          let depth = 1;
          let j = i + 1;
          while (j < tokens.length && depth > 0) {
            if (tokens[j]!.type === token.type) depth++;
            if (tokens[j]!.type === closeType) depth--;
            j++;
          }
          // j-1 is the closing token
          const closeToken = tokens[j - 1];
          if (closeToken?.map) {
            endLine = closeToken.map[1];
          }
          // Skip to after the closing token
          const raw = this.extractLines(lines, startLine, endLine);
          slices.push({
            index: sliceIndex++,
            type,
            raw,
            startLine,
            endLine,
          });
          i = j;
          continue;
        }

        // Self-closing tokens (fence, hr, html_block)
        const raw = this.extractLines(lines, startLine, endLine);
        slices.push({
          index: sliceIndex++,
          type,
          raw,
          startLine,
          endLine,
        });
      }

      i++;
    }

    // Sort by line number and fill gaps with raw content
    slices.sort((a, b) => a.startLine - b.startLine);

    return this.fillGaps(slices, lines);
  }

  /**
   * Map markdown-it token types to our slice types
   */
  private getSliceType(tokenType: string): SliceType {
    if (tokenType.startsWith('heading')) return 'heading';
    if (tokenType === 'paragraph_open' || tokenType === 'paragraph') return 'paragraph';
    if (tokenType === 'fence' || tokenType === 'code_block') return 'code';
    if (tokenType.startsWith('blockquote')) return 'blockquote';
    if (tokenType.startsWith('table')) return 'table';
    if (tokenType === 'hr') return 'hr';
    if (tokenType === 'html_block') return 'html';
    return 'unknown';
  }

  /**
   * Extract lines from the source
   */
  private extractLines(lines: string[], start: number, end: number): string {
    return lines.slice(start, end).join('\n');
  }

  /**
   * Fill in any gaps between slices (empty lines, content the parser didn't map)
   */
  private fillGaps(slices: MarkdownSlice[], lines: string[]): MarkdownSlice[] {
    if (slices.length === 0 && lines.length > 0) {
      // No slices parsed - return entire content as one slice
      const raw = lines.join('\n');
      if (raw.trim()) {
        return [{
          index: 0,
          type: 'paragraph',
          raw,
          startLine: 0,
          endLine: lines.length,
        }];
      }
      return [];
    }

    const result: MarkdownSlice[] = [];
    let currentLine = 0;
    let idx = 0;

    for (const slice of slices) {
      // Add gap content if there is significant content between slices
      if (slice.startLine > currentLine) {
        const gapRaw = this.extractLines(lines, currentLine, slice.startLine);
        if (gapRaw.trim()) {
          result.push({
            index: idx++,
            type: 'paragraph',
            raw: gapRaw,
            startLine: currentLine,
            endLine: slice.startLine,
          });
        }
      }
      result.push({ ...slice, index: idx++ });
      currentLine = Math.max(currentLine, slice.endLine);
    }

    // Handle trailing content
    if (currentLine < lines.length) {
      const trailingRaw = this.extractLines(lines, currentLine, lines.length);
      if (trailingRaw.trim()) {
        result.push({
          index: idx++,
          type: 'paragraph',
          raw: trailingRaw,
          startLine: currentLine,
          endLine: lines.length,
        });
      }
    }

    return result;
  }

  /**
   * Reassemble full markdown from slices
   */
  reassemble(slices: MarkdownSlice[]): string {
    const sorted = [...slices].sort((a, b) => a.startLine - b.startLine);
    return sorted.map(s => s.raw).join('\n');
  }

  /**
   * Update a single slice's raw content and return the full reassembled markdown.
   * Recalculates line numbers for all subsequent slices.
   */
  updateSlice(slices: MarkdownSlice[], sliceIndex: number, newRaw: string): {
    markdown: string;
    slices: MarkdownSlice[];
  } {
    const updated = slices.map(s => ({ ...s }));
    const target = updated.find(s => s.index === sliceIndex);
    if (!target) {
      return { markdown: this.reassemble(updated), slices: updated };
    }

    const oldLineCount = target.endLine - target.startLine;
    const newLineCount = newRaw.split('\n').length;
    const lineDelta = newLineCount - oldLineCount;

    target.raw = newRaw;
    target.endLine = target.startLine + newLineCount;

    // Adjust subsequent slices
    for (const s of updated) {
      if (s.index !== sliceIndex && s.startLine >= target.startLine + oldLineCount) {
        s.startLine += lineDelta;
        s.endLine += lineDelta;
      }
    }

    const markdown = this.reassemble(updated);
    return { markdown, slices: updated };
  }
}
