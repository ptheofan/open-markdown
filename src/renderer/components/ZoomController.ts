/**
 * ZoomController - Handles zoom gestures for the markdown content
 * Supports pinch-to-zoom (trackpad) and keyboard shortcuts
 */

/**
 * Zoom configuration
 */
export interface ZoomConfig {
  /** Minimum zoom level */
  minZoom: number;
  /** Maximum zoom level */
  maxZoom: number;
  /** Zoom step for keyboard shortcuts */
  zoomStep: number;
  /** Initial zoom level */
  initialZoom: number;
}

/**
 * Default zoom configuration
 */
const DEFAULT_CONFIG: ZoomConfig = {
  minZoom: 0.5,
  maxZoom: 3.0,
  zoomStep: 0.1,
  initialZoom: 1.0,
};

/**
 * Callback for zoom level changes
 */
export type ZoomChangeCallback = (zoomLevel: number) => void;

/**
 * ZoomController handles zoom interactions for a target element
 */
export class ZoomController {
  private targetElement: HTMLElement;
  private scrollContainer: HTMLElement;
  private config: ZoomConfig;
  private currentZoom: number;
  private onZoomChange: ZoomChangeCallback | null = null;

  private boundHandleWheel: (e: WheelEvent) => void;
  private boundHandleKeydown: (e: KeyboardEvent) => void;

  constructor(
    targetElement: HTMLElement,
    scrollContainer: HTMLElement,
    config: Partial<ZoomConfig> = {}
  ) {
    this.targetElement = targetElement;
    this.scrollContainer = scrollContainer;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentZoom = this.config.initialZoom;

    // Bind event handlers
    this.boundHandleWheel = this.handleWheel.bind(this);
    this.boundHandleKeydown = this.handleKeydown.bind(this);

    this.setupEventListeners();
    this.applyZoom();
  }

  /**
   * Set up event listeners for zoom gestures
   */
  private setupEventListeners(): void {
    // Wheel event for pinch-to-zoom (trackpad pinch sends wheel events with ctrlKey)
    this.scrollContainer.addEventListener('wheel', this.boundHandleWheel, { passive: false });

    // Keyboard shortcuts
    window.addEventListener('keydown', this.boundHandleKeydown);
  }

  /**
   * Handle wheel event for pinch-to-zoom
   */
  private handleWheel(e: WheelEvent): void {
    // Pinch-to-zoom on trackpad sends wheel events with ctrlKey
    // Also support Cmd/Ctrl + scroll wheel
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();

      // Calculate zoom delta (normalize for different input devices)
      const delta = -e.deltaY * 0.01;
      const newZoom = this.clampZoom(this.currentZoom + delta);

      if (newZoom !== this.currentZoom) {
        // Get mouse position relative to scroll container for zoom centering
        const rect = this.scrollContainer.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        this.zoomToPoint(newZoom, mouseX, mouseY);
      }
    }
  }

  /**
   * Handle keyboard shortcuts for zoom
   */
  private handleKeydown(e: KeyboardEvent): void {
    // Only handle when not in an input field
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }

    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const modifierKey = isMac ? e.metaKey : e.ctrlKey;

    if (!modifierKey) return;

    switch (e.key) {
      case '=':
      case '+':
        // Zoom in
        e.preventDefault();
        this.zoomIn();
        break;
      case '-':
        // Zoom out
        e.preventDefault();
        this.zoomOut();
        break;
      case '0':
        // Reset zoom
        e.preventDefault();
        this.resetZoom();
        break;
    }
  }

  /**
   * Zoom in by one step
   */
  zoomIn(): void {
    const newZoom = this.clampZoom(this.currentZoom + this.config.zoomStep);
    this.setZoom(newZoom);
  }

  /**
   * Zoom out by one step
   */
  zoomOut(): void {
    const newZoom = this.clampZoom(this.currentZoom - this.config.zoomStep);
    this.setZoom(newZoom);
  }

  /**
   * Reset zoom to initial level
   */
  resetZoom(): void {
    this.setZoom(this.config.initialZoom);
  }

  /**
   * Set zoom level
   */
  setZoom(level: number): void {
    const newZoom = this.clampZoom(level);
    if (newZoom !== this.currentZoom) {
      this.currentZoom = newZoom;
      this.applyZoom();
      this.notifyZoomChange();
    }
  }

  /**
   * Get current zoom level
   */
  getZoom(): number {
    return this.currentZoom;
  }

  /**
   * Zoom to a specific point (used for pinch-to-zoom centering)
   */
  private zoomToPoint(newZoom: number, pointX: number, pointY: number): void {
    const oldZoom = this.currentZoom;
    const zoomRatio = newZoom / oldZoom;

    // Get current scroll position
    const scrollLeft = this.scrollContainer.scrollLeft;
    const scrollTop = this.scrollContainer.scrollTop;

    // Calculate the point in content coordinates before zoom
    const contentX = scrollLeft + pointX;
    const contentY = scrollTop + pointY;

    // Apply the new zoom
    this.currentZoom = newZoom;
    this.applyZoom();

    // Calculate new scroll position to keep the point under the cursor
    const newScrollLeft = contentX * zoomRatio - pointX;
    const newScrollTop = contentY * zoomRatio - pointY;

    this.scrollContainer.scrollLeft = Math.max(0, newScrollLeft);
    this.scrollContainer.scrollTop = Math.max(0, newScrollTop);

    this.notifyZoomChange();
  }

  /**
   * Clamp zoom level to min/max bounds
   */
  private clampZoom(zoom: number): number {
    return Math.min(this.config.maxZoom, Math.max(this.config.minZoom, zoom));
  }

  /**
   * Apply the current zoom level to the target element
   */
  private applyZoom(): void {
    this.targetElement.style.transform = `scale(${this.currentZoom})`;
    this.targetElement.style.transformOrigin = 'top left';

    // Adjust width to fit scaled content - this ensures scrollbars work correctly
    this.targetElement.style.width = this.currentZoom === 1 ? '' : `${100 / this.currentZoom}%`;
  }

  /**
   * Notify listeners of zoom change
   */
  private notifyZoomChange(): void {
    if (this.onZoomChange) {
      this.onZoomChange(this.currentZoom);
    }
  }

  /**
   * Set callback for zoom level changes
   */
  setOnZoomChange(callback: ZoomChangeCallback): void {
    this.onZoomChange = callback;
  }

  /**
   * Clean up event listeners
   */
  destroy(): void {
    this.scrollContainer.removeEventListener('wheel', this.boundHandleWheel);
    window.removeEventListener('keydown', this.boundHandleKeydown);
  }
}

/**
 * Factory function to create a ZoomController
 */
export function createZoomController(
  targetElement: HTMLElement,
  scrollContainer: HTMLElement,
  config?: Partial<ZoomConfig>
): ZoomController {
  return new ZoomController(targetElement, scrollContainer, config);
}
