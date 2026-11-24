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
    // The dev build opens DevTools (WindowManager, `if (IS_DEV)`), and that
    // window can win the race for firstWindow() — which lands every test on a
    // page titled "DevTools" instead of the renderer. Pick by URL, not by order.
    await electronApp.firstWindow();

    const isRenderer = (page: Page): boolean =>
      !page.url().startsWith('devtools://');

    let window = electronApp.windows().find(isRenderer);
    const deadline = Date.now() + 15000;
    while (!window && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      window = electronApp.windows().find(isRenderer);
    }
    if (!window) {
      throw new Error('Renderer window never opened (only DevTools was found)');
    }

    // Wait for the app to be ready
    await window.waitForLoadState('domcontentloaded');

    await use(window);
  },
});

export { expect } from '@playwright/test';
