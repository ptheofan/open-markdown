/**
 * E2E Tests: Select All scoping
 *
 * Cmd+A uses Electron's native `selectAll` role, which dispatches Blink's
 * SelectAll command across the whole document. The app chrome (toolbar and
 * status bar) lives in the same document as the rendered markdown, so without
 * `user-select: none` on the chrome its text is selected and copied too.
 *
 * These tests drive the same Blink command the menu role dispatches and assert
 * on the serialized selection.
 */
import { test, expect } from './electron-app';

const SAMPLE_MARKDOWN_HTML = '<h1>Sample Heading</h1><p>Body paragraph text.</p>';

/**
 * Render known content into the viewer, then run Blink's SelectAll and return
 * the serialized selection.
 */
async function selectAllText(mainWindow: import('@playwright/test').Page): Promise<string> {
  return mainWindow.evaluate((html) => {
    const viewer = document.getElementById('markdown-viewer');
    const content = document.getElementById('markdown-content');
    if (!viewer || !content) throw new Error('viewer elements not found');

    viewer.classList.remove('hidden');
    document.getElementById('drop-zone')?.classList.add('hidden');
    content.innerHTML = html;

    window.getSelection()?.removeAllRanges();
    document.execCommand('selectAll');

    return window.getSelection()?.toString() ?? '';
  }, SAMPLE_MARKDOWN_HTML);
}

test.describe('Select All', () => {
  test('selects the markdown document content', async ({ mainWindow }) => {
    await mainWindow.waitForSelector('.toolbar', { timeout: 5000 });
    const selection = await selectAllText(mainWindow);

    expect(selection).toContain('Sample Heading');
    expect(selection).toContain('Body paragraph text.');
  });

  test('does not select status bar text', async ({ mainWindow }) => {
    await mainWindow.waitForSelector('.status-bar', { timeout: 5000 });
    const selection = await selectAllText(mainWindow);

    expect(selection).not.toContain('Not watching');
    expect(selection).not.toContain('No file');
    expect(selection).not.toContain('100%');
  });

  test('does not select toolbar text', async ({ mainWindow }) => {
    await mainWindow.waitForSelector('.toolbar', { timeout: 5000 });
    const selection = await selectAllText(mainWindow);

    // "Open" and "Edit" are toolbar button labels
    expect(selection).not.toContain('Open');
    expect(selection).not.toContain('Edit');
  });
});
