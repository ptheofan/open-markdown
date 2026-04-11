/**
 * EditModeController - Manages edit mode with Notion-style slice rendering
 *
 * When edit mode is active, the markdown content is split into individual
 * "slices" (blocks), each with hover states, a left-side handle for options,
 * and inline editing via a textarea when clicked.
 */
import { MarkdownSlicer, type MarkdownSlice } from '../services/MarkdownSlicer';
import type { PluginManager } from '@plugins/core/PluginManager';

/**
 * Callbacks for EditModeController events
 */
export interface EditModeCallbacks {
  /** Called when the full markdown content changes (for auto-save) */
  onContentChange?: (markdown: string) => void;
  /** Called when a slice requests a context action */
  onSliceAction?: (action: SliceAction, sliceIndex: number) => void;
}

/**
 * Actions available from the slice handle menu
 */
export type SliceAction = 'delete' | 'duplicate' | 'move-up' | 'move-down' | 'add-above' | 'add-below';

/**
 * EditModeController class
 */
export class EditModeController {
  private container: HTMLElement;
  private pluginManager: PluginManager;
  private slicer: MarkdownSlicer;
  private slices: MarkdownSlice[] = [];
  private rawMarkdown = '';
  private callbacks: EditModeCallbacks = {};
  private activeEditIndex: number | null = null;
  private activeMenu: HTMLElement | null = null;
  private sliceElements: Map<number, HTMLElement> = new Map();

  constructor(container: HTMLElement, pluginManager: PluginManager) {
    this.container = container;
    this.pluginManager = pluginManager;
    this.slicer = new MarkdownSlicer();

    this.handleDocumentClick = this.handleDocumentClick.bind(this);
  }

  /**
   * Set callbacks
   */
  setCallbacks(callbacks: EditModeCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Enter edit mode - render content as slices
   */
  async enter(markdown: string): Promise<void> {
    this.rawMarkdown = markdown;
    this.slices = this.slicer.slice(markdown);
    await this.renderSlices();
    document.addEventListener('click', this.handleDocumentClick);
  }

  /**
   * Exit edit mode - commit any pending edits
   */
  exit(): string {
    this.commitActiveEdit();
    this.closeMenu();
    document.removeEventListener('click', this.handleDocumentClick);
    this.sliceElements.clear();
    this.activeEditIndex = null;
    return this.rawMarkdown;
  }

  /**
   * Get the current markdown content
   */
  getMarkdown(): string {
    return this.rawMarkdown;
  }

  /**
   * Render all slices into the container
   */
  private async renderSlices(): Promise<void> {
    this.container.innerHTML = '';
    this.container.classList.add('edit-mode');
    this.sliceElements.clear();

    for (const slice of this.slices) {
      const el = this.createSliceElement(slice);
      this.container.appendChild(el);
      this.sliceElements.set(slice.index, el);
    }

    // Run post-render for plugins (e.g., Mermaid diagrams)
    await this.pluginManager.postRender(this.container);
  }

  /**
   * Create a single slice DOM element
   */
  private createSliceElement(slice: MarkdownSlice): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = `slice slice-${slice.type}`;
    wrapper.dataset.sliceIndex = String(slice.index);

    // Left-side handle
    const handle = document.createElement('div');
    handle.className = 'slice-handle';
    handle.innerHTML = `
      <button class="slice-handle-btn" title="Drag to move / Click for options">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="5.5" cy="3.5" r="1.5"/>
          <circle cx="10.5" cy="3.5" r="1.5"/>
          <circle cx="5.5" cy="8" r="1.5"/>
          <circle cx="10.5" cy="8" r="1.5"/>
          <circle cx="5.5" cy="12.5" r="1.5"/>
          <circle cx="10.5" cy="12.5" r="1.5"/>
        </svg>
      </button>
    `;
    handle.querySelector('.slice-handle-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMenu(slice.index, handle);
    });

    // Content area
    const content = document.createElement('div');
    content.className = 'slice-content';

