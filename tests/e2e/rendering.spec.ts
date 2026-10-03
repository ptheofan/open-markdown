/**
 * E2E Tests: rendering of LLM-style markdown
 *
 * Opens the fixture that exercises front matter, alerts, math, details,
 * nested fences, info strings, file references and footnotes, and checks
 * that each lands in the DOM the way the plugins promise. A screenshot of
 * the rendered page is attached to the report for eyeballing.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { test, expect } from './electron-app';
import type { ElectronApplication } from '@playwright/test';

const FIXTURE = path.join(__dirname, '../../examples/llm-markdown.md');

async function openFile(electronApp: ElectronApplication, filePath: string): Promise<void> {
  await electronApp.evaluate(({ app }, target) => {
    app.emit('open-file', { preventDefault: () => undefined }, target);
  }, filePath);
}

test.describe('LLM markdown rendering', () => {
  test.beforeEach(async ({ electronApp, mainWindow }) => {
    await fs.access(FIXTURE);
    await openFile(electronApp, FIXTURE);
    await expect(mainWindow.locator('#markdown-content h1')).toHaveText('LLM markdown fixture');
  });

  test('renders front matter as a collapsible table', async ({ mainWindow }) => {
    const details = mainWindow.locator('#markdown-content details.front-matter');
    await expect(details).toHaveCount(1);
    await expect(details).toHaveJSProperty('open', true);
    await expect(details.locator('th', { hasText: 'allowed-tools' })).toBeVisible();
    await expect(details.locator('.front-matter-list li')).toHaveCount(2);
    await expect(mainWindow.locator('#markdown-content > hr:not(.footnotes-sep)')).toHaveCount(0);
  });

  test('renders alerts with titles instead of quoted markers', async ({ mainWindow }) => {
    const content = mainWindow.locator('#markdown-content');
    await expect(content.locator('.markdown-alert')).toHaveCount(5);
    await expect(content.locator('.markdown-alert-warning .markdown-alert-title')).toHaveText('Warning');
    await expect(content.locator('.markdown-alert-warning p').nth(1)).toContainText('Urgent info');
    await expect(content.locator('.markdown-alert-caution li')).toHaveCount(2);
    await expect(content).not.toContainText('[!NOTE]');
  });

  test('renders math with KaTeX and leaves prices alone', async ({ mainWindow }) => {
    const content = mainWindow.locator('#markdown-content');
    await expect(content.locator('.math-inline .katex')).toHaveCount(2);
    await expect(content.locator('.math-block .katex-display')).toHaveCount(2);
    await expect(content).toContainText('this costs $5 and that costs $10');

    // KaTeX fonts ship with the app: at least one is loaded, from a local URL
    const fonts = await mainWindow.evaluate(async () => {
      await document.fonts.ready;
      return Array.from(document.fonts).filter((f) => f.family.startsWith('KaTeX')).map((f) => f.status);
    });
    expect(fonts.length).toBeGreaterThan(0);
  });

  test('renders details, nested fences and info strings', async ({ mainWindow }) => {
    const content = mainWindow.locator('#markdown-content');

    const details = content.locator('details:not(.front-matter)');
    await expect(details).toHaveCount(1);
    await expect(details.locator('li')).toHaveCount(2);

    // Each outer fence is one block holding the inner fence as text
    const nested = content.locator('.code-block[data-lang="md"]');
    await expect(nested).toHaveCount(1);
    await expect(nested.locator('code')).toContainText('```js');

    const titled = content.locator('.code-block[data-title="src/app.ts"]');
    await expect(titled).toHaveAttribute('data-lang', 'ts');
    await expect(titled.locator('.code-line-highlighted')).toHaveCount(2);
    await expect(content.locator('.code-block[data-title="setup.sh"]')).toHaveCount(1);

    const diff = content.locator('.code-block[data-lang="diff"]');
    await expect(diff.locator('.code-line-addition')).toHaveCount(1);
    await expect(diff.locator('.code-line-deletion')).toHaveCount(1);

    // A titled mermaid fence is still a diagram
    await expect(content.locator('.mermaid-container')).toHaveCount(1);
  });

  test('links file references that exist and flattens the ones that do not', async ({ mainWindow }) => {
    const content = mainWindow.locator('#markdown-content');
    const resolved = content.locator('a.file-ref[data-file-ref="src/renderer.ts"]');
    await expect(resolved).toHaveAttribute('data-file-path', /src\/renderer\.ts$/);
    await expect(resolved).toHaveAttribute('data-file-line', '120');

    await expect(content.locator('a.file-ref[data-file-ref="README.md"]')).toHaveAttribute('data-file-path', /README\.md$/);
    await expect(content.locator('a.file-ref[data-file-ref="path/does/not/exist.ts"]')).toHaveClass(/file-ref-unresolved/);
    await expect(content.locator('a.file-ref[data-file-ref="src/index.css"]')).toHaveAttribute('data-file-line', '10');
    await expect(content.locator('a.file-ref', { hasText: 'array.map' })).toHaveCount(0);
  });

  test('renders footnotes with back links', async ({ mainWindow }) => {
    const content = mainWindow.locator('#markdown-content');
    await expect(content.locator('.footnote-ref')).toHaveCount(2);
    await expect(content.locator('section.footnotes li')).toHaveCount(2);
    await expect(content.locator('.footnote-backref')).toHaveCount(2);
  });

  test('looks right end to end', async ({ mainWindow }, testInfo) => {
    const screenshot = await mainWindow.screenshot({ fullPage: true });
    await testInfo.attach('llm-markdown', { body: screenshot, contentType: 'image/png' });
    expect(screenshot.byteLength).toBeGreaterThan(10_000);
  });
});
