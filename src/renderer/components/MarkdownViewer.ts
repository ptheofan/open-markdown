/**
 * MarkdownViewer - Component for rendering and displaying markdown content
 */
import {
  PluginManager,
  createPluginManager,
  createGithubFlavoredPlugin,
  createSyntaxHighlightPlugin,
  createMermaidPlugin,
  createMathPlugin,
  createFrontMatterPlugin,
  createFileReferencePlugin,
  MermaidPlugin,
} from '@plugins/index';
import { BUILTIN_PLUGINS, MARKDOWN_EXTENSIONS } from '@shared/constants';
import { toggleTaskAtLine } from '@shared/markdown/taskList';
import { Toast } from './Toast';

import { EditModeController, createEditModeController } from './EditModeController';
import type { EditModeCallbacks } from './EditModeController';

import { rewriteAssetPaths } from '../utils/assetPaths';

import type {
  MarkdownPlugin,
  ContextMenuData,
  PluginPreferencesSchema,
} from '@shared/types';
import type { PluginThemeDeclaration } from '../../themes/types';

/**
 * State for the markdown viewer
 */
export interface MarkdownViewerState {
  content: string;
  filePath: string | null;
  isRendering: boolean;
}

/** Formats a section can be copied in from a heading's context menu */
export type SectionCopyFormat = 'rich-text' | 'markdown';

/** How long the copy button shows its check mark after a copy */
const COPIED_FEEDBACK_MS = 1500;

/**
 * The 0-based source line a rendered block starts on, from the
 * `data-source-lines="start-end"` the renderer stamps on every block, or
 * null when the element carries none.
 */
function sourceStartLine(element: Element | null | undefined): number | null {
  const attr = element?.getAttribute('data-source-lines');
  if (!attr) return null;
  const start = Number(attr.split('-')[0]);
  return Number.isInteger(start) && start >= 0 ? start : null;
}

/**
 * MarkdownViewer component
 */
