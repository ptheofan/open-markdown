/**
 * Electron App Test Fixture
 *
 * Provides utilities for launching and interacting with the Electron app in E2E tests.
 */
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

    const app = await electron.launch({
      args: [mainPath],
      timeout: 30000,
    });

    await use(app);

    // Cleanup
    await app.close();
  },

  mainWindow: async ({ electronApp }, use) => {
    // Wait for the first window to open
    const window = await electronApp.firstWindow();

    // Wait for the app to be ready
    await window.waitForLoadState('domcontentloaded');

    await use(window);
  },
});

export { expect } from '@playwright/test';
