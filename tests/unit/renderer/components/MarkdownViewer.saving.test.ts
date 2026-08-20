/**
 * @vitest-environment jsdom
 *
 * Reading the document for a save, while the user is still typing.
 *
 * Saving happens straight from an open editor: the user types and hits Save
 * without clicking away first. The typed text only reaches the markdown model
 * when the editor commits, so reading before that yields the document as it
 * was BEFORE the last edit. What made this silent rather than obvious is that
 * closing the editor commits anyway -- so the view shows the edit, the user
 * believes it saved, and it is gone when the file is reopened.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMarkdownViewer, type MarkdownViewer } from '@renderer/components/MarkdownViewer';

describe('MarkdownViewer — reading content mid-edit', () => {
  let container: HTMLElement;
  let viewer: MarkdownViewer;

  beforeEach(() => {
    document.body.innerHTML = '<div id="markdown-content"></div>';
    container = document.getElementById('markdown-content')!;
    viewer = createMarkdownViewer(container);
  });

  /** Type into the first slice without committing, as a focused editor holds it. */
  async function typeIntoOpenEditor(text: string): Promise<void> {
    const content = container.querySelector<HTMLElement>('.slice-content');
    if (!content) throw new Error('no editable slice found');
    content.click();
    content.textContent = text;
    await Promise.resolve();
  }

  it('returns text still sitting in an open editor', async () => {
    await viewer.render('# Title', '/docs/a.md');
    await viewer.enterEditMode();
    await typeIntoOpenEditor('New Title');

    expect(viewer.getCurrentMarkdown()).toBe('# New Title');
  });

  it('reports the document dirty for an edit that was never committed', async () => {
    let changed: string | null = null;
    await viewer.render('# Title', '/docs/a.md');
    await viewer.enterEditMode({ onContentChange: (md) => { changed = md; } });
    await typeIntoOpenEditor('New Title');

    // A save guarded on "is it dirty?" must be told before it decides.
    viewer.flushPendingEdits();
    expect(changed).toBe('# New Title');
  });

  it('is unaffected outside edit mode', async () => {
    await viewer.render('# Title', '/docs/a.md');
    expect(() => viewer.flushPendingEdits()).not.toThrow();
    expect(viewer.getCurrentMarkdown()).toBe('# Title');
  });
});
