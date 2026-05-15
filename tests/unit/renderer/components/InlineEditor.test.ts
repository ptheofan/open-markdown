/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { InlineEditor } from '../../../../src/renderer/components/InlineEditor';

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
