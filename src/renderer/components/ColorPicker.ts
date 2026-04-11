/**
 * ColorPicker - OKLCH color picker component
 *
 * A color picker that supports OKLCH color input with a clickable
 * preview swatch (opens native color picker), text inputs for direct
 * hex/OKLCH editing, and an optional reset-to-default button.
 */

import type { OklchColor } from '@shared/types';
import { parseOklch, formatOklch, hexToOklch, oklchToHex } from '@shared/utils';

/**
 * ColorPicker options
 */
export interface ColorPickerOptions {
  value: OklchColor;
  defaultValue?: OklchColor;
  label?: string;
  description?: string;
  showAlpha?: boolean;
}

/**
 * ColorPicker component
 */
export class ColorPicker {
  private element: HTMLElement;
  private swatchElement: HTMLElement;
  private textInput: HTMLInputElement;
  private hexInput: HTMLInputElement;
  private nativeInput: HTMLInputElement;
  private resetBtn: HTMLButtonElement | null = null;
  private currentValue: OklchColor;
  private readonly defaultValue: OklchColor | null;
  private onChange: ((color: OklchColor) => void) | null = null;

  constructor(options: ColorPickerOptions) {
    this.currentValue = options.value;
    this.defaultValue = options.defaultValue ?? null;
    this.element = this.createElement(options);
    this.swatchElement = this.element.querySelector('.color-picker-swatch')!;
    this.textInput = this.element.querySelector('.color-picker-oklch')!;
    this.hexInput = this.element.querySelector('.color-picker-hex')!;
    this.nativeInput = this.element.querySelector('.color-picker-native')!;
    this.resetBtn = this.element.querySelector('.color-picker-reset');
    this.setupEventListeners();
    this.updateDisplay();
  }

  private createElement(options: ColorPickerOptions): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'form-field form-field-color';

    if (options.label) {
      const label = document.createElement('label');
      label.className = 'form-label';
      label.textContent = options.label;
      wrapper.appendChild(label);
    }

    if (options.description) {
      const desc = document.createElement('p');
      desc.className = 'form-description';
      desc.textContent = options.description;
      wrapper.appendChild(desc);
    }

    const picker = document.createElement('div');
    picker.className = 'color-picker';

    // Swatch preview (clickable → opens native picker)
    const preview = document.createElement('div');
    preview.className = 'color-picker-preview';
    preview.title = 'Click to open color picker';

    const swatchBg = document.createElement('div');
    swatchBg.className = 'color-picker-swatch-bg';
    preview.appendChild(swatchBg);

    const swatch = document.createElement('div');
    swatch.className = 'color-picker-swatch';
    preview.appendChild(swatch);

    // Hidden native color input
    const nativeInput = document.createElement('input');
    nativeInput.type = 'color';
    nativeInput.className = 'color-picker-native';
    preview.appendChild(nativeInput);

    picker.appendChild(preview);

    // Text inputs
    const inputs = document.createElement('div');
    inputs.className = 'color-picker-inputs';

    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.className = 'color-picker-hex';
    hexInput.placeholder = '#ffffff';
    hexInput.title = 'Hex color';
    inputs.appendChild(hexInput);

    const oklchInput = document.createElement('input');
    oklchInput.type = 'text';
    oklchInput.className = 'color-picker-oklch';
    oklchInput.placeholder = 'oklch(50% 0.1 180)';
    oklchInput.title = 'OKLCH color';
    inputs.appendChild(oklchInput);

    picker.appendChild(inputs);

    // Reset button (only when defaultValue is provided)
    if (options.defaultValue) {
      const resetBtn = document.createElement('button');
      resetBtn.className = 'color-picker-reset';
      resetBtn.title = 'Reset to default';
      resetBtn.type = 'button';
      resetBtn.textContent = '\u21BA';
      picker.appendChild(resetBtn);
    }

    wrapper.appendChild(picker);
    return wrapper;
  }

  private setupEventListeners(): void {
    // Swatch click → open native picker
    const preview = this.element.querySelector('.color-picker-preview')!;
    preview.addEventListener('click', () => {
      this.nativeInput.click();
    });

    // Native color picker change
    this.nativeInput.addEventListener('input', () => {
      const hex = this.nativeInput.value;
      try {
        const oklch = hexToOklch(hex);
        this.currentValue = oklch;
        this.updateDisplay();
        this.onChange?.(this.currentValue);
      } catch {
        // Ignore invalid values
      }
    });

    // OKLCH input change
    this.textInput.addEventListener('change', () => {
      const value = this.textInput.value.trim();
      const parsed = parseOklch(value);
      if (parsed) {
        this.currentValue = formatOklch(parsed);
        this.updateDisplay();
        this.onChange?.(this.currentValue);
      } else {
        this.textInput.value = this.currentValue;
      }
    });

    // Hex input change
    this.hexInput.addEventListener('change', () => {
      const value = this.hexInput.value.trim();
      try {
        const oklch = hexToOklch(value);
        this.currentValue = oklch;
        this.updateDisplay();
        this.onChange?.(this.currentValue);
      } catch {
        this.updateDisplay();
      }
    });

    // Reset button
    if (this.resetBtn && this.defaultValue) {
      this.resetBtn.addEventListener('click', () => {
        this.currentValue = this.defaultValue!;
        this.updateDisplay();
        this.onChange?.(this.currentValue);
      });
    }
  }

  private updateDisplay(): void {
    // Update swatch color
    this.swatchElement.style.backgroundColor = this.currentValue;

    // Update text inputs
    this.textInput.value = this.currentValue;

    // Convert to hex for inputs
    try {
      const hex = oklchToHex(this.currentValue);
      this.hexInput.value = hex;
      this.nativeInput.value = hex;
    } catch {
      this.hexInput.value = '';
    }

    // Show/hide reset button based on whether value differs from default
    if (this.resetBtn && this.defaultValue) {
      this.resetBtn.style.visibility =
        this.currentValue === this.defaultValue ? 'hidden' : 'visible';
    }
  }

  getElement(): HTMLElement {
    return this.element;
  }

  getValue(): OklchColor {
    return this.currentValue;
  }

  setValue(color: OklchColor): void {
    const parsed = parseOklch(color);
    if (parsed) {
      this.currentValue = formatOklch(parsed);
      this.updateDisplay();
    }
  }

  setOnChange(callback: (color: OklchColor) => void): void {
    this.onChange = callback;
  }
}

/**
 * Factory function
 */
export function createColorPicker(options: ColorPickerOptions): ColorPicker {
  return new ColorPicker(options);
}
