/**
 * @vitest-environment jsdom
 *
 * The sidebar shows whichever of Files and Outline has something to show,
 * with tabs only when both do.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { createSidebar, SIDEBAR_MIN_WIDTH, type Sidebar } from '@renderer/components/Sidebar';

function build(): { sidebar: Sidebar; root: HTMLElement; tabs: HTMLElement; files: HTMLElement; outline: HTMLElement; viewer: HTMLElement } {
  document.body.innerHTML = `
    <aside id="sidebar" class="sidebar sidebar-hidden">
      <div id="sidebar-tabs" class="sidebar-tabs hidden">
        <button data-sidebar-tab="files">Files</button>
        <button data-sidebar-tab="outline">Outline</button>
      </div>
      <div id="folder-panel"></div>
      <aside id="outline-panel" class="outline-panel outline-panel-collapsed"></aside>
    </aside>
    <article id="markdown-viewer" class="hidden"></article>`;
  const root = document.getElementById('sidebar')!;
  const tabs = document.getElementById('sidebar-tabs')!;
  const files = document.getElementById('folder-panel')!;
  const outline = document.getElementById('outline-panel')!;
  const viewer = document.getElementById('markdown-viewer')!;
  const sidebar = createSidebar({ root, tabs, filesPane: files, outlinePane: outline, viewer });
  return { sidebar, root, tabs, files, outline, viewer };
}

async function observe(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

describe('Sidebar', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stays hidden with nothing to show and appears with a folder', () => {
    const { sidebar, root, tabs, files } = build();
    expect(sidebar.isVisible()).toBe(false);

    sidebar.setFilesAvailable(true);
    expect(sidebar.isVisible()).toBe(true);
    expect(root.getAttribute('aria-hidden')).toBe('false');
    expect(sidebar.getActiveTab()).toBe('files');
    expect(files.classList.contains('sidebar-pane-active')).toBe(true);
    expect(tabs.classList.contains('hidden')).toBe(true);
  });

  it('shows the outline on its own when the document has headings', async () => {
    const { sidebar, outline, viewer } = build();
    viewer.classList.remove('hidden');
    outline.classList.remove('outline-panel-collapsed');
    await observe();
    expect(sidebar.getActiveTab()).toBe('outline');
    expect(outline.classList.contains('sidebar-pane-active')).toBe(true);

    viewer.classList.add('hidden');
    await observe();
    expect(sidebar.isVisible()).toBe(false);
  });

  it('offers tabs when both are available and remembers the chosen one', async () => {
    const { sidebar, tabs, outline, viewer, files } = build();
    viewer.classList.remove('hidden');
    outline.classList.remove('outline-panel-collapsed');
    sidebar.setFilesAvailable(true);
    await observe();
    expect(tabs.classList.contains('hidden')).toBe(false);
    expect(sidebar.getActiveTab()).toBe('files');

    tabs.querySelector<HTMLElement>('[data-sidebar-tab="outline"]')!.click();
    expect(sidebar.getActiveTab()).toBe('outline');
    expect(tabs.querySelector('[data-sidebar-tab="outline"]')?.getAttribute('aria-selected')).toBe('true');
    expect(files.classList.contains('sidebar-pane-active')).toBe(false);

    // Headings gone: Files takes over; back again: Outline, as chosen
    outline.classList.add('outline-panel-collapsed');
    await observe();
    expect(sidebar.getActiveTab()).toBe('files');
    outline.classList.remove('outline-panel-collapsed');
    await observe();
    expect(sidebar.getActiveTab()).toBe('outline');
  });

  it('clamps and remembers its width', () => {
    const { sidebar, root } = build();
    sidebar.setWidth(10);
    expect(sidebar.getWidth()).toBe(SIDEBAR_MIN_WIDTH);
    sidebar.setWidth(300);
    expect(root.style.getPropertyValue('--sidebar-width')).toBe('300px');

    localStorage.setItem('sidebar-width', '320');
    const again = build();
    expect(again.sidebar.getWidth()).toBe(320);
  });
});
