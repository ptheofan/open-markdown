/**
 * E2E Tests: following the OS appearance in System theme mode
 *
 * Mermaid bakes its light or dark palette into each SVG when it draws, so an
 * OS appearance change has to redraw the diagrams, not just swap the page's
 * CSS variables. The test flips `nativeTheme.themeSource` in the main
 * process, which fires nativeTheme's `updated` event the same way macOS does.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { test, expect } from '@playwright/test';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';

const MAIN = path.join(__dirname, '../../.vite/build/index.js');
const FIXTURE = path.join(__dirname, 'fixtures/test-mermaid.md');

/** The diagram's <style>, minus the per-render `#mermaid-…` ids */
async function mermaidStyle(page: Page): Promise<string> {
  const style = await page
    .locator('#markdown-content .mermaid-container svg style')
    .first()
    .textContent();
  return (style ?? '').replace(/#mermaid-[\w-]+/g, '#mermaid');
}

/** Which Mermaid palette the diagram was drawn with, from its node fill */
async function mermaidPalette(page: Page): Promise<'light' | 'dark' | 'unknown'> {
  const style = await mermaidStyle(page);
  if (style.includes('.node path{fill:#ECECFF;')) return 'light';
  if (style.includes('.node path{fill:#1f2020;')) return 'dark';
  return 'unknown';
}

/** Flip the OS appearance the way macOS does: nativeTheme emits `updated` */
async function setOsAppearance(
  electronApp: ElectronApplication,
  theme: 'light' | 'dark'
): Promise<void> {
  await electronApp.evaluate(({ nativeTheme }, source) => {
    nativeTheme.themeSource = source;
  }, theme);
  await expect.poll(() => isDark(electronApp)).toBe(theme === 'dark');
}

async function isDark(electronApp: ElectronApplication): Promise<boolean> {
  return electronApp.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors);
}

test.describe('System theme mode', () => {
  let userDataDir: string;
  let electronApp: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    // A fresh profile starts in System mode and leaves the real one alone
    userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'open-markdown-e2e-'));
    electronApp = await electron.launch({
      args: [MAIN, `--user-data-dir=${userDataDir}`],
      timeout: 30000,
    });
    const userData = await electronApp.evaluate(({ app }) => app.getPath('userData'));
    expect(await fs.realpath(userData)).toBe(await fs.realpath(userDataDir));

    await electronApp.firstWindow();
    const isRenderer = (p: Page): boolean => !p.url().startsWith('devtools://');
    await expect.poll(() => electronApp.windows().some(isRenderer)).toBe(true);
    page = electronApp.windows().find(isRenderer) as Page;
    await page.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    await electronApp?.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  });

  test('redraws Mermaid diagrams when the OS appearance changes', async () => {
    await electronApp.evaluate(({ app }, target) => {
      app.emit('open-file', { preventDefault: () => undefined }, target);
    }, FIXTURE);
    await expect(page.locator('#markdown-content .mermaid-container svg')).toHaveCount(1);

    // Let startup settle: the diagram ends up in the OS's current palette
    const initial = (await isDark(electronApp)) ? 'dark' : 'light';
    const other = initial === 'dark' ? 'light' : 'dark';
    await expect(page.locator('html')).toHaveAttribute('data-theme', initial);
    await expect.poll(() => mermaidPalette(page)).toBe(initial);

    await setOsAppearance(electronApp, other);
    await expect(page.locator('html')).toHaveAttribute('data-theme', other);
    await expect.poll(() => mermaidPalette(page)).toBe(other);

    await setOsAppearance(electronApp, initial);
    await expect(page.locator('html')).toHaveAttribute('data-theme', initial);
    await expect.poll(() => mermaidPalette(page)).toBe(initial);
  });
});
