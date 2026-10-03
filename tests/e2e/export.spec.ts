/**
 * E2E Tests: export to PDF and HTML
 *
 * The app is launched with OPEN_MARKDOWN_E2E_EXPORT_DIR set, which makes the
 * export service write to that folder instead of asking where. The export
 * is driven the way the menu drives it, through the menu action channel.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { test as base, expect, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';

const FIXTURE = path.join(__dirname, '../../examples/llm-markdown.md');

const test = base.extend<{ exportDir: string; electronApp: ElectronApplication; mainWindow: Page }>({
  // eslint-disable-next-line no-empty-pattern
  exportDir: async ({}, use) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'open-markdown-export-e2e-'));
    await use(dir);
    await fs.rm(dir, { recursive: true, force: true });
  },
  electronApp: async ({ exportDir }, use) => {
    const app = await electron.launch({
      args: [path.join(__dirname, '../../.vite/build/index.js')],
      env: { ...process.env, OPEN_MARKDOWN_E2E_EXPORT_DIR: exportDir },
      timeout: 30000,
    });
    await use(app);
    await app.close();
  },
  mainWindow: async ({ electronApp }, use) => {
    await electronApp.firstWindow();
    const isRenderer = (page: Page): boolean => !page.url().startsWith('devtools://');
    let window = electronApp.windows().find(isRenderer);
    const deadline = Date.now() + 15000;
    while (!window && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      window = electronApp.windows().find(isRenderer);
    }
    if (!window) throw new Error('Renderer window never opened');
    await window.waitForLoadState('domcontentloaded');
    await use(window);
  },
});

async function openFixture(electronApp: ElectronApplication, mainWindow: Page): Promise<void> {
  await electronApp.evaluate(({ app }, target) => {
    app.emit('open-file', { preventDefault: () => undefined }, target);
  }, FIXTURE);
  await expect(mainWindow.locator('#markdown-content h1')).toHaveText('LLM markdown fixture');
  await expect(mainWindow.locator('#markdown-content .mermaid-container svg')).toHaveCount(1);
}

/** Send a menu action to the renderer, as the application menu does */
async function menuAction(electronApp: ElectronApplication, action: string): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, name) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().startsWith('devtools://'));
    win?.webContents.send('menu:action', name);
  }, action);
}

async function waitForFile(filePath: string): Promise<Buffer> {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const data = await fs.readFile(filePath);
      if (data.byteLength > 0) return data;
    } catch {
      // not yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${filePath} was not written`);
}

test.describe('Export', () => {
  test('writes a self-contained HTML file', async ({ electronApp, mainWindow, exportDir }) => {
    await openFixture(electronApp, mainWindow);

    await menuAction(electronApp, 'export-html');
    const dialog = mainWindow.locator('.export-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('select')).toHaveCount(1);
    await dialog.locator('[data-export-confirm]').click();

    await expect(mainWindow.locator('.toast')).toContainText('Saved to');
    const html = (await waitForFile(path.join(exportDir, 'llm-markdown.html'))).toString('utf8');

    expect(html.length).toBeGreaterThan(10_000);
    expect(html).toContain('<title>llm-markdown.md</title>');
    expect(html).toContain('LLM markdown fixture');
    expect(html).toContain('class="markdown-alert markdown-alert-note"');
    expect(html).toContain('class="katex"');
    expect(html).toContain('<svg');
    // Nothing fetched from the network for scripts, styles or fonts
    expect(html).not.toMatch(/<script/);
    expect(html).not.toMatch(/<link[^>]+href="https?:/);
    expect(html).not.toMatch(/url\(["']?(https?|file):/);
    expect(html).toContain('data:font/woff2;base64,');
    // App chrome is gone (its stylesheet rules may remain; the elements may not)
    expect(html).not.toMatch(/<button[^>]*code-copy-btn/);
    expect(html).not.toMatch(/<a[^>]*class="file-ref/);
  });

  test('writes a PDF', async ({ electronApp, mainWindow, exportDir }) => {
    await openFixture(electronApp, mainWindow);

    await menuAction(electronApp, 'export-pdf');
    const dialog = mainWindow.locator('.export-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('select')).toHaveCount(2);
    await dialog.locator('[data-export-confirm]').click();

    await expect(mainWindow.locator('.toast')).toContainText('Saved to', { timeout: 20000 });
    const pdf = await waitForFile(path.join(exportDir, 'llm-markdown.pdf'));
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.byteLength).toBeGreaterThan(20_000);
  });

  test('remembers the dialog choices', async ({ electronApp, mainWindow }) => {
    await openFixture(electronApp, mainWindow);

    await menuAction(electronApp, 'export-pdf');
    const dialog = mainWindow.locator('.export-dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('select').nth(1).selectOption('Letter');
    await dialog.locator('[data-export-cancel]').click();
    await expect(dialog).toHaveCount(0);

    // Cancelling keeps nothing; confirming does
    await menuAction(electronApp, 'export-pdf');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('select').nth(1)).toHaveValue('A4');
    await dialog.locator('select').nth(1).selectOption('Letter');
    await dialog.locator('[data-export-confirm]').click();
    await expect(mainWindow.locator('.toast')).toContainText('Saved to', { timeout: 20000 });

    await menuAction(electronApp, 'export-pdf');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('select').nth(1)).toHaveValue('Letter');
    await dialog.locator('[data-export-cancel]').click();
  });

  test('refuses without a document', async ({ electronApp, mainWindow }) => {
    // The renderer subscribes to menu actions as it initialises; wait for it
    await expect(mainWindow.locator('#drop-zone')).toBeVisible();
    await mainWindow.waitForFunction(() => document.getElementById('open-file-btn')?.hasAttribute('disabled') === false);
    await mainWindow.waitForTimeout(500);
    await menuAction(electronApp, 'export-html');
    await expect(mainWindow.locator('.toast')).toContainText('Open a document first');
    await expect(mainWindow.locator('.export-dialog')).toHaveCount(0);
  });
});
