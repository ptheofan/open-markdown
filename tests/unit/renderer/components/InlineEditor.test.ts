/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { InlineEditor } from '../../../../src/renderer/components/InlineEditor';
import type { InlineMark } from '../../../../src/renderer/components/InlineEditor';

function contentEl(html: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'slice-content';
  el.insertAdjacentHTML('afterbegin', html);
  document.body.appendChild(el);
  return el;
}

describe('InlineEditor lifecycle', () => {
  it('makes the element editable on start and focuses it', () => {
    const el = contentEl('hello');
    const editor = new InlineEditor(el, { onCommit: vi.fn() });
    editor.start();
    expect(el.getAttribute('contenteditable')).toBe('true');
    expect(document.activeElement).toBe(el);
  });

  it('commit() passes serialized markdown to onCommit and clears editable', () => {
    const el = contentEl('a <strong>bold</strong> word');
    const onCommit = vi.fn();
    const editor = new InlineEditor(el, { onCommit });
    editor.start();
    editor.commit();
    expect(onCommit).toHaveBeenCalledWith('a **bold** word');
    expect(el.getAttribute('contenteditable')).toBe(null);
  });

  it('commit() is idempotent — a second call does not fire onCommit again', () => {
    const el = contentEl('text');
    const onCommit = vi.fn();
    const editor = new InlineEditor(el, { onCommit });
    editor.start();
    editor.commit();
    editor.commit();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});

function selectAll(el: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

describe('InlineEditor mark toggle', () => {
  it('wraps the selection in <strong> when bold is toggled on', () => {
    const el = contentEl('hello');
    const editor = new InlineEditor(el, { onCommit: vi.fn() });
    editor.start();
    selectAll(el);
    editor.toggleMark('bold' as InlineMark);
    expect(el.querySelector('strong')?.textContent).toBe('hello');
  });

  it('unwraps when the same mark is toggled off over an identical selection', () => {
    const el = contentEl('<strong>hello</strong>');
    const editor = new InlineEditor(el, { onCommit: vi.fn() });
    editor.start();
    selectAll(el);
    editor.toggleMark('bold' as InlineMark);
    expect(el.querySelector('strong')).toBe(null);
    expect(el.textContent).toBe('hello');
  });

  it('isMarkActive reflects whether the selection is fully inside a mark', () => {
    const el = contentEl('<em>x</em>');
    const editor = new InlineEditor(el, { onCommit: vi.fn() });
    editor.start();
    selectAll(el);
    expect(editor.isMarkActive('italic' as InlineMark)).toBe(true);
    expect(editor.isMarkActive('bold' as InlineMark)).toBe(false);
  });
});
