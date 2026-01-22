/**
 * ColorPicker - OKLCH color picker component
 *
 * A simplified color picker that supports OKLCH color input with
 * a preview swatch and text input for direct editing.
 */

import type { OklchColor } from '@shared/types';
import { parseOklch, formatOklch, hexToOklch, oklchToHex } from '@shared/utils';

/**
 * ColorPicker options
 */
export interface ColorPickerOptions {
  value: OklchColor;
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
  private currentValue: OklchColor;
  private onChange: ((color: OklchColor) => void) | null = null;

  constructor(options: ColorPickerOptions) {
    this.currentValue = options.value;
    this.element = this.createElement(options);
    this.swatchElement = this.element.querySelector('.color-picker-swatch')!;
    this.textInput = this.element.querySelector('.color-picker-oklch')!;
    this.hexInput = this.element.querySelector('.color-picker-hex')!;
    this.setupEventListeners();
    this.updateDisplay();
  }

  private createElement(options: ColorPickerOptions): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'form-field form-field-color';

    const labelHtml = options.label
      ? `<label class="form-label">${options.label}</label>`
      : '';
    const descHtml = options.description
      ? `<p class="form-description">${options.description}</p>`
      : '';

    wrapper.innerHTML = `
      ${labelHtml}
      ${descHtml}
      <div class="color-picker">
        <div class="color-picker-preview">
          <div class="color-picker-swatch-bg"></div>
          <div class="color-picker-swatch"></div>
        </div>
        <div class="color-picker-inputs">
          <input type="text" class="color-picker-hex" placeholder="#ffffff" title="Hex color">
          <input type="text" class="color-picker-oklch" placeholder="oklch(50% 0.1 180)" title="OKLCH color">
        </div>
      </div>
    `;

    return wrapper;
  }

  private setupEventListeners(): void {
    // OKLCH input change
    this.textInput.addEventListener('change', () => {
      const value = this.textInput.value.trim();
      const parsed = parseOklch(value);
      if (parsed) {
        this.currentValue = formatOklch(parsed);
        this.updateDisplay();
        this.onChange?.(this.currentValue);
      } else {
        // Reset to current valid value
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
        // Reset to current valid value
        this.updateDisplay();
      }
    });
  }

  private updateDisplay(): void {
    // Update swatch color
    this.swatchElement.style.backgroundColor = this.currentValue;

    // Update text inputs
    this.textInput.value = this.currentValue;

    // Convert to hex for the hex input
    try {
      this.hexInput.value = oklchToHex(this.currentValue);
    } catch {
      this.hexInput.value = '';
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