export class MarkdownViewer {
  private container: HTMLElement;
  private pluginManager: PluginManager;
  private state: MarkdownViewerState = {
    content: '',
    filePath: null,
    isRendering: false,
  };
  private initialized = false;
  private highlightedElement: HTMLElement | null = null;
  private toast: Toast;
  private editModeController: EditModeController | null = null;
  private isEditMode = false;
  private onOpenLocalFile:
    | ((filePath: string, fragment: string | null) => void)
    | null = null;
  /** Whether task-list checkboxes toggle their marker in the source */
  private interactiveTaskLists = true;
  private onTaskToggle: ((markdown: string) => void) | null = null;
  private onCopySection:
    | ((heading: HTMLElement, sourceLine: number, format: SectionCopyFormat) => void)
    | null = null;
  private onOpenFileReference:
    | ((filePath: string, line: number | null, column: number | null) => void)
    | null = null;
  private onFrontMatterToggle: ((expanded: boolean) => void) | null = null;
  /** Bumped per render, so a slow reference lookup cannot decorate a newer document */
  private renderGeneration = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.pluginManager = createPluginManager({
      html: true,
      linkify: true,
      typographer: true,
    });
    this.toast = new Toast();
  }

  /**
   * Initialize the viewer and plugins
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Register plugin factories
    this.pluginManager.registerPluginFactory(
      BUILTIN_PLUGINS.GITHUB_FLAVORED,
      createGithubFlavoredPlugin
    );
    this.pluginManager.registerPluginFactory(
      BUILTIN_PLUGINS.SYNTAX_HIGHLIGHT,
      createSyntaxHighlightPlugin
    );
    this.pluginManager.registerPluginFactory(
      BUILTIN_PLUGINS.MERMAID,
      createMermaidPlugin
    );
    this.pluginManager.registerPluginFactory(BUILTIN_PLUGINS.MATH, createMathPlugin);
    this.pluginManager.registerPluginFactory(
      BUILTIN_PLUGINS.FRONT_MATTER,
      createFrontMatterPlugin
    );
    this.pluginManager.registerPluginFactory(
      BUILTIN_PLUGINS.FILE_REFERENCES,
      createFileReferencePlugin
    );

    // Enable all built-in plugins
    await this.pluginManager.enablePlugins([
      BUILTIN_PLUGINS.GITHUB_FLAVORED,
      BUILTIN_PLUGINS.SYNTAX_HIGHLIGHT,
      BUILTIN_PLUGINS.MERMAID,
      BUILTIN_PLUGINS.MATH,
      BUILTIN_PLUGINS.FRONT_MATTER,
      BUILTIN_PLUGINS.FILE_REFERENCES,
    ]);

    // Apply plugin styles
    this.applyPluginStyles();

    // Setup context menu handling
    this.setupContextMenu();

    // Setup external link handling
    this.setupLinkHandling();

    // Copy buttons on code blocks and clickable task-list checkboxes
    this.setupInteractions();

    this.initialized = true;
  }

  /**
   * Apply plugin CSS styles to the document
   */
  private applyPluginStyles(): void {
    const styleContainer = document.getElementById('plugin-styles');
    if (styleContainer) {
      const styles = this.pluginManager.getPluginStyles();
      styleContainer.textContent = styles.join('\n');
    }
  }

  /**
   * Resolve relative and absolute local image paths in the rendered content
   * to the app's asset protocol so they load correctly. No-op until a file
   * path is known (e.g. unsaved content), since paths cannot be resolved
   * without a document location.
   */
  private rewriteAssetPaths(): void {
    const filePath = this.state.filePath;
    if (!filePath) return;

    rewriteAssetPaths(this.container, (ref) =>
      window.electronAPI.assets.resolve(filePath, ref)
    );
  }

  /**
   * Render markdown content
   */
  async render(markdown: string, filePath?: string): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Captured before the state moves on: a re-render of the same file (a
    // watched file changing on disk) should leave the user's selection alone.
    const isDifferentDocument = Boolean(filePath) && filePath !== this.state.filePath;

    this.state.isRendering = true;
    this.state.content = markdown;
    if (filePath) {
      this.state.filePath = filePath;
    }

    try {
      // Render markdown to HTML
      const html = this.pluginManager.render(markdown);
      this.container.innerHTML = html;
      this.applyTaskListInteractivity();
      void this.resolveFileReferences(++this.renderGeneration);

      // A Select All from the previous document leaves a range spanning this
      // container. Replacing its children does not collapse that range, so the
      // incoming document appears fully selected until something else clears it.
      if (isDifferentDocument) {
        window.getSelection()?.removeAllRanges();
      }

      // Resolve relative/local image paths against the document's location
      this.rewriteAssetPaths();

      // Run post-render hooks (for Mermaid diagrams, etc.)
      await this.pluginManager.postRender(this.container);
    } catch (error) {
      console.error('Render error:', error);
      this.container.innerHTML = `
        <div class="render-error">
          <h3>Render Error</h3>
          <p>${error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
      `;
    } finally {
      this.state.isRendering = false;
    }
  }

  /**
   * Clear the viewer content
   */
  clear(): void {
    this.container.innerHTML = '';
    this.state.content = '';
    this.state.filePath = null;
  }

  /**
   * Get current state
   */
  getState(): Readonly<MarkdownViewerState> {
    return { ...this.state };
  }

  /**
   * Get the container element
   */
  getContainer(): HTMLElement {
    return this.container;
  }

  /**
   * Get the plugin manager for accessing plugins
   */
  getPluginManager(): PluginManager {
    return this.pluginManager;
  }

  /**
   * Check if viewer is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Scroll to a specific heading by ID
   */
  scrollToHeading(headingId: string): void {
    const heading = this.container.querySelector(`#${CSS.escape(headingId)}`);
    if (heading) {
      heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /**
   * Scroll to top
   */
  scrollToTop(): void {
    this.container.scrollTop = 0;
  }

  /**
   * Get aggregated theme variable declarations from all plugins
   */
  getPluginThemeDeclarations(): PluginThemeDeclaration {
    return this.pluginManager.getPluginThemeDeclarations();
  }

  /**
   * Get preferences schemas from all enabled plugins
   * @returns Map of plugin ID to preferences schema
   */
  getPluginPreferencesSchemas(): Map<string, PluginPreferencesSchema> {
    return this.pluginManager.getPluginPreferencesSchemas();
  }

  /**
   * Notify a specific plugin that its preferences have changed
   * @param pluginId - The plugin to notify
   * @param preferences - The updated preferences for that plugin
   */
  notifyPluginPreferencesChange(pluginId: string, preferences: unknown): void {
    this.pluginManager.notifyPluginPreferencesChange(pluginId, preferences);
  }

  /**
   * Notify all plugins of their preference changes
   * @param preferencesMap - Map of plugin ID to preferences
   */
  notifyAllPluginsPreferencesChange(
    preferencesMap: Record<string, unknown>
  ): void {
    this.pluginManager.notifyAllPluginsPreferencesChange(preferencesMap);
  }

  /**
   * Enter edit mode - switch to slice-based rendering
   */
  async enterEditMode(callbacks?: EditModeCallbacks): Promise<void> {
    if (this.isEditMode || !this.state.content) return;

    this.isEditMode = true;
    this.editModeController = createEditModeController(
      this.container,
      this.pluginManager
    );
    if (callbacks) {
      this.editModeController.setCallbacks(callbacks);
    }
    await this.editModeController.enter(this.state.content);
  }

  /**
   * Exit edit mode - return to normal rendering
   */
  async exitEditMode(): Promise<void> {
    if (!this.isEditMode || !this.editModeController) return;

    const markdown = this.editModeController.exit();
    this.isEditMode = false;
    this.editModeController = null;
    this.container.classList.remove('edit-mode');

    // Update state and re-render normally
    this.state.content = markdown;
    await this.render(markdown, this.state.filePath ?? undefined);
  }

  /**
   * Check if in edit mode
   */
  getEditMode(): boolean {
    return this.isEditMode;
  }

  /**
   * Get the current markdown (possibly modified in edit mode)
   */
  getCurrentMarkdown(): string {
    if (this.isEditMode && this.editModeController) {
      // Whoever asks for the current markdown is about to persist or send it,
      // and the user may still be typing in an open editor. Commit that first:
      // otherwise the document is written as it was before the last edit, the
      // view shows the edit anyway once the editor closes, and the change is
      // silently lost when the file is reopened.
      this.editModeController.flushPendingEdits();
      return this.editModeController.getMarkdown();
    }
    return this.state.content;
  }

  /**
   * Commit any edit the user is still typing, so callers can then ask whether
   * the document is dirty. No-op outside edit mode.
   */
  flushPendingEdits(): void {
    if (this.isEditMode && this.editModeController) {
      this.editModeController.flushPendingEdits();
    }
  }

  /**
   * Set theme for theme-aware plugins (like Mermaid)
   * Re-renders content if there's any loaded
   */
  async setTheme(theme: 'light' | 'dark'): Promise<void> {
    // Update Mermaid plugin theme
    const mermaidPlugin = this.pluginManager.getPlugin<MermaidPlugin>(BUILTIN_PLUGINS.MERMAID);
    if (mermaidPlugin && 'setTheme' in mermaidPlugin) {
      mermaidPlugin.setTheme(theme);
    }

    // Re-render if we have content
    if (this.state.content) {
      await this.render(this.state.content, this.state.filePath ?? undefined);
    }
  }

  /**
   * Setup context menu handling for plugin elements
   */
  private setupContextMenu(): void {
    this.container.addEventListener('contextmenu', (e) => {
      void this.handleContextMenu(e);
    });
  }

  /**
   * Setup click handling so links to the internet open in the system browser
   */
  private setupLinkHandling(): void {
    this.container.addEventListener('click', (e) => {
      if (e.button !== 0) return;

      const target = e.target as HTMLElement;
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;

      // A file reference: open the file it resolved to, if it resolved
      if (anchor.classList.contains('file-ref')) {
        e.preventDefault();
        const target = anchor.getAttribute('data-file-path');
        if (target && this.onOpenFileReference) {
          const line = Number(anchor.getAttribute('data-file-line'));
          const column = Number(anchor.getAttribute('data-file-column'));
          this.onOpenFileReference(
            target,
            Number.isInteger(line) && line > 0 ? line : null,
            Number.isInteger(column) && column > 0 ? column : null
          );
        }
        return;
      }

      const href = anchor.getAttribute('href');
      if (!href) return;

      // In-document anchor links: scroll to the target heading
      if (href.startsWith('#')) {
        e.preventDefault();
        this.scrollToHeading(decodeURIComponent(href.slice(1)));
        return;
      }

      if (this.isExternalUrl(href)) {
        e.preventDefault();
        void window.electronAPI.shell.openExternal(href);
        return;
      }

      // Anything else is a local reference. Default navigation would replace
      // the whole app page (blanking it back to the welcome screen), so it is
      // always prevented; markdown files are opened in the viewer instead.
      e.preventDefault();
      this.openLocalLink(href);
    });
  }

  /**
   * Open a link to a local markdown file in the viewer, resolving relative
   * references against the current document's location
   */
  private openLocalLink(href: string): void {
    const basePath = this.state.filePath;
    if (!basePath || !this.onOpenLocalFile) return;

    const resolved = window.electronAPI.assets.resolvePath(basePath, href);
    if (!resolved) return;

    const ext = resolved.slice(resolved.lastIndexOf('.')).toLowerCase();
    if (!(MARKDOWN_EXTENSIONS as readonly string[]).includes(ext)) return;

    const hashIndex = href.indexOf('#');
    const fragment =
      hashIndex >= 0 ? decodeURIComponent(href.slice(hashIndex + 1)) : null;

    this.onOpenLocalFile(resolved, fragment);
  }

  /**
   * Set the callback invoked when a link to a local markdown file is clicked
   */
  setOnOpenLocalFile(
    callback: (filePath: string, fragment: string | null) => void
  ): void {
    this.onOpenLocalFile = callback;
  }

  /**
   * Whether clicking a task-list checkbox writes the toggle back to the file.
   * Applies to the document on screen as well as to later renders.
   */
  setInteractiveTaskLists(enabled: boolean): void {
    this.interactiveTaskLists = enabled;
    if (!this.isEditMode) {
      this.applyTaskListInteractivity();
    }
  }

  /**
   * Set the callback invoked with the updated markdown after a task-list
   * checkbox is toggled. Whoever receives it persists it.
   */
  setOnTaskToggle(callback: (markdown: string) => void): void {
    this.onTaskToggle = callback;
  }

  /**
   * Set the callback invoked when the user asks, from a heading's context
   * menu, to copy that heading's section
   */
  setOnCopySection(
    callback: (heading: HTMLElement, sourceLine: number, format: SectionCopyFormat) => void
  ): void {
    this.onCopySection = callback;
  }

  /**
   * Set the callback invoked when a file reference (`src/app.ts:42`) that
   * resolved to an existing file is clicked
   */
  setOnOpenFileReference(
    callback: (filePath: string, line: number | null, column: number | null) => void
  ): void {
    this.onOpenFileReference = callback;
  }

  /**
   * Set the callback invoked when the reader opens or closes the front
   * matter block, so the choice can be remembered
   */
  setOnFrontMatterToggle(callback: (expanded: boolean) => void): void {
    this.onFrontMatterToggle = callback;
  }

  /**
   * Ask main which file references in the rendered document point at real
   * files. Resolved ones get the path as their href and tooltip; the rest are
   * marked so they read as plain text.
   */
  private async resolveFileReferences(generation: number): Promise<void> {
    const anchors = Array.from(
      this.container.querySelectorAll<HTMLAnchorElement>('a.file-ref[data-file-ref]')
    );
    if (anchors.length === 0) return;

    const documentPath = this.state.filePath;
    const refs = Array.from(new Set(anchors.map((a) => a.getAttribute('data-file-ref') ?? '')));

    let resolved: Record<string, string | null> = {};
    if (documentPath) {
      try {
        resolved = await window.electronAPI.file.resolveReferences(documentPath, refs);
      } catch {
        resolved = {};
      }
    }
    if (generation !== this.renderGeneration) return;

    for (const anchor of anchors) {
      const ref = anchor.getAttribute('data-file-ref') ?? '';
      const target = resolved[ref] ?? null;
      if (target) {
        anchor.setAttribute('data-file-path', target);
        anchor.setAttribute('href', target);
        anchor.title = target;
        anchor.classList.remove('file-ref-unresolved');
      } else {
        anchor.classList.add('file-ref-unresolved');
        anchor.removeAttribute('href');
        anchor.removeAttribute('data-file-path');
        anchor.removeAttribute('title');
      }
    }
  }

  /**
   * Checkboxes render disabled; enable the ones that can be written back.
   * A box stays disabled when toggling is off, or when its item carries no
   * source line to write to.
   */
  private applyTaskListInteractivity(): void {
    const boxes = this.container.querySelectorAll<HTMLInputElement>('input.task-list-checkbox');
    for (const box of boxes) {
      const line = sourceStartLine(box.closest('li'));
      box.disabled = !(this.interactiveTaskLists && line !== null);
    }
  }

  /**
   * Click handling for the document's own controls: the copy button on a code
   * block and the checkbox on a task item.
   */
  private setupInteractions(): void {
    // `toggle` does not bubble; capture it on the way down
    this.container.addEventListener(
      'toggle',
      (e) => {
        const details = e.target;
        if (
          details instanceof HTMLDetailsElement &&
          details.classList.contains('front-matter') &&
          !this.isEditMode
        ) {
          this.onFrontMatterToggle?.(details.open);
        }
      },
      true
    );

    this.container.addEventListener('click', (e) => {
      if (e.button !== 0) return;
      const target = e.target;
      if (!(target instanceof Element)) return;

      const copyButton = target.closest('.code-copy-btn');
      if (copyButton instanceof HTMLElement) {
        e.preventDefault();
        e.stopPropagation();
        const block = copyButton.closest('.code-block');
        if (block instanceof HTMLElement) {
          void this.copyCodeBlock(block);
        }
        return;
      }

      if (target instanceof HTMLInputElement && target.classList.contains('task-list-checkbox')) {
        this.handleTaskCheckboxClick(target);
      }
    });
  }

  /**
   * Write a checkbox's new state back into the markdown. The box has already
   * flipped on screen; the source follows it. If the line underneath has
   * stopped being a task item, the box is put back the way it was.
   */
  private handleTaskCheckboxClick(box: HTMLInputElement): void {
    if (this.isEditMode || box.disabled) return;

    const line = sourceStartLine(box.closest('li'));
    const updated = line === null ? null : toggleTaskAtLine(this.state.content, line);

    if (updated === null) {
      box.checked = !box.checked;
      this.toast.error('Could not find this task in the file');
      return;
    }

    this.state.content = updated;
    this.onTaskToggle?.(updated);
  }

  /**
   * Copy a code block's source to the clipboard and show the check mark on
   * its button for a moment.
   */
  async copyCodeBlock(block: HTMLElement): Promise<void> {
    const code = block.querySelector('pre > code') ?? block.querySelector('code');
    if (!code) return;

    // The fence's content ends in a newline the author never typed
    const text = (code.textContent ?? '').replace(/\n$/, '');

    try {
      await window.electronAPI.clipboard.writeText(text);
    } catch {
      this.toast.error('Failed to copy code');
      return;
    }

    block.classList.add('is-copied');
    setTimeout(() => block.classList.remove('is-copied'), COPIED_FEEDBACK_MS);
  }

  /**
   * Copy the code block the user is "in": the one holding the selection or
   * caret, else the one under the mouse. Returns false when there is none.
   */
  copyFocusedCodeBlock(): boolean {
    const block = this.focusedCodeBlock();
    if (!block) return false;
    void this.copyCodeBlock(block);
    return true;
  }

  private focusedCodeBlock(): HTMLElement | null {
    const selection = window.getSelection();
    const anchor = selection?.anchorNode ?? null;
    if (anchor && this.container.contains(anchor)) {
      const element = anchor instanceof Element ? anchor : anchor.parentElement;
      const block = element?.closest('.code-block');
      if (block instanceof HTMLElement) return block;
    }

    const hovered = this.container.querySelector('.code-block:hover');
    return hovered instanceof HTMLElement ? hovered : null;
  }

  /**
   * Determine whether a link points to the internet (vs. an in-document anchor)
   */
  private isExternalUrl(href: string): boolean {
    try {
      const protocol = new URL(href).protocol;
      return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:';
    } catch {
      return false;
    }
  }

  /**
   * Handle context menu event
   */
  private async handleContextMenu(e: MouseEvent): Promise<void> {
    const target = e.target as HTMLElement;

    // External links: offer copy/open actions
    const anchor = target.closest('a[href]');
    if (anchor instanceof HTMLAnchorElement) {
      const href = anchor.getAttribute('href');
      if (href && this.isExternalUrl(href)) {
        await this.handleLinkContextMenu(e, href);
        return;
      }
    }

    // Headings: offer to copy their section
    const heading = target.closest('h1, h2, h3, h4, h5, h6');
    if (heading instanceof HTMLElement && sourceStartLine(heading) !== null && !this.isEditMode) {
      await this.handleHeadingContextMenu(e, heading);
      return;
    }

    // Find plugin-rendered element
    const pluginElement = target.closest('[data-plugin-id]');
    if (!pluginElement || !(pluginElement instanceof HTMLElement)) {
      // Let default menu show for non-plugin elements
      return;
    }

    e.preventDefault();

    // Highlight the element
    this.highlightElement(pluginElement);

    // Get plugin and menu items
    const pluginId = pluginElement.getAttribute('data-plugin-id');
    if (!pluginId) {
      this.removeHighlight();
      return;
    }

    const plugin = this.pluginManager.getPlugin(pluginId);
    if (!plugin?.getContextMenuItems) {
      this.removeHighlight();
      return;
    }

    const items = plugin.getContextMenuItems(pluginElement);
    if (!items || items.length === 0) {
      this.removeHighlight();
      return;
    }

    // Show native context menu
    const selectedId = await window.electronAPI.contextMenu.show({
      items,
      x: e.screenX,
      y: e.screenY,
    });

    // Remove highlight
    this.removeHighlight();

    // Execute selected action
    if (selectedId && plugin.getContextMenuData) {
      await this.executeContextMenuItem(plugin, pluginElement, selectedId);
    }
  }

  /**
   * Show a context menu for a heading: copy its section, as rich text or as
   * the markdown it came from
   */
  private async handleHeadingContextMenu(e: MouseEvent, heading: HTMLElement): Promise<void> {
    if (!this.onCopySection) return;
    e.preventDefault();

    const sourceLine = sourceStartLine(heading);
    if (sourceLine === null) return;

    this.highlightElement(heading);
    const selectedId = await window.electronAPI.contextMenu.show({
      items: [
        { id: 'copy-section-rich-text', label: 'Copy Section as Rich Text', enabled: true },
        { id: 'copy-section-markdown', label: 'Copy Section as Markdown', enabled: true },
      ],
      x: e.screenX,
      y: e.screenY,
    });
    this.removeHighlight();

    if (selectedId === 'copy-section-rich-text') {
      this.onCopySection(heading, sourceLine, 'rich-text');
    } else if (selectedId === 'copy-section-markdown') {
      this.onCopySection(heading, sourceLine, 'markdown');
    }
  }

  /**
   * Show a context menu for an external link
   */
  private async handleLinkContextMenu(e: MouseEvent, href: string): Promise<void> {
    e.preventDefault();

    const selectedId = await window.electronAPI.contextMenu.show({
      items: [
        { id: 'copy-link', label: 'Copy Link to Clipboard', enabled: true },
        { id: 'open-link', label: 'Open in Default Browser', enabled: true },
      ],
      x: e.screenX,
      y: e.screenY,
    });

    if (selectedId === 'copy-link') {
      await window.electronAPI.clipboard.writeText(href);
      this.toast.success('Link copied to clipboard');
    } else if (selectedId === 'open-link') {
      await window.electronAPI.shell.openExternal(href);
    }
  }

  /**
   * Highlight an element being targeted by context menu
   */
  private highlightElement(element: HTMLElement): void {
    this.removeHighlight();
    element.classList.add('context-menu-target');
    this.highlightedElement = element;
  }

  /**
   * Remove highlight from current element
   */
  private removeHighlight(): void {
    if (this.highlightedElement) {
      this.highlightedElement.classList.remove('context-menu-target');
      this.highlightedElement = null;
    }
  }

  /**
   * Execute a context menu action
   */
  private async executeContextMenuItem(
    plugin: MarkdownPlugin,
    element: HTMLElement,
    menuItemId: string
  ): Promise<void> {
    if (!plugin.getContextMenuData) {
      return;
    }

    try {
      const data = await plugin.getContextMenuData(element, menuItemId);
      await this.executeClipboardAction(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.toast.error(`Failed: ${message}`);
    }
  }

  /**
   * Execute clipboard action based on data type
   */
  private async executeClipboardAction(data: ContextMenuData): Promise<void> {
    switch (data.type) {
      case 'text':
        await window.electronAPI.clipboard.writeText(data.content);
        this.toast.success('Copied to clipboard');
        break;

      case 'html':
        await window.electronAPI.clipboard.writeHtml(data.content);
        this.toast.success('Copied to clipboard');
        break;

      case 'image':
        await window.electronAPI.clipboard.writeImage(data.content);
        this.toast.success('Image copied to clipboard');
        break;

      case 'file-save': {
        const result = await window.electronAPI.clipboard.saveFile(
          data.content,
          data.filename || 'image.png'
        );
        if (result.success) {
          this.toast.success(`Saved to ${result.filePath}`);
        } else if (!result.cancelled) {
          this.toast.error(result.error || 'Failed to save file');
        }
        // No toast for cancelled
        break;
      }

      default: {
        const exhaustiveCheck: never = data.type;
        throw new Error(`Unknown data type: ${String(exhaustiveCheck)}`);
      }
    }
  }
}

/**
 * Factory function to create a MarkdownViewer
 */
export function createMarkdownViewer(container: HTMLElement): MarkdownViewer {
  return new MarkdownViewer(container);
}
