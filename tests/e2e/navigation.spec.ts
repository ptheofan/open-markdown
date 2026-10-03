/**
 * E2E Tests: navigation
 *
 * Following a link between markdown files, going back to where the reader
 * was, the quick switcher, the lightbox and diagram zoom.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { test, expect } from './electron-app';
import type { ElectronApplication, Page } from '@playwright/test';

// A 2x2 red PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DwHwyBBBgDADJaB/l1v2GLAAAAAElFTkSuQmCC',
  'base64'
);

const LONG_TAIL = Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1} of the first document.`).join('\n\n');

const FIRST = [
  '# First',
  '',
  'Go to [the second document](./second.md#details) or [a missing one](./nowhere.md).',
  '',
  '![a picture](./pic.png)',
  '',
  '```mermaid',
  'flowchart LR',
  '  A --> B --> C',
  '```',
  '',
  LONG_TAIL,
  '',
  '## Bottom',
  '',
  'The end.',
].join('\n');

const SECOND = ['# Second', '', 'Intro.', '', ...Array.from({ length: 40 }, (_, i) => `Filler ${i}.\n`), '## Details', '', 'Here.'].join('\n');

async function openFile(electronApp: ElectronApplication, filePath: string): Promise<void> {
  await electronApp.evaluate(({ app }, target) => {
    app.emit('open-file', { preventDefault: () => undefined }, target);
  }, filePath);
}

async function menuAction(electronApp: ElectronApplication, action: string): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, name) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().startsWith('devtools://'));
    win?.webContents.send('menu:action', name);
  }, action);
}

async function scrollTop(mainWindow: Page): Promise<number> {
  return mainWindow.evaluate(() => document.getElementById('markdown-viewer')!.scrollTop);
}

test.describe('Navigation', () => {
  let dir: string;
  let first: string;

  test.beforeEach(async ({ electronApp, mainWindow }) => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'open-markdown-nav-'));
    first = path.join(dir, 'first.md');
    await fs.writeFile(first, FIRST, 'utf8');
    await fs.writeFile(path.join(dir, 'second.md'), SECOND, 'utf8');
    await fs.writeFile(path.join(dir, 'pic.png'), PNG);

    await openFile(electronApp, first);
    await expect(mainWindow.locator('#markdown-content h1')).toHaveText('First');
    await expect(mainWindow.locator('#markdown-content .mermaid-container svg')).toHaveCount(1);
    await mainWindow.waitForTimeout(600);
  });

  test.afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('follows a link to another file, then comes back to the same place', async ({ mainWindow }) => {
    const content = mainWindow.locator('#markdown-content');
    await expect(content.locator('a.local-link-broken')).toHaveCount(1);
    await expect(content.locator('a.local-link-broken')).toHaveAttribute('title', /Not found: .*nowhere\.md$/);

    // Scroll down a little before leaving
    await mainWindow.evaluate(() => {
      document.getElementById('markdown-viewer')!.scrollTop = 300;
    });
    const before = await scrollTop(mainWindow);
    expect(before).toBeGreaterThan(0);

    // dispatchEvent rather than click: a click scrolls the link into view first,
    // which would move the position this test is about
    await content.locator('a', { hasText: 'the second document' }).dispatchEvent('click');
    await expect(content.locator('h1')).toHaveText('Second');
    await expect(mainWindow.locator('#outline-panel')).toContainText('Details');
    await expect(mainWindow.locator('#nav-back-btn')).toBeEnabled();
    await expect(mainWindow.locator('#nav-forward-btn')).toBeDisabled();

    await mainWindow.locator('#nav-back-btn').click();
    await expect(content.locator('h1')).toHaveText('First');
    // Back where we were, give or take the browser's scroll anchoring as the
    // image above finishes loading
    await expect.poll(() => scrollTop(mainWindow)).toBeGreaterThan(before - 80);
    expect(Math.abs((await scrollTop(mainWindow)) - before)).toBeLessThan(80);
    await expect(mainWindow.locator('#nav-forward-btn')).toBeEnabled();

    await mainWindow.locator('#nav-forward-btn').click();
    await expect(content.locator('h1')).toHaveText('Second');
  });

  test('the quick switcher lists documents, filters and opens the selection', async ({
    electronApp,
    mainWindow,
  }) => {
    await menuAction(electronApp, 'quick-switch');
    const switcher = mainWindow.locator('.quick-switcher-visible');
    await expect(switcher).toBeVisible();
    await expect(switcher.locator('.quick-switcher-item')).not.toHaveCount(0);

    // first.md is open in this window (earlier runs may have left namesakes among the recent files)
    await expect(switcher.locator('.quick-switcher-item-open', { hasText: 'first.md' })).toHaveCount(1);
    await expect(switcher.locator('.quick-switcher-item-selected')).toContainText('first.md');
    await mainWindow.keyboard.type('zzzz-nothing');
    await expect(switcher.locator('.quick-switcher-empty')).toHaveText('No matching documents');
    await mainWindow.keyboard.press('Escape');
    await expect(switcher).toHaveCount(0);
  });

  test('clicking an image opens the lightbox, which zooms and closes', async ({ mainWindow }) => {
    await mainWindow.locator('#markdown-content img').click();
    const lightbox = mainWindow.locator('.lightbox');
    await expect(lightbox).toBeVisible();
    await expect(lightbox.locator('.lightbox-caption')).toHaveText('a picture');
    await expect(lightbox.locator('.lightbox-zoom')).toHaveText('100%');

    await mainWindow.keyboard.press('+');
    await expect(lightbox.locator('.lightbox-zoom')).toHaveText('125%');
    await mainWindow.keyboard.press('0');
    await expect(lightbox.locator('.lightbox-zoom')).toHaveText('100%');

    await mainWindow.keyboard.press('Escape');
    await expect(lightbox).toHaveCount(0);
  });

  test('a diagram zooms in place and opens large', async ({ mainWindow }) => {
    const diagram = mainWindow.locator('#markdown-content .mermaid-container');
    await diagram.hover();
    await diagram.locator('[data-diagram-zoom-in]').click();
    await expect(diagram).toHaveAttribute('data-diagram-zoom', '1.25');
    const transform = await diagram.locator('svg').evaluate((el) => (el as SVGElement).style.transform);
    expect(transform).toContain('scale(1.25)');

    await diagram.locator('[data-diagram-fit]').click();
    await expect(diagram).toHaveAttribute('data-diagram-zoom', '1.00');

    await diagram.locator('[data-diagram-expand]').click();
    const lightbox = mainWindow.locator('.lightbox');
    await expect(lightbox.locator('svg.lightbox-picture')).toHaveCount(1);
    await mainWindow.keyboard.press('Escape');
    await expect(lightbox).toHaveCount(0);
  });
});
