/**
 * FormControls - Reusable form input components for preferences
 */

/**
 * Base interface for form field options
 */
interface FormFieldOptions {
  label: string;
  description?: string;
}

/**
 * Select dropdown component
 */
export interface SelectOptions extends FormFieldOptions {
  options: Array<{ value: string; label: string }>;
  value: string;
}

export class Select {
  private element: HTMLElement;
  private selectElement: HTMLSelectElement;
  private onChange: ((value: string) => void) | null = null;

  constructor(options: SelectOptions) {
    this.element = this.createElement(options);
    this.selectElement = this.element.querySelector('select')!;
    this.setupEventListeners();
  }

  private createElement(options: SelectOptions): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'form-field form-field-select';

    const optionsHtml = options.options
      .map(
        (opt) =>
          `<option value="${opt.value}" ${opt.value === options.value ? 'selected' : ''}>${opt.label}</option>`
      )
      .join('');

    wrapper.innerHTML = `
      <label class="form-label">${options.label}</label>
      ${options.description ? `<p class="form-description">${options.description}</p>` : ''}
      <select class="form-select">${optionsHtml}</select>
    `;

    return wrapper;
  }

  private setupEventListeners(): void {
    this.selectElement.addEventListener('change', () => {
      this.onChange?.(this.selectElement.value);
    });
  }

  getElement(): HTMLElement {
    return this.element;
  }

  getValue(): string {
    return this.selectElement.value;
  }

  setValue(value: string): void {
    this.selectElement.value = value;
  }

  setOnChange(callback: (value: string) => void): void {
    this.onChange = callback;
  }
}

/**
 * Number input component with optional slider
 */
export interface NumberInputOptions extends FormFieldOptions {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  showSlider?: boolean;
}

export class NumberInput {
  private element: HTMLElement;
  private inputElement: HTMLInputElement;
  private sliderElement: HTMLInputElement | null = null;
  private onChange: ((value: number) => void) | null = null;

  constructor(options: NumberInputOptions) {
    this.element = this.createElement(options);
    this.inputElement = this.element.querySelector('input[type="number"]')!;
    this.sliderElement = this.element.querySelector('input[type="range"]');
    this.setupEventListeners();
  }

  private createElement(options: NumberInputOptions): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'form-field form-field-number';

    const min = options.min ?? 0;
    const max = options.max ?? 100;
    const step = options.step ?? 1;

    let sliderHtml = '';
    if (options.showSlider) {
      sliderHtml = `
        <input type="range" class="form-slider"
          value="${options.value}"
          min="${min}"
          max="${max}"
          step="${step}">
      `;
    }

    wrapper.innerHTML = `
      <label class="form-label">${options.label}</label>
      ${options.description ? `<p class="form-description">${options.description}</p>` : ''}
      <div class="form-number-controls">
        ${sliderHtml}
        <input type="number" class="form-input-number"
          value="${options.value}"
          min="${min}"
          max="${max}"
          step="${step}">
        ${options.unit ? `<span class="form-unit">${options.unit}</span>` : ''}
      </div>
    `;

    return wrapper;
  }

  private setupEventListeners(): void {
    this.inputElement.addEventListener('change', () => {
      const value = parseFloat(this.inputElement.value);
      if (this.sliderElement) {
        this.sliderElement.value = String(value);
      }
      this.onChange?.(value);
    });

    if (this.sliderElement) {
      this.sliderElement.addEventListener('input', () => {
        const value = parseFloat(this.sliderElement!.value);
        this.inputElement.value = String(value);
        this.onChange?.(value);
      });
    }
  }

  getElement(): HTMLElement {
    return this.element;
  }

  getValue(): number {
    return parseFloat(this.inputElement.value);
  }

  setValue(value: number): void {
    this.inputElement.value = String(value);
    if (this.sliderElement) {
      this.sliderElement.value = String(value);
    }
  }

  setOnChange(callback: (value: number) => void): void {
    this.onChange = callback;
  }
}

/**
 * Toggle/checkbox component
 */
export interface ToggleOptions extends FormFieldOptions {
  value: boolean;
}

export class Toggle {
  private element: HTMLElement;
  private inputElement: HTMLInputElement;
  private onChange: ((value: boolean) => void) | null = null;

  constructor(options: ToggleOptions) {
    this.element = this.createElement(options);
    this.inputElement = this.element.querySelector('input')!;
    this.setupEventListeners();
  }

  private createElement(options: ToggleOptions): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'form-field form-field-toggle';

    wrapper.innerHTML = `
      <label class="form-toggle-label">
        <input type="checkbox" class="form-toggle-input" ${options.value ? 'checked' : ''}>
        <span class="form-toggle-switch"></span>
        <span class="form-toggle-text">${options.label}</span>
      </label>
      ${options.description ? `<p class="form-description">${options.description}</p>` : ''}
    `;

