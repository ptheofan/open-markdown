/**
 * E2E Tests: folder sidebar
 *
 * Opening a folder lists its markdown files as a tree, opens its README,
 * follows the document on screen, filters by name, notices new files and
 * closes again.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { test, expect } from './electron-app';
import type { ElectronApplication } from '@playwright/test';

async function openPath(electronApp: ElectronApplication, target: string): Promise<void> {
  await electronApp.evaluate(({ app }, p) => {
    app.emit('open-file', { preventDefault: () => undefined }, p);
  }, target);
}

async function menuAction(electronApp: ElectronApplication, action: string): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, name) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().startsWith('devtools://'));
    win?.webContents.send('menu:action', name);
  }, action);
}

test.describe('Folder sidebar', () => {
  let dir: string;

  test.beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'open-markdown-folder-'));
    await fs.writeFile(path.join(dir, 'README.md'), '# Readme\n\n## Start\n\nHello.\n', 'utf8');
    await fs.writeFile(path.join(dir, 'notes.md'), '# Notes\n', 'utf8');
    await fs.writeFile(path.join(dir, 'picture.png'), '', 'utf8');
    await fs.writeFile(path.join(dir, '.gitignore'), 'drafts/\n', 'utf8');
    await fs.mkdir(path.join(dir, 'docs', 'api'), { recursive: true });
    await fs.writeFile(path.join(dir, 'docs', 'guide.md'), '# Guide\n\nRead me.\n', 'utf8');
    await fs.writeFile(path.join(dir, 'docs', 'api', 'index.md'), '# API\n', 'utf8');
    await fs.mkdir(path.join(dir, 'node_modules'), { recursive: true });
    await fs.writeFile(path.join(dir, 'node_modules', 'dep.md'), '# Dep\n', 'utf8');
    await fs.mkdir(path.join(dir, 'drafts'), { recursive: true });
    await fs.writeFile(path.join(dir, 'drafts', 'secret.md'), '# Secret\n', 'utf8');
  });

  test.afterEach(async ({ electronApp }) => {
    // Leave nothing behind for the next launch to restore
    await menuAction(electronApp, 'close-folder');
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('lists the folder, opens its README and follows clicks', async ({ electronApp, mainWindow }) => {
    await openPath(electronApp, dir);

    const sidebar = mainWindow.locator('#sidebar');
    await expect(sidebar).toBeVisible();
    await expect(sidebar.locator('.folder-title')).toHaveText(path.basename(dir));

    const rows = sidebar.locator('.folder-item .folder-item-name');
    await expect(rows).toHaveText(['docs', 'notes.md', 'README.md']);

    // The README opened on its own and is the highlighted row
    await expect(mainWindow.locator('#markdown-content h1')).toHaveText('Readme');
    await expect(sidebar.locator('.folder-item-current .folder-item-name')).toHaveText('README.md');

    // Both panes have something to show, so the tabs appear
    await expect(sidebar.locator('#sidebar-tabs')).toBeVisible();
    await sidebar.locator('[data-sidebar-tab="outline"]').click();
    await expect(sidebar.locator('#outline-panel')).toBeVisible();
    await expect(sidebar.locator('#outline-panel')).toContainText('Start');
    await sidebar.locator('[data-sidebar-tab="files"]').click();

    // Folders load when expanded; a click on a file opens it
    await sidebar.locator('.folder-item[data-kind="directory"]', { hasText: 'docs' }).click();
    await expect(rows).toHaveText(['docs', 'api', 'guide.md', 'notes.md', 'README.md']);
    await sidebar.locator('.folder-item', { hasText: 'guide.md' }).click();
    await expect(mainWindow.locator('#markdown-content h1')).toHaveText('Guide');
    await expect(sidebar.locator('.folder-item-current .folder-item-name')).toHaveText('guide.md');
    await expect(mainWindow.locator('#nav-back-btn')).toBeEnabled();

    // The filter searches the whole folder
    await sidebar.locator('.folder-filter').fill('ind');
    await expect(rows).toHaveText(['index.md']);
    await expect(sidebar.locator('.folder-item-path')).toHaveText('docs/api');
    await sidebar.locator('.folder-filter').fill('');
    await expect(rows).toHaveText(['docs', 'api', 'guide.md', 'notes.md', 'README.md']);

    // A file written into the folder shows up on its own
    await fs.writeFile(path.join(dir, 'later.md'), '# Later\n', 'utf8');
    await expect(rows).toHaveText(['docs', 'api', 'guide.md', 'later.md', 'notes.md', 'README.md'], {
      timeout: 10_000,
    });

    // Close: the document stays, the sidebar keeps only the outline
    await menuAction(electronApp, 'close-folder');
    await expect(sidebar.locator('.folder-item')).toHaveCount(0);
    await expect(sidebar.locator('#sidebar-tabs')).toBeHidden();
    await expect(mainWindow.locator('#markdown-content h1')).toHaveText('Guide');
  });

  test('shows other files behind the toggle and walks with the keyboard', async ({ electronApp, mainWindow }) => {
    await openPath(electronApp, dir);
    const sidebar = mainWindow.locator('#sidebar');
    const rows = sidebar.locator('.folder-item .folder-item-name');
    await expect(rows).toHaveText(['docs', 'notes.md', 'README.md']);

    await sidebar.locator('[data-folder-toggle-all]').click();
    await expect(rows).toHaveText(['docs', '.gitignore', 'notes.md', 'picture.png', 'README.md']);
    await sidebar.locator('[data-folder-toggle-all]').click();
    await expect(rows).toHaveText(['docs', 'notes.md', 'README.md']);

    await menuAction(electronApp, 'focus-files');
    await expect(sidebar.locator('.folder-filter')).toBeFocused();
    // The cursor starts on the document on screen (README, the last row)
    await expect(sidebar.locator('.folder-item-selected .folder-item-name')).toHaveText('README.md');
    await mainWindow.keyboard.press('ArrowUp');
    await expect(sidebar.locator('.folder-item-selected .folder-item-name')).toHaveText('notes.md');
    await mainWindow.keyboard.press('Enter');
    await expect(mainWindow.locator('#markdown-content h1')).toHaveText('Notes');
  });
});
