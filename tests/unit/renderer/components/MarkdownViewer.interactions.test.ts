/**
 * @vitest-environment jsdom
 *
 * The document's own controls: task-list checkboxes that write back to the
 * markdown, the copy button on code blocks, and the section menu on headings.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMarkdownViewer, type MarkdownViewer } from '@renderer/components/MarkdownViewer';

const FILE = '/docs/plan.md';

describe('MarkdownViewer interactions', () => {
  let container: HTMLElement;
  let viewer: MarkdownViewer;
  let writeText: ReturnType<typeof vi.fn>;
  let showContextMenu: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '<div id="markdown-content"></div>';
    container = document.getElementById('markdown-content')!;

    writeText = vi.fn().mockResolvedValue(undefined);
    showContextMenu = vi.fn().mockResolvedValue(null);
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      assets: { resolve: vi.fn(() => null), resolvePath: vi.fn() },
      clipboard: { writeText },
      contextMenu: { show: showContextMenu },
    };

    viewer = createMarkdownViewer(container);
  });

  function checkboxes(): HTMLInputElement[] {
    return Array.from(container.querySelectorAll<HTMLInputElement>('input.task-list-checkbox'));
  }

  /** A real user click: the browser flips the box, then the handler runs. */
  function click(el: Element): void {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  }

  describe('task-list checkboxes', () => {
    const MD = '# Plan\n\n- [ ] one\n- [x] two\n  - [ ] nested\n- plain';

    it('are enabled after a render', async () => {
      await viewer.render(MD, FILE);
      expect(checkboxes()).toHaveLength(3);
      expect(checkboxes().every((box) => !box.disabled)).toBe(true);
    });

    it('report the toggled markdown and keep it as the current content', async () => {
      const onToggle = vi.fn();
      viewer.setOnTaskToggle(onToggle);
      await viewer.render(MD, FILE);

      click(checkboxes()[0]!);

      const expected = '# Plan\n\n- [x] one\n- [x] two\n  - [ ] nested\n- plain';
      expect(onToggle).toHaveBeenCalledWith(expected);
      expect(viewer.getState().content).toBe(expected);
      expect(viewer.getCurrentMarkdown()).toBe(expected);
    });

    it('uncheck as well as check, including nested items', async () => {
      const onToggle = vi.fn();
      viewer.setOnTaskToggle(onToggle);
      await viewer.render(MD, FILE);

      click(checkboxes()[1]!);
      expect(onToggle).toHaveBeenLastCalledWith('# Plan\n\n- [ ] one\n- [ ] two\n  - [ ] nested\n- plain');

      click(checkboxes()[2]!);
      expect(onToggle).toHaveBeenLastCalledWith('# Plan\n\n- [ ] one\n- [ ] two\n  - [x] nested\n- plain');
    });

    it('do not re-render the document', async () => {
      viewer.setOnTaskToggle(vi.fn());
      await viewer.render(MD, FILE);
      const before = container.querySelector('h1');

      click(checkboxes()[0]!);

      expect(container.querySelector('h1')).toBe(before);
      expect(checkboxes()[0]!.checked).toBe(true);
    });

    it('stay disabled when toggling is turned off, and come back when it is on', async () => {
      viewer.setInteractiveTaskLists(false);
      await viewer.render(MD, FILE);
      expect(checkboxes().every((box) => box.disabled)).toBe(true);

      viewer.setInteractiveTaskLists(true);
      expect(checkboxes().every((box) => !box.disabled)).toBe(true);

      viewer.setInteractiveTaskLists(false);
      expect(checkboxes().every((box) => box.disabled)).toBe(true);
    });

    it('do nothing while disabled', async () => {
      const onToggle = vi.fn();
      viewer.setOnTaskToggle(onToggle);
      viewer.setInteractiveTaskLists(false);
      await viewer.render(MD, FILE);

      // A disabled input gets no click from the browser; simulate the handler
      // being reached anyway and check it declines.
      checkboxes()[0]!.disabled = false;
      checkboxes()[0]!.disabled = true;
      click(checkboxes()[0]!);

      expect(onToggle).not.toHaveBeenCalled();
      expect(viewer.getState().content).toBe(MD);
    });

    it('are disabled in edit mode', async () => {
      await viewer.render(MD, FILE);
      await viewer.enterEditMode();
      expect(checkboxes().length).toBeGreaterThan(0);
      expect(checkboxes().every((box) => box.disabled)).toBe(true);

      await viewer.exitEditMode();
      expect(checkboxes().every((box) => !box.disabled)).toBe(true);
    });

    it('put the box back and warn when the line is no longer a task', async () => {
      const onToggle = vi.fn();
      viewer.setOnTaskToggle(onToggle);
      await viewer.render(MD, FILE);

      // The rendered view and the source have drifted apart
      checkboxes()[0]!.closest('li')!.setAttribute('data-source-lines', '0-1');
      click(checkboxes()[0]!);

      expect(onToggle).not.toHaveBeenCalled();
      expect(checkboxes()[0]!.checked).toBe(false);
      expect(document.querySelector('.toast-error')?.textContent).toContain('Could not find this task');
    });
  });

  describe('code block copy button', () => {
    const MD = 'Intro\n\n```ts\nconst a = 1;\nconst b = "<x>";\n```\n';

    it('copies the raw code without the trailing newline', async () => {
      await viewer.render(MD, FILE);
      const button = container.querySelector('.code-copy-btn')!;

      click(button);
      await Promise.resolve();

      expect(writeText).toHaveBeenCalledWith('const a = 1;\nconst b = "<x>";');
    });

    it('shows the copied state for a moment', async () => {
      vi.useFakeTimers();
      await viewer.render(MD, FILE);
      const block = container.querySelector('.code-block')!;

      click(block.querySelector('.code-copy-btn')!);
      await vi.advanceTimersByTimeAsync(0);
      expect(block.classList.contains('is-copied')).toBe(true);

      await vi.advanceTimersByTimeAsync(2000);
      expect(block.classList.contains('is-copied')).toBe(false);
      vi.useRealTimers();
    });

    it('copies the block holding the selection on request', async () => {
      await viewer.render(MD, FILE);
      const code = container.querySelector('.code-block code')!;
      vi.spyOn(window, 'getSelection').mockReturnValue({
        anchorNode: code.firstChild,
      } as unknown as Selection);

      expect(viewer.copyFocusedCodeBlock()).toBe(true);
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledWith('const a = 1;\nconst b = "<x>";');
    });

    it('reports when there is no code block to copy', async () => {
      await viewer.render('Just text', FILE);
      vi.spyOn(window, 'getSelection').mockReturnValue({ anchorNode: null } as unknown as Selection);

      expect(viewer.copyFocusedCodeBlock()).toBe(false);
      expect(writeText).not.toHaveBeenCalled();
    });
  });

  describe('heading context menu', () => {
    const MD = '# Title\n\ntext\n\n## Part\n\nmore';

    function rightClick(el: Element): MouseEvent {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      el.dispatchEvent(event);
      return event;
    }

    it('offers to copy the section and reports the choice with the source line', async () => {
      const onCopySection = vi.fn();
      viewer.setOnCopySection(onCopySection);
      showContextMenu.mockResolvedValue('copy-section-markdown');
      await viewer.render(MD, FILE);

      const h2 = container.querySelector('h2')!;
      const event = rightClick(h2);
      await vi.waitFor(() => expect(onCopySection).toHaveBeenCalled());

      expect(event.defaultPrevented).toBe(true);
      expect(showContextMenu).toHaveBeenCalledWith(
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({ id: 'copy-section-rich-text' }),
            expect.objectContaining({ id: 'copy-section-markdown' }),
          ]),
        })
      );
      expect(onCopySection).toHaveBeenCalledWith(h2, 4, 'markdown');
    });

    it('does nothing when the menu is dismissed', async () => {
      const onCopySection = vi.fn();
      viewer.setOnCopySection(onCopySection);
      showContextMenu.mockResolvedValue(null);
      await viewer.render(MD, FILE);

      rightClick(container.querySelector('h1')!);
      await vi.waitFor(() => expect(showContextMenu).toHaveBeenCalled());
      await Promise.resolve();

      expect(onCopySection).not.toHaveBeenCalled();
    });

    it('leaves the native menu alone when nobody handles section copies', async () => {
      await viewer.render(MD, FILE);
      const event = rightClick(container.querySelector('h1')!);
      await Promise.resolve();

      expect(event.defaultPrevented).toBe(false);
      expect(showContextMenu).not.toHaveBeenCalled();
    });
  });
});
