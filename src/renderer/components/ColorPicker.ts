/**
 * ColorPicker - OKLCH color picker component
 *
 * A color picker with a clickable swatch that opens a custom OKLCH
 * canvas picker (Lightness×Chroma plane + hue strip), text inputs
 * for direct hex/OKLCH editing, and an optional reset-to-default button.
 */

import type { OklchColor } from '@shared/types';
import { parseOklch, formatOklch, hexToOklch, oklchToHex } from '@shared/utils';
import { OklchColorWidget } from './OklchColorWidget';

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
  private resetBtn: HTMLButtonElement | null = null;
  private currentValue: OklchColor;
  private readonly defaultValue: OklchColor | null;
  private onChange: ((color: OklchColor) => void) | null = null;

  // OKLCH widget popup state
  private widget: OklchColorWidget | null = null;
  private widgetPopup: HTMLElement | null = null;
  private boundClosePopup: ((e: MouseEvent) => void) | null = null;
  private boundCloseOnEscape: ((e: KeyboardEvent) => void) | null = null;

  constructor(options: ColorPickerOptions) {
    this.currentValue = options.value;
    this.defaultValue = options.defaultValue ?? null;
    this.element = this.createElement(options);
    this.swatchElement = this.element.querySelector('.color-picker-swatch')!;
    this.textInput = this.element.querySelector('.color-picker-oklch')!;
    this.hexInput = this.element.querySelector('.color-picker-hex')!;
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

    // Swatch preview (clickable → opens OKLCH widget)
    const preview = document.createElement('div');
    preview.className = 'color-picker-preview';
    preview.title = 'Click to open color picker';

    const swatchBg = document.createElement('div');
    swatchBg.className = 'color-picker-swatch-bg';
    preview.appendChild(swatchBg);

    const swatch = document.createElement('div');
    swatch.className = 'color-picker-swatch';
    preview.appendChild(swatch);

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
    // Swatch click → open OKLCH widget popup
    const preview = this.element.querySelector('.color-picker-preview')!;
    preview.addEventListener('click', () => {
      if (this.widgetPopup) {
        this.closeWidget();
      } else {
        this.openWidget();
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

  private openWidget(): void {
    const parsed = parseOklch(this.currentValue);
    if (!parsed) return;

    // Create widget
    this.widget = new OklchColorWidget({
      lightness: parsed.lightness,
      chroma: parsed.chroma,
      hue: parsed.hue,
    });

    this.widget.setOnChange((l, c, h) => {
      this.currentValue = formatOklch({
        lightness: l,
        chroma: c,
        hue: h,
        alpha: parsed.alpha,
      });
      this.updateDisplay();
      this.onChange?.(this.currentValue);
    });

    // Create popup container
    this.widgetPopup = document.createElement('div');
    this.widgetPopup.className = 'oklch-widget-popup';
    this.widgetPopup.appendChild(this.widget.getElement());

    // Position relative to the swatch
    const preview = this.element.querySelector('.color-picker-preview')!;
    const rect = preview.getBoundingClientRect();

    this.widgetPopup.style.left = `${rect.left}px`;
    this.widgetPopup.style.top = `${rect.bottom + 6}px`;

    document.body.appendChild(this.widgetPopup);

    // Adjust if popup goes off-screen
    requestAnimationFrame(() => {
      if (!this.widgetPopup) return;
      const popupRect = this.widgetPopup.getBoundingClientRect();
      if (popupRect.bottom > window.innerHeight - 8) {
        this.widgetPopup.style.top = `${rect.top - popupRect.height - 6}px`;
      }
      if (popupRect.right > window.innerWidth - 8) {
        this.widgetPopup.style.left = `${window.innerWidth - popupRect.width - 8}px`;
      }
    });

    // Close on click outside (delay to avoid catching the opening click)
    setTimeout(() => {
      this.boundClosePopup = (e: MouseEvent) => {
        if (
          this.widgetPopup &&
          !this.widgetPopup.contains(e.target as Node) &&
          !(e.target as Node === this.element.querySelector('.color-picker-preview') ||
            this.element.querySelector('.color-picker-preview')?.contains(e.target as Node))
        ) {
          this.closeWidget();
        }
      };
      document.addEventListener('mousedown', this.boundClosePopup);
    }, 0);

    // Close on Escape
    this.boundCloseOnEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.closeWidget();
      }
    };
    document.addEventListener('keydown', this.boundCloseOnEscape);
  }

  private closeWidget(): void {
    if (this.widget) {
      this.widget.destroy();
      this.widget = null;
    }
    if (this.widgetPopup) {
      this.widgetPopup.remove();
      this.widgetPopup = null;
    }
    if (this.boundClosePopup) {
      document.removeEventListener('mousedown', this.boundClosePopup);
      this.boundClosePopup = null;
    }
    if (this.boundCloseOnEscape) {
      document.removeEventListener('keydown', this.boundCloseOnEscape);
      this.boundCloseOnEscape = null;
    }
  }

  private updateDisplay(): void {
    // Update swatch color
    this.swatchElement.style.backgroundColor = this.currentValue;

    // Update text inputs
    this.textInput.value = this.currentValue;

    // Convert to hex
    try {
      this.hexInput.value = oklchToHex(this.currentValue);
    } catch {
      this.hexInput.value = '';
    }

    // Update widget if open
    if (this.widget) {
      const parsed = parseOklch(this.currentValue);
      if (parsed) {
        this.widget.setValues(parsed.lightness, parsed.chroma, parsed.hue);
      }
    }

    // Show/hide reset button
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
