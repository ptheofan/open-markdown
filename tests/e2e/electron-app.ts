/**
 * Electron App Test Fixture
 *
 * Provides utilities for launching and interacting with the Electron app in E2E tests.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { test as base, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';

// Extend the base test with Electron app fixture
export const test = base.extend<{
  electronApp: ElectronApplication;
  mainWindow: Page;
}>({
  // eslint-disable-next-line no-empty-pattern
  electronApp: async ({}, use) => {
    // Launch Electron using the development build
    const mainPath = path.join(__dirname, '../../.vite/build/index.js');
    // A throwaway profile per test: prefs a test saves must not leak into the next run
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'open-markdown-e2e-'));

    const app = await electron.launch({
      args: [mainPath, `--user-data-dir=${userDataDir}`],
      timeout: 30000,
    });

    await use(app);

    // Cleanup
    await app.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  },

  mainWindow: async ({ electronApp }, use) => {
    await use(await rendererWindow(electronApp));
  },
});

/**
 * The app's renderer window, loaded. The dev build opens DevTools
 * (WindowManager, `if (IS_DEV)`), and that window can win the race for
 * firstWindow(), so pick by URL, not by order. And since Electron 45
 * firstWindow() can hand back the window while it is still on its blank
 * initial page: domcontentloaded fires for that, then loading index.html
 * destroys the context under the test. So wait for a real URL first.
 */
export async function rendererWindow(electronApp: ElectronApplication): Promise<Page> {
  await electronApp.firstWindow();

  const isRenderer = (page: Page): boolean => /^(file|https?):/.test(page.url());

  let window = electronApp.windows().find(isRenderer);
  const deadline = Date.now() + 15000;
  while (!window && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    window = electronApp.windows().find(isRenderer);
  }
  if (!window) {
    throw new Error('Renderer window never opened (only DevTools or a blank page was found)');
  }

  await window.waitForLoadState('domcontentloaded');
  return window;
}

export { expect } from '@playwright/test';
