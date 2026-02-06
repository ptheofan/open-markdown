/**
 * DropZone - Component for drag-and-drop file handling
 */

/**
 * Valid markdown file extensions
 */
const VALID_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkdn', '.mkd'];

/**
 * Callback type for file drop
 */
export type FileDropCallback = (filePath: string) => void;

/**
 * Callback type for open link click
 */
export type OpenLinkCallback = () => void;

/**
 * DropZone component for handling drag-and-drop
 */
export class DropZone {
  private element: HTMLElement;
  private onFileDrop: FileDropCallback | null = null;
  private onOpenLinkClick: OpenLinkCallback | null = null;
  private boundHandleDragEnter: (e: DragEvent) => void;
  private boundHandleDragOver: (e: DragEvent) => void;
  private boundHandleDragLeave: (e: DragEvent) => void;
  private boundHandleDrop: (e: DragEvent) => void;
  private boundHandleOpenLinkClick: (e: MouseEvent) => void;
  private boundPreventDefaults: (e: Event) => void;
  private openLink: HTMLElement | null = null;

  constructor(element: HTMLElement) {
    this.element = element;

    // Bind event handlers
    this.boundHandleDragEnter = this.handleDragEnter.bind(this);
    this.boundHandleDragOver = this.handleDragOver.bind(this);
    this.boundHandleDragLeave = this.handleDragLeave.bind(this);
    this.boundHandleDrop = this.handleDrop.bind(this);
    this.boundHandleOpenLinkClick = this.handleOpenLinkClick.bind(this);
    this.boundPreventDefaults = this.preventDefaults.bind(this);

    this.setupEventListeners();
  }

  /**
   * Set up drag-and-drop event listeners
   */
  private setupEventListeners(): void {
    this.element.addEventListener('dragenter', this.boundHandleDragEnter);
    this.element.addEventListener('dragover', this.boundHandleDragOver);
    this.element.addEventListener('dragleave', this.boundHandleDragLeave);
    this.element.addEventListener('drop', this.boundHandleDrop);

    // Window-level: prevent browser from opening dragged files, and handle
    // drops that land outside the drop zone element (e.g. on the viewer)
    window.addEventListener('dragover', this.boundPreventDefaults);
    window.addEventListener('drop', this.boundHandleDrop);

    // Set up Open link click handler
    this.openLink = this.element.querySelector('#drop-zone-open-link');
    if (this.openLink) {
      this.openLink.addEventListener('click', this.boundHandleOpenLinkClick);
    }
  }

  /**
   * Clean up event listeners
   */
  destroy(): void {
    this.element.removeEventListener('dragenter', this.boundHandleDragEnter);
    this.element.removeEventListener('dragover', this.boundHandleDragOver);
    this.element.removeEventListener('dragleave', this.boundHandleDragLeave);
    this.element.removeEventListener('drop', this.boundHandleDrop);
    window.removeEventListener('dragover', this.boundPreventDefaults);
    window.removeEventListener('drop', this.boundHandleDrop);
    if (this.openLink) {
      this.openLink.removeEventListener('click', this.boundHandleOpenLinkClick);
    }
  }

  /**
   * Set the callback for file drop events
   */
  setOnFileDrop(callback: FileDropCallback): void {
    this.onFileDrop = callback;
  }

  /**
   * Set the callback for Open link click
   */
  setOnOpenLinkClick(callback: OpenLinkCallback): void {
    this.onOpenLinkClick = callback;
  }

  /**
   * Handle Open link click
   */
  private handleOpenLinkClick(e: MouseEvent): void {
    e.preventDefault();
    if (this.onOpenLinkClick) {
      this.onOpenLinkClick();
    }
  }

  /**
   * Prevent default drag behavior
   */
  private preventDefaults(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
  }

  /**
   * Handle drag enter event
   */
  private handleDragEnter(e: DragEvent): void {
    this.preventDefaults(e);
    this.element.classList.add('drag-over');
  }

  /**
   * Handle drag over event
   */
  private handleDragOver(e: DragEvent): void {
    this.preventDefaults(e);
    this.element.classList.add('drag-over');
  }

  /**
   * Handle drag leave event
   */
  private handleDragLeave(e: DragEvent): void {
    this.preventDefaults(e);

    // Only remove class if we're actually leaving the drop zone
    const relatedTarget = e.relatedTarget as Node | null;
    if (!this.element.contains(relatedTarget)) {
      this.element.classList.remove('drag-over');
    }
  }

  /**
   * Handle drop event
   */
  private handleDrop(e: DragEvent): void {
    this.preventDefaults(e);
    this.element.classList.remove('drag-over');

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) {
      return;
    }

    // Get the first file
    const file = files[0];
    if (!file) {
      return;
    }

    // Validate file extension
    if (!this.isValidMarkdownFile(file.name)) {
      this.showError('Please drop a Markdown file (.md, .markdown)');
      return;
    }

    const filePath = window.electronAPI.file.getDroppedFilePath(file);
    if (!filePath) {
      this.showError('Could not get file path');
      return;
    }

    // Call the callback
    if (this.onFileDrop) {
      this.onFileDrop(filePath);
    }
  }

  /**
   * Check if a file has a valid markdown extension
   */
  private isValidMarkdownFile(fileName: string): boolean {
    const lowerName = fileName.toLowerCase();
    return VALID_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  }

  /**
   * Show an error message
   */
  private showError(message: string): void {
    // Create temporary error display
    const errorDiv = document.createElement('div');
    errorDiv.className = 'drop-zone-error';
    errorDiv.textContent = message;
    errorDiv.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: var(--error-bg);
      color: var(--error-text);
      padding: 12px 24px;
      border-radius: 6px;
      border: 1px solid var(--error-border);
      z-index: 1000;
      animation: fadeInOut 2s ease-in-out forwards;
    `;

    // Add animation keyframes if not already present
    if (!document.getElementById('drop-zone-animations')) {
      const style = document.createElement('style');
      style.id = 'drop-zone-animations';
      style.textContent = `
        @keyframes fadeInOut {
          0% { opacity: 0; }
          15% { opacity: 1; }
          85% { opacity: 1; }
          100% { opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(errorDiv);

    // Remove after animation
    setTimeout(() => {
      errorDiv.remove();
    }, 2000);
  }

  /**
   * Show the drop zone
   */
  show(): void {
    this.element.style.display = '';
  }

  /**
   * Hide the drop zone
   */
  hide(): void {
    this.element.style.display = 'none';
  }
}

/**
 * Factory function to create a DropZone
 */
export function createDropZone(element: HTMLElement): DropZone {
  return new DropZone(element);
}
