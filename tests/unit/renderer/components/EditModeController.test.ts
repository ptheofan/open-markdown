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
