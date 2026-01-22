/**
 * CollapsibleSection - Expandable section with chevron indicator
 */

/**
 * CollapsibleSection options
 */
export interface CollapsibleSectionOptions {
  title: string;
  initiallyOpen?: boolean;
}

/**
 * Collapsible section component
 */
export class CollapsibleSection {
  private element: HTMLElement;
  private header: HTMLElement;
  private content: HTMLElement;
  private chevron: HTMLElement;
  private isOpen: boolean;

  constructor(options: CollapsibleSectionOptions) {
    this.isOpen = options.initiallyOpen ?? false;
    this.element = this.createElement(options.title);
    this.header = this.element.querySelector('.collapsible-header')!;
    this.content = this.element.querySelector('.collapsible-content')!;
    this.chevron = this.element.querySelector('.collapsible-chevron')!;
    this.setupEventListeners();
    this.updateVisualState();
  }

  /**
   * Create the DOM element
   */
  private createElement(title: string): HTMLElement {
    const section = document.createElement('div');
    section.className = 'collapsible-section';

    section.innerHTML = `
      <button class="collapsible-header" type="button">
        <span class="collapsible-title">${title}</span>
        <svg class="collapsible-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <div class="collapsible-content"></div>
    `;

    return section;
  }

  /**
   * Set up event listeners
   */
  private setupEventListeners(): void {
    this.header.addEventListener('click', () => {
      this.toggle();
    });
  }

  /**
   * Update visual state based on isOpen
   */
  private updateVisualState(): void {
    if (this.isOpen) {
      this.element.classList.add('is-open');
      this.content.style.display = 'block';
      this.chevron.style.transform = 'rotate(0deg)';
    } else {
      this.element.classList.remove('is-open');
      this.content.style.display = 'none';
      this.chevron.style.transform = 'rotate(-90deg)';
    }
  }

  /**
   * Get the root element
   */
  getElement(): HTMLElement {
    return this.element;
  }

  /**
   * Set the content of the section
   */
  setContent(content: HTMLElement | HTMLElement[]): void {
    this.content.innerHTML = '';
    if (Array.isArray(content)) {
      content.forEach((el) => this.content.appendChild(el));
    } else {
      this.content.appendChild(content);
    }
  }

  /**
   * Open the section
   */
  open(): void {
    this.isOpen = true;
    this.updateVisualState();
  }

  /**
   * Close the section
   */
  close(): void {
    this.isOpen = false;
    this.updateVisualState();
  }

  /**
   * Toggle the section
   */
  toggle(): void {
    this.isOpen = !this.isOpen;
    this.updateVisualState();
  }

  /**
   * Check if section is open
   */
  getIsOpen(): boolean {
    return this.isOpen;
  }
}

/**
 * Factory function to create a CollapsibleSection
 */
export function createCollapsibleSection(
  options: CollapsibleSectionOptions
): CollapsibleSection {
  return new CollapsibleSection(options);
}
