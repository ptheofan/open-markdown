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

function keydown(el: HTMLElement, key: string, mods: Partial<KeyboardEventInit> = {}): void {
  el.dispatchEvent(new KeyboardEvent('keydown', {
    key, bubbles: true, cancelable: true, ...mods,
  }));
}

describe('InlineEditor keyboard shortcuts', () => {
  it('Cmd+B toggles bold over the selection', () => {
    const el = contentEl('hello');
    const editor = new InlineEditor(el, { onCommit: vi.fn() });
    editor.start();
    selectAll(el);
    keydown(el, 'b', { metaKey: true });
    expect(el.querySelector('strong')?.textContent).toBe('hello');
  });

  it('Cmd+I toggles italic, Cmd+E toggles code', () => {
    const el = contentEl('hello');
    const editor = new InlineEditor(el, { onCommit: vi.fn() });
    editor.start();
    selectAll(el);
    keydown(el, 'i', { metaKey: true });
    expect(el.querySelector('em')?.textContent).toBe('hello');
    selectAll(el.querySelector('em')!);
    keydown(el, 'e', { metaKey: true });
    expect(el.querySelector('code')).not.toBe(null);
  });

  it('Cmd+Shift+X toggles strikethrough', () => {
    const el = contentEl('hello');
    const editor = new InlineEditor(el, { onCommit: vi.fn() });
    editor.start();
    selectAll(el);
    keydown(el, 'x', { metaKey: true, shiftKey: true });
    expect(el.querySelector('del')?.textContent).toBe('hello');
  });

  it('Escape commits the session', () => {
    const el = contentEl('hello');
    const onCommit = vi.fn();
    const editor = new InlineEditor(el, { onCommit });
    editor.start();
    keydown(el, 'Escape');
    expect(onCommit).toHaveBeenCalledWith('hello');
  });

  it('stops listening for shortcuts after commit', () => {
    const el = contentEl('hello');
    const editor = new InlineEditor(el, { onCommit: vi.fn() });
    editor.start();
    editor.commit();
    selectAll(el);
    keydown(el, 'b', { metaKey: true });
    expect(el.querySelector('strong')).toBe(null);
  });
});

describe('InlineEditor link insertion', () => {
  it('applyLink wraps the selection in an anchor with the given href', () => {
    const el = contentEl('click here');
    const editor = new InlineEditor(el, { onCommit: vi.fn() });
    editor.start();
    selectAll(el);
    editor.applyLink('https://example.com');
    const a = el.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://example.com');
    expect(a?.textContent).toBe('click here');
  });

  it('applyLink with an empty href unwraps an existing anchor over the selection', () => {
    const el = contentEl('<a href="https://x.com">link</a>');
    const editor = new InlineEditor(el, { onCommit: vi.fn() });
    editor.start();
    selectAll(el);
    editor.applyLink('');
    expect(el.querySelector('a')).toBe(null);
    expect(el.textContent).toBe('link');
  });

  it('Cmd+K invokes the onRequestLink callback', () => {
    const el = contentEl('hello');
    const onRequestLink = vi.fn();
    const editor = new InlineEditor(el, { onCommit: vi.fn(), onRequestLink });
    editor.start();
    keydown(el, 'k', { metaKey: true });
    expect(onRequestLink).toHaveBeenCalledTimes(1);
  });
});

function caretAt(node: Node, offset: number): void {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

describe('InlineEditor arrow navigation', () => {
  it('ArrowUp fires onNavigate("up") when caret is on the first line', () => {
    const el = contentEl('hello');
    const onNavigate = vi.fn();
    const editor = new InlineEditor(el, { onCommit: vi.fn(), onNavigate });
    editor.start();
    caretAt(el.firstChild!, 0);
    keydown(el, 'ArrowUp');
    expect(onNavigate).toHaveBeenCalledWith('up');
  });

  it('ArrowDown fires onNavigate("down") when caret is on the last line', () => {
    const el = contentEl('hello');
    const onNavigate = vi.fn();
    const editor = new InlineEditor(el, { onCommit: vi.fn(), onNavigate });
    editor.start();
    caretAt(el.firstChild!, 5);
    keydown(el, 'ArrowDown');
    expect(onNavigate).toHaveBeenCalledWith('down');
  });

  it('does not preventDefault for arrows when onNavigate is absent', () => {
    const el = contentEl('hello');
    const editor = new InlineEditor(el, { onCommit: vi.fn() });
    editor.start();
    caretAt(el.firstChild!, 0);
    const e = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
});

describe('InlineEditor Enter handling', () => {
  it('Enter calls onSplit with the markdown before and after the caret', () => {
    const el = contentEl('hello world');
    const onSplit = vi.fn();
    const editor = new InlineEditor(el, { onCommit: vi.fn(), onSplit });
    editor.start();
    caretAt(el.firstChild!, 5); // between "hello" and " world"
    keydown(el, 'Enter');
    expect(onSplit).toHaveBeenCalledWith('hello', ' world');
  });

  it('Enter at the very end calls onSplit with an empty after', () => {
    const el = contentEl('hello');
    const onSplit = vi.fn();
    const editor = new InlineEditor(el, { onCommit: vi.fn(), onSplit });
    editor.start();
    caretAt(el.firstChild!, 5);
    keydown(el, 'Enter');
    expect(onSplit).toHaveBeenCalledWith('hello', '');
  });

  it('Enter does not fire onCommit after the split', () => {
    const el = contentEl('hello world');
    const onCommit = vi.fn();
    const editor = new InlineEditor(el, { onCommit, onSplit: vi.fn() });
    editor.start();
    caretAt(el.firstChild!, 5);
    keydown(el, 'Enter');
    editor.commit(); // explicit follow-up commit should be a no-op
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('Shift+Enter inserts a <br> at the caret without firing onSplit', () => {
    const el = contentEl('hello world');
    const onSplit = vi.fn();
    const editor = new InlineEditor(el, { onCommit: vi.fn(), onSplit });
    editor.start();
    caretAt(el.firstChild!, 5);
    keydown(el, 'Enter', { shiftKey: true });
    expect(el.querySelector('br')).not.toBe(null);
    expect(onSplit).not.toHaveBeenCalled();
  });
});
