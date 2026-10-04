/**
 * E2E Tests: table editor
 *
 * In edit mode a table is edited cell by cell: type into a cell, add a
 * column, delete a row, change an alignment, then leave edit mode and find
 * the file on disk rewritten as an aligned pipe table.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { test, expect } from './electron-app';
import type { ElectronApplication } from '@playwright/test';

const DOC = [
  '# Fruit',
  '',
  'Intro paragraph.',
  '',
  '| Name | Qty | Note |',
  '| --- | ---: | --- |',
  '| Apple | 3 | crisp |',
  '| Pear | 10 | soft |',
  '',
  'After the table.',
  '',
].join('\n');

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

test.describe('Table editor', () => {
  let dir: string;
  let file: string;

  test.beforeEach(async ({ electronApp, mainWindow }) => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'open-markdown-table-'));
    file = path.join(dir, 'fruit.md');
    await fs.writeFile(file, DOC, 'utf8');
    await openFile(electronApp, file);
    await expect(mainWindow.locator('#markdown-content h1')).toHaveText('Fruit');
    await mainWindow.waitForTimeout(600);
  });

  test.afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('edits cells in place and writes an aligned table back to disk', async ({ electronApp, mainWindow }) => {
    await menuAction(electronApp, 'toggle-edit-mode');
    const content = mainWindow.locator('#markdown-content');
    await expect(content.locator('.slice')).toHaveCount(4);

    // Click a body cell: that cell, not a textarea, becomes editable
    const table = content.locator('.slice-table');
    await table.locator('tbody tr').nth(0).locator('td').nth(0).click();
    await expect(content.locator('textarea')).toHaveCount(0);
    const editing = table.locator('[contenteditable="true"]');
    await expect(editing).toHaveCount(1);
    await expect(editing).toHaveText('Apple');

    await mainWindow.keyboard.press('End');
    await mainWindow.keyboard.type(' Fuji');
    await mainWindow.keyboard.press('Tab');
    await expect(table.locator('[contenteditable="true"]')).toHaveText('3');
    await expect(table.locator('tbody tr').nth(0).locator('td').nth(0)).toHaveText('Apple Fuji');

    // A column on the right, via the column handle's menu
    await table.locator('.table-column-handle[data-col="2"]').click();
    await table.locator('.table-menu [data-action="col-insert-right"]').click();
    await expect(table.locator('thead th')).toHaveCount(4);
    await mainWindow.keyboard.type('Price');

    // Right-align it
    await table.locator('.table-column-handle[data-col="3"]').click();
    await table.locator('.table-menu [data-action="align-right"]').click();
    await expect(table.locator('thead th').nth(3)).toHaveAttribute('style', /text-align:right/);

    // Delete the second row
    await table.locator('.table-row-handle[data-row="1"]').click();
    await table.locator('.table-menu [data-action="row-delete"]').click();
    await expect(table.locator('tbody tr')).toHaveCount(1);

    // Leave edit mode: the file is saved
    await menuAction(electronApp, 'toggle-edit-mode');
    await expect(content.locator('.slice')).toHaveCount(0);
    await expect(content.locator('table thead th')).toHaveCount(4);
    await expect(content.locator('table tbody tr')).toHaveCount(1);
    await expect(content.locator('h1')).toHaveText('Fruit');
    await expect(content.locator('p').last()).toHaveText('After the table.');

    await expect
      .poll(async () => fs.readFile(file, 'utf8'))
      .toBe(
        [
          '# Fruit',
          '',
          'Intro paragraph.',
          '',
          '| Name       | Qty | Note  | Price |',
          '| ---------- | --: | ----- | ----: |',
          '| Apple Fuji |   3 | crisp |       |',
          '',
          'After the table.',
          '',
        ].join('\n')
      );
  });

  test('Enter moves down and adds a row at the bottom; Cmd+/ shows the markdown', async ({ electronApp, mainWindow }) => {
    await menuAction(electronApp, 'toggle-edit-mode');
    const table = mainWindow.locator('#markdown-content .slice-table');
    await table.locator('tbody tr').nth(1).locator('td').nth(2).click();
    await expect(table.locator('[contenteditable="true"]')).toHaveText('soft');
    await mainWindow.keyboard.press('Enter');
    await expect(table.locator('tbody tr')).toHaveCount(3);
    await mainWindow.keyboard.type('new');
    await expect(table.locator('tbody tr').nth(2).locator('td').nth(2)).toHaveText('new');

    await mainWindow.keyboard.press('Control+/');
    const textarea = table.locator('textarea.slice-raw-editor');
    await expect(textarea).toHaveCount(1);
    await expect(textarea).toHaveValue(/\| Pear {2}\| {2}10 \| soft {2}\|\n\| {7}\| {5}\| new {3}\|$/);
    await mainWindow.keyboard.press('Escape');
    await menuAction(electronApp, 'toggle-edit-mode');
    await expect(mainWindow.locator('#markdown-content .slice')).toHaveCount(0);
  });
});
