/**
 * MarkdownToDocsConverter - Transforms markdown into a DocsDocument structure
 *
 * Uses markdown-it to parse markdown into tokens, then walks the token stream
 * to build an array of DocsElement objects suitable for the Google Docs API.
 */
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import type { DocsDocument, DocsElement, DocsTextRun } from '@shared/types/google-docs';

const md = new MarkdownIt({ html: false, linkify: true });
md.enable('strikethrough');

function parseInlineTokens(children: Token[]): DocsTextRun[] {
  const runs: DocsTextRun[] = [];
  let bold = false;
  let italic = false;
  let strikethrough = false;
  let link: string | undefined;

  for (const child of children) {
    switch (child.type) {
      case 'text':
        runs.push({
          text: child.content,
          ...(bold && { bold }),
          ...(italic && { italic }),
          ...(strikethrough && { strikethrough }),
          ...(link && { link }),
        });
        break;
      case 'strong_open':
        bold = true;
        break;
      case 'strong_close':
        bold = false;
        break;
      case 'em_open':
        italic = true;
        break;
      case 'em_close':
        italic = false;
        break;
      case 's_open':
        strikethrough = true;
        break;
      case 's_close':
        strikethrough = false;
        break;
      case 'code_inline':
        runs.push({
          text: child.content,
          code: true,
          ...(bold && { bold }),
          ...(italic && { italic }),
          ...(link && { link }),
        });
        break;
      case 'link_open':
        link = child.attrGet('href') ?? undefined;
        break;
      case 'link_close':
        link = undefined;
        break;
      case 'softbreak':
      case 'hardbreak':
        runs.push({ text: '\n' });
        break;
      case 'image':
        // Inline images: use alt text from children content, src from attrs
        runs.push({
          text: child.content || child.attrGet('alt') || '',
          ...(link && { link }),
        });
        break;
    }
  }
  return runs.filter(r => r.text !== '');
}

function processTokens(tokens: Token[], listStack: Array<{ ordered: boolean }> = []): DocsElement[] {
  const elements: DocsElement[] = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i]!;

    switch (token.type) {
      case 'heading_open': {
        const level = parseInt(token.tag.slice(1), 10) as 1 | 2 | 3 | 4 | 5 | 6;
        const inlineToken = tokens[i + 1];
        const runs = inlineToken?.children ? parseInlineTokens(inlineToken.children) : [];
        elements.push({ type: 'heading', headingLevel: level, runs });
        i += 3; // heading_open, inline, heading_close
        break;
      }

      case 'paragraph_open': {
        const inlineToken = tokens[i + 1];
        const runs = inlineToken?.children ? parseInlineTokens(inlineToken.children) : [];
        elements.push({ type: 'paragraph', runs });
        i += 3; // paragraph_open, inline, paragraph_close
        break;
      }

      case 'fence': {
        const lang = token.info.trim().toLowerCase();
        if (lang === 'mermaid') {
          elements.push({
            type: 'image',
            imageAlt: 'Mermaid diagram',
            code: token.content.trim(),
          });
        } else {
          elements.push({
            type: 'code_block',
            code: token.content,
            ...(lang && { language: lang }),
          });
        }
        i += 1;
        break;
      }

      case 'bullet_list_open': {
        listStack.push({ ordered: false });
        i += 1;
        break;
      }

      case 'ordered_list_open': {
        listStack.push({ ordered: true });
        i += 1;
        break;
      }

      case 'bullet_list_close':
      case 'ordered_list_close': {
        listStack.pop();
        i += 1;
        break;
      }

      case 'list_item_open': {
        // Collect inner content until list_item_close at the same level
        const itemLevel = token.level;
        const innerTokens: Token[] = [];
        i += 1;
        while (i < tokens.length && !(tokens[i]!.type === 'list_item_close' && tokens[i]!.level === itemLevel)) {
          innerTokens.push(tokens[i]!);
          i += 1;
        }
        i += 1; // skip list_item_close

        // Process inner tokens to get runs (from the first paragraph) and any nested elements
        const innerElements = processTokens(innerTokens, listStack);
        const currentList = listStack[listStack.length - 1];
        const listDepth = listStack.length - 1;
        const listOrdered = currentList?.ordered ?? false;

        // The first paragraph's runs become the list item's runs
        // Other elements (nested lists) become separate elements
        const firstParagraph = innerElements.find(e => e.type === 'paragraph');
        const remainingElements = innerElements.filter(e => e !== firstParagraph);

        const listItem: DocsElement = {
          type: 'list_item',
          listDepth,
          listOrdered,
          runs: firstParagraph?.runs ?? [],
        };
        elements.push(listItem);

        // Add remaining inner elements (nested list items will already be flattened)
        elements.push(...remainingElements);
        break;
      }

      case 'table_open': {
        const rows: DocsTextRun[][][] = [];
        i += 1; // skip table_open

        while (i < tokens.length && tokens[i]!.type !== 'table_close') {
          const t = tokens[i]!;

          if (t.type === 'tr_open') {
            const row: DocsTextRun[][] = [];
            i += 1;

            while (i < tokens.length && tokens[i]!.type !== 'tr_close') {
              const cellToken = tokens[i]!;

              if (cellToken.type === 'th_open' || cellToken.type === 'td_open') {
                i += 1; // move to inline
                const inlineToken = tokens[i]!;
                const cellRuns = inlineToken?.children ? parseInlineTokens(inlineToken.children) : [];
                row.push(cellRuns);
                i += 1; // skip inline
                i += 1; // skip th_close / td_close
              } else {
                i += 1;
              }
            }

            rows.push(row);
            i += 1; // skip tr_close
          } else {
            // thead_open, thead_close, tbody_open, tbody_close
            i += 1;
          }
        }

        i += 1; // skip table_close
        elements.push({ type: 'table', rows });
        break;
      }

      case 'blockquote_open': {
        const bqLevel = token.level;
        const innerTokens: Token[] = [];
        i += 1;
        while (i < tokens.length && !(tokens[i]!.type === 'blockquote_close' && tokens[i]!.level === bqLevel)) {
          innerTokens.push(tokens[i]!);
          i += 1;
        }
        i += 1; // skip blockquote_close

        const children = processTokens(innerTokens);
        elements.push({ type: 'blockquote', children });
        break;
      }

      case 'hr': {
        elements.push({ type: 'horizontal_rule' });
        i += 1;
        break;
      }

      default:
        i += 1;
        break;
    }
  }

  return elements;
}

export function convertMarkdownToDocs(markdown: string): DocsDocument {
  const tokens = md.parse(markdown, {});
  const elements = processTokens(tokens);
  return { elements };
}
