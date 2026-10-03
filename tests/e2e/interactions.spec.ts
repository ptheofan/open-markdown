/**
 * E2E Tests: document interactions
 *
 * Clicking a task-list checkbox writes the toggle to the file without
 * re-rendering the view; the copy button on a code block puts the raw code on
 * the clipboard; Copy as Rich Text puts HTML and the markdown on it.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { test, expect } from './electron-app';
import type { ElectronApplication } from '@playwright/test';

const DOCUMENT = [
  '# Plan',
  '',
  '- [ ] first',
  '- [x] second',
  '',
  '```ts',
  'const answer = 42;',
  '```',
  '',
].join('\n');

/** Open a file the way the OS would, through the app's open-file event. */
async function openFile(electronApp: ElectronApplication, filePath: string): Promise<void> {
  await electronApp.evaluate(({ app }, target) => {
    app.emit('open-file', { preventDefault: () => undefined }, target);
  }, filePath);
}

async function readClipboard(electronApp: ElectronApplication): Promise<{ text: string; html: string }> {
  return electronApp.evaluate(({ clipboard }) => ({
    text: clipboard.readText(),
    html: clipboard.readHTML(),
  }));
}

async function waitForFile(filePath: string, predicate: (content: string) => boolean): Promise<string> {
  const deadline = Date.now() + 5000;
  let content = '';
  while (Date.now() < deadline) {
    content = await fs.readFile(filePath, 'utf8');
    if (predicate(content)) return content;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return content;
}

test.describe('Document interactions', () => {
  let dir: string;
  let filePath: string;

  test.beforeEach(async ({ electronApp, mainWindow }) => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'open-markdown-e2e-'));
    filePath = path.join(dir, 'plan.md');
    await fs.writeFile(filePath, DOCUMENT, 'utf8');

    await openFile(electronApp, filePath);
    await expect(mainWindow.locator('#markdown-content h1')).toHaveText('Plan');
    // Startup applies the theme on a short debounce and re-renders the document
    // once it fires; let that pass so it is not mistaken for a re-render below.
    await mainWindow.waitForTimeout(600);
  });

  test.afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('clicking a checkbox toggles the marker in the file without re-rendering', async ({
    mainWindow,
  }) => {
    const boxes = mainWindow.locator('#markdown-content input.task-list-checkbox');
    await expect(boxes).toHaveCount(2);
    await expect(boxes.first()).toBeEnabled();
    await expect(boxes.first()).not.toBeChecked();

    // Tag the rendered heading so a re-render would be visible as its loss
    await mainWindow.evaluate(() => {
      document.querySelector('#markdown-content h1')?.setAttribute('data-e2e-marker', 'kept');
    });

    await boxes.first().click();
    await expect(boxes.first()).toBeChecked();

    const content = await waitForFile(filePath, (c) => c.includes('- [x] first'));
    expect(content).toBe(DOCUMENT.replace('- [ ] first', '- [x] first'));

    // Let the file watcher report the change back; the view must not flinch
    await mainWindow.waitForTimeout(1500);
    await expect(mainWindow.locator('#markdown-content h1[data-e2e-marker="kept"]')).toHaveCount(1);
    await expect(boxes.first()).toBeChecked();

    // And back again
    await boxes.nth(1).click();
    const reverted = await waitForFile(filePath, (c) => c.includes('- [ ] second'));
    expect(reverted).toContain('- [x] first\n- [ ] second');
  });

  test('the copy button puts the raw code on the clipboard', async ({ electronApp, mainWindow }) => {
    const block = mainWindow.locator('#markdown-content .code-block');
    await expect(block).toHaveAttribute('data-lang', 'ts');

    await block.hover();
    await block.locator('.code-copy-btn').click();

    await expect(block).toHaveClass(/is-copied/);
    const { text } = await readClipboard(electronApp);
    expect(text).toBe('const answer = 42;');
  });

  test('Copy as Rich Text puts HTML and the markdown on the clipboard', async ({
    electronApp,
    mainWindow,
  }) => {
    await mainWindow.locator('#copy-dropdown-btn').click();
    await mainWindow.locator('[data-copy-type="rich-text"]').click();

    await expect(mainWindow.locator('.toast')).toContainText('copied as rich text');
    const { text, html } = await readClipboard(electronApp);
    expect(text).toBe(DOCUMENT);
    expect(html).toContain('Plan');
    // Highlighting wraps tokens in spans, so match on a word rather than the line
    expect(html).toContain('answer');
    expect(html).not.toContain('<button');
  });
});
