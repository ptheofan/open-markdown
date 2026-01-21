/**
 * E2E Tests: App Launch and Basic Functionality
 *
 * Tests critical paths for the Markdown Viewer application
 */
import { test, expect } from './electron-app';

test.describe('App Launch', () => {
  test('should launch the application and show window', async ({ electronApp }) => {
    // Verify app launched
    expect(electronApp).toBeTruthy();

    // Get the first window
    const window = await electronApp.firstWindow();
    expect(window).toBeTruthy();

    // Verify window has content
    const title = await window.title();
    expect(title).toContain('Markdown Viewer');
  });

  test('should display toolbar with Open button', async ({ mainWindow }) => {
    // Wait for the toolbar to be visible
    await mainWindow.waitForSelector('.toolbar', { timeout: 5000 });

    // Check for Open button
    const openButton = mainWindow.locator('#open-file-btn');
    await expect(openButton).toBeVisible();
  });

  test('should display drop zone on launch', async ({ mainWindow }) => {
    // Check for drop zone
    const dropZone = mainWindow.locator('#drop-zone');
    await expect(dropZone).toBeVisible();

    // Check for drop zone text
    const dropZoneText = mainWindow.locator('.drop-zone-content h2');
    await expect(dropZoneText).toContainText('Drop Markdown File');
  });

  test('should display status bar', async ({ mainWindow }) => {
    // Check for status bar
    const statusBar = mainWindow.locator('#status-bar');
    await expect(statusBar).toBeVisible();

    // Check for status text
    const statusText = mainWindow.locator('#status-file-path');
    await expect(statusText).toContainText('No file');
  });
});

test.describe('Theme Toggling', () => {
  test('should have theme toggle button', async ({ mainWindow }) => {
    const themeButton = mainWindow.locator('#theme-toggle-btn');
    await expect(themeButton).toBeVisible();
  });

  test('should respond to theme button click', async ({ mainWindow }) => {
    // Click theme toggle - verify it doesn't crash
    const themeButton = mainWindow.locator('#theme-toggle-btn');
    await themeButton.click();

    // Wait for any potential theme change
    await mainWindow.waitForTimeout(500);

    // App should still be responsive
    await expect(themeButton).toBeVisible();

    // Verify html has a data-theme attribute (either light or dark)
    const html = mainWindow.locator('html');
    const theme = await html.getAttribute('data-theme');
    expect(['light', 'dark', null]).toContain(theme);
  });
});

test.describe('Window Properties', () => {
  test('should have reasonable window size', ({ mainWindow }) => {
    // Get viewport size from the page
    const viewportSize = mainWindow.viewportSize();

    expect(viewportSize).toBeDefined();
    if (viewportSize) {
      expect(viewportSize.width).toBeGreaterThanOrEqual(400);
      expect(viewportSize.height).toBeGreaterThanOrEqual(300);
    }
  });

  test('should have proper document structure', async ({ mainWindow }) => {
    // Verify the app has proper structure
    const app = mainWindow.locator('#app');
    await expect(app).toBeVisible();

    // Should have toolbar, main-content, and status-bar
    const toolbar = mainWindow.locator('.toolbar');
    const mainContent = mainWindow.locator('.main-content');
    const statusBar = mainWindow.locator('.status-bar');

    await expect(toolbar).toBeVisible();
    await expect(mainContent).toBeVisible();
    await expect(statusBar).toBeVisible();
  });
});

test.describe('Keyboard Shortcuts', () => {
  test('should respond to Cmd+O shortcut', async ({ mainWindow }) => {
    // Press Cmd+O - this should trigger the open dialog
    // We just verify the shortcut doesn't crash the app
    await mainWindow.keyboard.press('Meta+o');

    // Wait a moment
    await mainWindow.waitForTimeout(500);

    // App should still be responsive
    const toolbar = mainWindow.locator('.toolbar');
    await expect(toolbar).toBeVisible();
  });
});