    // Render the slice's markdown to HTML
    const html = this.pluginManager.render(slice.raw);
    content.innerHTML = html;

    // Click to edit
    content.addEventListener('click', (e) => {
      // Don't enter edit if clicking a link
      if ((e.target as HTMLElement).closest('a')) return;
      e.stopPropagation();
      this.startEdit(slice.index);
    });

    wrapper.appendChild(handle);
    wrapper.appendChild(content);

    return wrapper;
  }

  /**
   * Start inline editing of a slice
   */
  private startEdit(sliceIndex: number): void {
    // Commit any previous edit
    this.commitActiveEdit();

    const slice = this.slices.find(s => s.index === sliceIndex);
    const el = this.sliceElements.get(sliceIndex);
    if (!slice || !el) return;

    this.activeEditIndex = sliceIndex;
    el.classList.add('slice-editing');

    const contentEl = el.querySelector('.slice-content');
    if (!contentEl) return;

    // Replace rendered HTML with textarea
    const textarea = document.createElement('textarea');
    textarea.className = 'slice-editor';
    textarea.value = slice.raw;
    textarea.spellcheck = false;

    // Auto-resize
    const resize = (): void => {
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
    };

    textarea.addEventListener('input', resize);

    // Handle keyboard shortcuts
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.commitActiveEdit();
      }
    });

    contentEl.innerHTML = '';
    contentEl.appendChild(textarea);

    // Focus and resize
    textarea.focus();
    resize();
  }

  /**
   * Commit the active edit and re-render the slice
   */
  private commitActiveEdit(): void {
    if (this.activeEditIndex === null) return;

    const sliceIndex = this.activeEditIndex;
    // Clear immediately to prevent race conditions with async postRender
    this.activeEditIndex = null;

    const el = this.sliceElements.get(sliceIndex);
    if (!el) return;

    const textarea = el.querySelector<HTMLTextAreaElement>('.slice-editor');
    if (!textarea) return;

    const newRaw = textarea.value;
    const slice = this.slices.find(s => s.index === sliceIndex);

    if (slice && newRaw !== slice.raw) {
      // Update the slice and recalculate
      const result = this.slicer.updateSlice(this.slices, sliceIndex, newRaw);
      this.rawMarkdown = result.markdown;
      this.slices = result.slices;

      // Notify of content change
      this.callbacks.onContentChange?.(this.rawMarkdown);
    }

    // Re-render just this slice's content
    el.classList.remove('slice-editing');
    const contentEl = el.querySelector('.slice-content');
    if (contentEl && slice) {
      const updatedSlice = this.slices.find(s => s.index === sliceIndex);
      const html = this.pluginManager.render(updatedSlice?.raw ?? slice.raw);
      contentEl.innerHTML = html;

      // Re-attach click handler
      contentEl.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('a')) return;
        e.stopPropagation();
        this.startEdit(sliceIndex);
      });

      // Run post-render asynchronously (non-blocking)
      void this.pluginManager.postRender(contentEl as HTMLElement);
    }
  }

  /**
   * Toggle the options menu for a slice handle
   */
  private toggleMenu(sliceIndex: number, handleEl: HTMLElement): void {
    if (this.activeMenu) {
      this.closeMenu();
      return;
    }

    const menu = document.createElement('div');
    menu.className = 'slice-menu';
    menu.innerHTML = `
      <button data-action="add-above" class="slice-menu-item">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z"/>
        </svg>
        Add block above
      </button>
      <button data-action="add-below" class="slice-menu-item">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z"/>
        </svg>
        Add block below
      </button>
      <div class="slice-menu-divider"></div>
      <button data-action="duplicate" class="slice-menu-item">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z"/>
          <path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z"/>
        </svg>
        Duplicate
      </button>
      <button data-action="move-up" class="slice-menu-item">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path fill-rule="evenodd" d="M7.646 4.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1-.708.708L8 5.707l-5.646 5.647a.5.5 0 0 1-.708-.708l6-6z"/>
        </svg>
        Move up
      </button>
      <button data-action="move-down" class="slice-menu-item">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path fill-rule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/>
        </svg>
        Move down
      </button>
      <div class="slice-menu-divider"></div>
      <button data-action="delete" class="slice-menu-item slice-menu-item-danger">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
          <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H5.5l1-1h3l1 1H13a1 1 0 0 1 1 1v1z"/>
        </svg>
        Delete
      </button>
    `;

    // Handle menu item clicks
    menu.querySelectorAll('.slice-menu-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = (btn as HTMLElement).dataset.action as SliceAction;
        this.closeMenu();
        this.handleSliceAction(action, sliceIndex);
      });
    });

    handleEl.appendChild(menu);
    this.activeMenu = menu;
  }

  /**
   * Close the active options menu
   */
  private closeMenu(): void {
    if (this.activeMenu) {
      this.activeMenu.remove();
      this.activeMenu = null;
    }
  }

  /**
   * Handle document click to close menu and commit edits
   */
  private handleDocumentClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;

    // Close menu if clicking outside
    if (this.activeMenu && !this.activeMenu.contains(target)) {
      this.closeMenu();
    }

    // Commit edit if clicking outside active slice
    if (this.activeEditIndex !== null) {
      const activeEl = this.sliceElements.get(this.activeEditIndex);
      if (activeEl && !activeEl.contains(target)) {
        this.commitActiveEdit();
      }
    }
  }

  /**
   * Handle slice actions from the context menu
   */
  private handleSliceAction(action: SliceAction, sliceIndex: number): void {
    this.commitActiveEdit();

    const idx = this.slices.findIndex(s => s.index === sliceIndex);
    if (idx === -1) return;

    switch (action) {
      case 'delete':
        this.slices.splice(idx, 1);
        break;

      case 'duplicate': {
        const original = this.slices[idx];
        const newSlice: MarkdownSlice = {
          ...original,
          index: Math.max(...this.slices.map(s => s.index)) + 1,
        };
        this.slices.splice(idx + 1, 0, newSlice);
        break;
      }

      case 'move-up':
        if (idx > 0) {
          const [item] = this.slices.splice(idx, 1);
          this.slices.splice(idx - 1, 0, item);
        }
        break;

      case 'move-down':
        if (idx < this.slices.length - 1) {
          const [item] = this.slices.splice(idx, 1);
          this.slices.splice(idx + 1, 0, item);
        }
        break;

      case 'add-above': {
        const newSlice: MarkdownSlice = {
          index: Math.max(...this.slices.map(s => s.index)) + 1,
          type: 'paragraph',
          raw: '',
          startLine: this.slices[idx].startLine,
          endLine: this.slices[idx].startLine,
        };
        this.slices.splice(idx, 0, newSlice);
        break;
      }

      case 'add-below': {
        const newSlice: MarkdownSlice = {
          index: Math.max(...this.slices.map(s => s.index)) + 1,
          type: 'paragraph',
          raw: '',
          startLine: this.slices[idx].endLine,
          endLine: this.slices[idx].endLine,
        };
        this.slices.splice(idx + 1, 0, newSlice);
        break;
      }
    }

    // Reassemble and re-render
    this.rawMarkdown = this.slicer.reassemble(this.slices);
    this.callbacks.onContentChange?.(this.rawMarkdown);

    // Re-slice and render from scratch for structural changes
    this.slices = this.slicer.slice(this.rawMarkdown);
    void this.renderSlices().then(() => {
      // Auto-focus new empty blocks
      if (action === 'add-above' || action === 'add-below') {
        const newIdx = action === 'add-above' ? idx : idx + 1;
        if (this.slices[newIdx]) {
          this.startEdit(this.slices[newIdx].index);
        }
      }
    });
  }
}

/**
 * Factory function
 */
export function createEditModeController(
  container: HTMLElement,
  pluginManager: PluginManager
): EditModeController {
  return new EditModeController(container, pluginManager);
}
