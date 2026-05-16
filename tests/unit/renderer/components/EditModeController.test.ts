/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { EditModeController } from '../../../../src/renderer/components/EditModeController';
import type { PluginManager } from '../../../../src/plugins/core/PluginManager';

/** Minimal PluginManager stub: render wraps content in <p>, bold/italic
 *  markdown becomes tags. Good enough for edit-mode orchestration tests. */
function makePluginManager(): PluginManager {
  return {
    render: (md: string): string => {
      const html = md
        .replace(/^#{1,6}\s+/, '')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(?<!\*)\*(?!\*)(.+?)\*(?!\*)/g, '<em>$1</em>');
      return `<p>${html}</p>`;
    },
    postRender: vi.fn(() => Promise.resolve()),
  } as unknown as PluginManager;
}

function setup(): { container: HTMLElement; controller: EditModeController } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const controller = new EditModeController(container, makePluginManager());
  return { container, controller };
}

describe('EditModeController — WYSIWYG editing', () => {
  it('clicking a slice makes its content contenteditable, not a textarea', async () => {
    const { container, controller } = setup();
    await controller.enter('Hello **world**');
    const content = container.querySelector<HTMLElement>('.slice-content')!;
    content.click();
    expect(content.getAttribute('contenteditable')).toBe('true');
    expect(container.querySelector('textarea')).toBe(null);
  });

  it('committing an edited slice re-applies the block prefix and updates markdown', async () => {
    const { container, controller } = setup();
    const onContentChange = vi.fn();
    controller.setCallbacks({ onContentChange });
    await controller.enter('# Title');
    const content = container.querySelector<HTMLElement>('.slice-content')!;
    content.click();
    content.textContent = 'New Title';
    controller.commitActiveEditForTest();
    expect(onContentChange).toHaveBeenCalledWith('# New Title');
    expect(controller.getMarkdown()).toBe('# New Title');
  });
});

describe('EditModeController — raw markdown editing', () => {
  it('startRawEdit puts a slim textarea in the slice with the raw markdown', async () => {
    const { container, controller } = setup();
    await controller.enter('# Title');
    container.querySelector<HTMLElement>('.slice-content')!.click(); // WYSIWYG
    controller.toggleRawForActiveSlice();
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea.slice-raw-editor');
    expect(textarea).not.toBe(null);
    expect(textarea!.value).toBe('# Title');
  });

  it('committing a raw edit updates the markdown verbatim', async () => {
    const { container, controller } = setup();
    const onContentChange = vi.fn();
    controller.setCallbacks({ onContentChange });
    await controller.enter('# Title');
    container.querySelector<HTMLElement>('.slice-content')!.click();
    controller.toggleRawForActiveSlice();
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea.slice-raw-editor')!;
    textarea.value = '## Changed';
    controller.commitActiveEditForTest();
    expect(onContentChange).toHaveBeenCalledWith('## Changed');
  });
});

describe('EditModeController — global shortcuts and menu', () => {
  it('Cmd+/ toggles the active slice to raw editing', async () => {
    const { container, controller } = setup();
    await controller.enter('# Title');
    container.querySelector<HTMLElement>('.slice-content')!.click();
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: '/', metaKey: true, bubbles: true, cancelable: true,
    }));
    expect(container.querySelector('textarea.slice-raw-editor')).not.toBe(null);
  });

  it('Cmd+Shift+F toggles the floating toolbar visibility flag', async () => {
    const { controller } = setup();
    await controller.enter('# Title');
    expect(controller.isToolbarVisible()).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'f', metaKey: true, shiftKey: true, bubbles: true, cancelable: true,
    }));
    expect(controller.isToolbarVisible()).toBe(true);
  });

  it('exit() removes the global key listener', async () => {
    const { controller } = setup();
    await controller.enter('# Title');
    controller.exit();
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'f', metaKey: true, shiftKey: true, bubbles: true, cancelable: true,
    }));
    expect(controller.isToolbarVisible()).toBe(false);
  });
});

describe('EditModeController — floating toolbar wiring', () => {
  it('shows the toolbar above a slice being edited when toolbar is enabled', async () => {
    const { container, controller } = setup();
    await controller.enter('Hello world');
    controller.setToolbarVisible(true);
    container.querySelector<HTMLElement>('.slice-content')!.click();
    const toolbar = container.querySelector('.inline-format-toolbar') as HTMLElement;
    expect(toolbar).not.toBe(null);
    expect(toolbar.hidden).toBe(false);
  });

  it('keeps the toolbar hidden when toolbar is disabled', async () => {
    const { container, controller } = setup();
    await controller.enter('Hello world');
    container.querySelector<HTMLElement>('.slice-content')!.click();
    const toolbar = container.querySelector<HTMLElement>('.inline-format-toolbar');
    expect(toolbar === null || toolbar.hidden).toBe(true);
  });

  it('Enter at the end of a slice inserts a new empty slice — does not jump to the next existing one', async () => {
    const { container, controller } = setup();
    await controller.enter('First\n\nSecond');
    const slicesBefore = container.querySelectorAll<HTMLElement>('.slice');
    expect(slicesBefore.length).toBe(2);
    // Click into the FIRST slice and put caret at the end of "First".
    const firstContent = slicesBefore[0]!.querySelector<HTMLElement>('.slice-content')!;
    firstContent.click();
    const textNode = firstContent.firstChild!.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 5); // end of "First"
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    firstContent.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', bubbles: true, cancelable: true,
    }));
    const slicesAfter = container.querySelectorAll<HTMLElement>('.slice');
    expect(slicesAfter.length).toBe(3); // First, NEW EMPTY, Second
    // The new empty slice (position 1) should be the active edit, not Second.
    expect(slicesAfter[1]!.classList.contains('slice-editing')).toBe(true);
    expect(slicesAfter[1]!.querySelector('.slice-content')!.textContent).toBe('');
    // Second slice content untouched.
    expect(slicesAfter[2]!.querySelector('.slice-content')!.textContent).toContain('Second');
  });

  it('Enter inside a slice splits it and the new slice gets focus', async () => {
    const { container, controller } = setup();
    const onContentChange = vi.fn();
    controller.setCallbacks({ onContentChange });
    await controller.enter('Hello world');
    const content = container.querySelector<HTMLElement>('.slice-content')!;
    content.click();
    // .slice-content > <p>Hello world</p> — caret between "Hello" and " world"
    const textNode = content.firstChild!.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 5);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    content.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', bubbles: true, cancelable: true,
    }));
    expect(controller.getMarkdown()).toBe('Hello\n\n world');
    expect(onContentChange).toHaveBeenCalledWith('Hello\n\n world');
    // The new slice should be the active edit.
    const slices = container.querySelectorAll<HTMLElement>('.slice');
    expect(slices.length).toBe(2);
    expect(slices[1]!.classList.contains('slice-editing')).toBe(true);
  });

  it('a toolbar bold action wraps the selection in the active editor', async () => {
    const { container, controller } = setup();
    await controller.enter('Hello world');
    controller.setToolbarVisible(true);
    const content = container.querySelector<HTMLElement>('.slice-content')!;
    content.click();
    const range = document.createRange();
    range.selectNodeContents(content);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    container
      .querySelector<HTMLButtonElement>('.inline-format-toolbar [data-action="bold"]')!
      .click();
    expect(content.querySelector('strong')).not.toBe(null);
  });
});
