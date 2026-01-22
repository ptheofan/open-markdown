/**
 * ColorPairPicker - Light/Dark color pair picker component
 */

import type { OklchColor, ColorPair } from '@shared/types';
import { ColorPicker } from './ColorPicker';

/**
 * ColorPairPicker options
 */
export interface ColorPairPickerOptions {
  value: ColorPair;
  label?: string;
  description?: string;
}

/**
 * ColorPairPicker component
 */
export class ColorPairPicker {
  private element: HTMLElement;
  private lightPicker: ColorPicker;
  private darkPicker: ColorPicker;
  private currentValue: ColorPair;
  private onChange: ((pair: ColorPair) => void) | null = null;

  constructor(options: ColorPairPickerOptions) {
    this.currentValue = { ...options.value };
    this.element = this.createElement(options);

    // Create child color pickers
    this.lightPicker = new ColorPicker({
      value: options.value.light,
      label: 'Light',
    });
    this.darkPicker = new ColorPicker({
      value: options.value.dark,
      label: 'Dark',
    });

    // Add pickers to container
    const pickersContainer = this.element.querySelector('.color-pair-pickers')!;
    pickersContainer.appendChild(this.lightPicker.getElement());
    pickersContainer.appendChild(this.darkPicker.getElement());

    this.setupEventListeners();
  }

  private createElement(options: ColorPairPickerOptions): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'form-field form-field-color-pair';

    const labelHtml = options.label
      ? `<label class="form-label">${options.label}</label>`
      : '';
    const descHtml = options.description
      ? `<p class="form-description">${options.description}</p>`
      : '';

    wrapper.innerHTML = `
      ${labelHtml}
      ${descHtml}
      <div class="color-pair-pickers"></div>
    `;

    return wrapper;
  }

  private setupEventListeners(): void {
    this.lightPicker.setOnChange((color: OklchColor) => {
      this.currentValue.light = color;
      this.onChange?.(this.currentValue);
    });

    this.darkPicker.setOnChange((color: OklchColor) => {
      this.currentValue.dark = color;
      this.onChange?.(this.currentValue);
    });
  }

  getElement(): HTMLElement {
    return this.element;
  }

  getValue(): ColorPair {
    return { ...this.currentValue };
  }

  setValue(pair: ColorPair): void {
    this.currentValue = { ...pair };
    this.lightPicker.setValue(pair.light);
    this.darkPicker.setValue(pair.dark);
  }

  setOnChange(callback: (pair: ColorPair) => void): void {
    this.onChange = callback;
  }
}

/**
 * Factory function
 */
export function createColorPairPicker(
  options: ColorPairPickerOptions
): ColorPairPicker {
  return new ColorPairPicker(options);
}