    return wrapper;
  }

  private setupEventListeners(): void {
    this.inputElement.addEventListener('change', () => {
      this.onChange?.(this.inputElement.checked);
    });
  }

  getElement(): HTMLElement {
    return this.element;
  }

  getValue(): boolean {
    return this.inputElement.checked;
  }

  setValue(value: boolean): void {
    this.inputElement.checked = value;
  }

  setOnChange(callback: (value: boolean) => void): void {
    this.onChange = callback;
  }
}

/**
 * Text input component
 */
export interface TextInputOptions extends FormFieldOptions {
  value: string;
  placeholder?: string;
}

export class TextInput {
  private element: HTMLElement;
  private inputElement: HTMLInputElement;
  private onChange: ((value: string) => void) | null = null;

  constructor(options: TextInputOptions) {
    this.element = this.createElement(options);
    this.inputElement = this.element.querySelector('input')!;
    this.setupEventListeners();
  }

  private createElement(options: TextInputOptions): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'form-field form-field-text';

    wrapper.innerHTML = `
      <label class="form-label">${options.label}</label>
      ${options.description ? `<p class="form-description">${options.description}</p>` : ''}
      <input type="text" class="form-input-text"
        value="${options.value}"
        ${options.placeholder ? `placeholder="${options.placeholder}"` : ''}>
    `;

    return wrapper;
  }

  private setupEventListeners(): void {
    this.inputElement.addEventListener('change', () => {
      this.onChange?.(this.inputElement.value);
    });
  }

  getElement(): HTMLElement {
    return this.element;
  }

  getValue(): string {
    return this.inputElement.value;
  }

  setValue(value: string): void {
    this.inputElement.value = value;
  }

  setOnChange(callback: (value: string) => void): void {
    this.onChange = callback;
  }
}

/**
 * Font select component with system font enumeration
 */
export interface FontSelectOptions extends FormFieldOptions {
  value: string;
  defaultLabel?: string;
}

// Module-level cache so both body and mono pickers share one enumeration
let cachedFonts: string[] | null = null;

async function getSystemFonts(): Promise<string[]> {
  if (cachedFonts) return cachedFonts;

  try {
    if ('queryLocalFonts' in window) {
      const fontData: Array<{ family: string }> =
        await (window as unknown as { queryLocalFonts: () => Promise<Array<{ family: string }>> }).queryLocalFonts();
      const families = new Set<string>();
      for (const font of fontData) {
        families.add(font.family);
      }
      cachedFonts = [...families].sort((a, b) => a.localeCompare(b));
      return cachedFonts;
    }
  } catch {
    // Permission denied or API unavailable
  }

  cachedFonts = [];
  return cachedFonts;
}

export class FontSelect {
  private element: HTMLElement;
  private inputElement: HTMLInputElement;
  private dropdownElement: HTMLElement;
  private onChange: ((value: string) => void) | null = null;
  private currentValue: string;
  private fonts: string[] = [];
  private isOpen = false;
  private highlightedIndex = -1;
  private readonly defaultLabel: string;
  private readonly boundOnClickOutside = (e: MouseEvent): void => {
    if (!this.element.contains(e.target as Node)) {
      this.close();
    }
  };

  constructor(options: FontSelectOptions) {
    this.currentValue = options.value;
    this.defaultLabel = options.defaultLabel ?? 'System Default';
    this.element = this.createElement(options);
    this.inputElement = this.element.querySelector('.font-select-input')!;
    this.dropdownElement = this.element.querySelector('.font-select-dropdown')!;
    this.setupEventListeners();
    void this.loadFonts();
  }

  private createElement(options: FontSelectOptions): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'form-field form-field-font-select';

    const label = document.createElement('label');
    label.className = 'form-label';
    label.textContent = options.label;
    wrapper.appendChild(label);

    if (options.description) {
      const desc = document.createElement('p');
      desc.className = 'form-description';
      desc.textContent = options.description;
      wrapper.appendChild(desc);
    }

    const container = document.createElement('div');
    container.className = 'font-select-container';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'font-select-input form-input-text';
    input.value = options.value || this.defaultLabel;
    input.readOnly = true;
    container.appendChild(input);

    const dropdown = document.createElement('div');
    dropdown.className = 'font-select-dropdown';
    container.appendChild(dropdown);

