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