    wrapper.appendChild(container);
    return wrapper;
  }

  private async loadFonts(): Promise<void> {
    this.fonts = await getSystemFonts();
  }

  private setupEventListeners(): void {
    this.inputElement.addEventListener('click', () => {
      if (this.isOpen) {
        this.close();
      } else {
        void this.open();
      }
    });

    this.inputElement.addEventListener('input', () => {
      this.renderDropdown(this.inputElement.value);
    });

    this.inputElement.addEventListener('keydown', (e) => {
      if (!this.isOpen) {
        if (e.key === 'ArrowDown' || e.key === 'Enter') {
          e.preventDefault();
          void this.open();
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          this.moveHighlight(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          this.moveHighlight(-1);
          break;
        case 'Enter':
          e.preventDefault();
          this.selectHighlighted();
          break;
        case 'Escape':
          e.preventDefault();
          this.close();
          break;
      }
    });
  }

  private async open(): Promise<void> {
    if (this.fonts.length === 0) {
      this.fonts = await getSystemFonts();
    }
    this.isOpen = true;
    this.inputElement.readOnly = false;
    this.inputElement.value = '';
    this.inputElement.placeholder = 'Search fonts\u2026';
    this.highlightedIndex = -1;
    this.renderDropdown('');
    this.dropdownElement.classList.add('is-open');
    document.addEventListener('mousedown', this.boundOnClickOutside);
  }

  private close(): void {
    this.isOpen = false;
    this.inputElement.readOnly = true;
    this.inputElement.value = this.currentValue || this.defaultLabel;
    this.inputElement.placeholder = '';
    this.dropdownElement.classList.remove('is-open');
    document.removeEventListener('mousedown', this.boundOnClickOutside);
  }

  private renderDropdown(filter: string): void {
    const lowerFilter = filter.toLowerCase();
    const filtered = filter
      ? this.fonts.filter((f) => f.toLowerCase().includes(lowerFilter))
      : this.fonts;

    this.highlightedIndex = -1;
    this.dropdownElement.textContent = '';

    // "System Default" option
    const defaultOpt = document.createElement('div');
    defaultOpt.className = 'font-select-option font-select-option-default';
    defaultOpt.textContent = this.defaultLabel;
    defaultOpt.dataset.value = '';
    defaultOpt.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.selectValue('');
    });
    this.dropdownElement.appendChild(defaultOpt);

    // Font options (cap at 200 for performance)
    for (const font of filtered.slice(0, 200)) {
      const option = document.createElement('div');
      option.className = 'font-select-option';
      option.textContent = font;
      option.style.fontFamily = `"${font}"`;
      option.dataset.value = font;
      option.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.selectValue(font);
      });
      this.dropdownElement.appendChild(option);
    }

    if (filtered.length > 200) {
      const more = document.createElement('div');
      more.className = 'font-select-option font-select-more';
      more.textContent = `${filtered.length - 200} more \u2014 type to filter`;
      this.dropdownElement.appendChild(more);
    }
  }

  private moveHighlight(delta: number): void {
    const options = this.dropdownElement.querySelectorAll(
      '.font-select-option:not(.font-select-more)'
    );
    if (options.length === 0) return;

    if (this.highlightedIndex >= 0 && this.highlightedIndex < options.length) {
      options[this.highlightedIndex]?.classList.remove('is-highlighted');
    }

    this.highlightedIndex = Math.max(
      0,
      Math.min(options.length - 1, this.highlightedIndex + delta)
    );

    const highlighted = options[this.highlightedIndex];
    if (highlighted) {
      highlighted.classList.add('is-highlighted');
      highlighted.scrollIntoView({ block: 'nearest' });
    }
  }

  private selectHighlighted(): void {
    const options = this.dropdownElement.querySelectorAll(
      '.font-select-option:not(.font-select-more)'
    );
    if (this.highlightedIndex >= 0 && this.highlightedIndex < options.length) {
      const value = (options[this.highlightedIndex] as HTMLElement).dataset.value ?? '';
      this.selectValue(value);
    }
  }

  private selectValue(value: string): void {
    this.currentValue = value;
    this.close();
    this.onChange?.(value);
  }

  getElement(): HTMLElement {
    return this.element;
  }

  getValue(): string {
    return this.currentValue;
  }

  setValue(value: string): void {
    this.currentValue = value;
    if (!this.isOpen) {
      this.inputElement.value = value || this.defaultLabel;
    }
  }

  setOnChange(callback: (value: string) => void): void {
    this.onChange = callback;
  }
}

/**
 * Factory functions
 */
export function createSelect(options: SelectOptions): Select {
  return new Select(options);
}

export function createNumberInput(options: NumberInputOptions): NumberInput {
  return new NumberInput(options);
}

export function createToggle(options: ToggleOptions): Toggle {
  return new Toggle(options);
}

export function createTextInput(options: TextInputOptions): TextInput {
  return new TextInput(options);
}
