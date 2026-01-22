/**
 * PreferencesPanel - Slide-in sidebar for application preferences
 */

import type {
  AppPreferences,
  DeepPartial,
  PluginPreferencesSchema,
  PreferenceField,
  ColorPair,
} from '@shared/types';
import { CollapsibleSection } from './CollapsibleSection';
import { Select, Toggle, NumberInput, TextInput } from './FormControls';
import { ColorPicker } from './ColorPicker';
import { ColorPairPicker } from './ColorPairPicker';

/**
 * PreferencesPanel callbacks
 */
export interface PreferencesPanelCallbacks {
  onPreferencesChange?: (updates: DeepPartial<AppPreferences>) => void;
  onClose?: () => void;
}

/**
 * PreferencesPanel component
 */
export class PreferencesPanel {
  private element: HTMLElement;
  private overlay: HTMLElement;
  private closeBtn: HTMLElement;
  private sectionsContainer: HTMLElement;
  private resetBtn: HTMLElement;

  private callbacks: PreferencesPanelCallbacks = {};
  private currentPreferences: AppPreferences | null = null;
  private pluginSchemas: Map<string, PluginPreferencesSchema> = new Map();
  private _isOpen = false;

  constructor() {
    this.element = this.createElement();
    this.overlay = this.element.querySelector('.preferences-overlay')!;
    this.closeBtn = this.element.querySelector('.preferences-close-btn')!;
    this.sectionsContainer = this.element.querySelector(
      '.preferences-sections'
    )!;
    this.resetBtn = this.element.querySelector('.preferences-reset-btn')!;
    this.setupEventListeners();
  }

  private createElement(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'preferences-container';

    container.innerHTML = `
      <div class="preferences-overlay"></div>
      <aside class="preferences-panel">
        <header class="preferences-header">
          <h2 class="preferences-title">Preferences</h2>
          <button class="preferences-close-btn" type="button" title="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/>
            </svg>
          </button>
        </header>
        <div class="preferences-content">
          <div class="preferences-sections"></div>
          <div class="preferences-footer">
            <button class="preferences-reset-btn" type="button">Reset to Defaults</button>
          </div>
        </div>
      </aside>
    `;

    return container;
  }

  private setupEventListeners(): void {
    // Close on overlay click
    this.overlay.addEventListener('click', () => {
      this.close();
    });

    // Close button
    this.closeBtn.addEventListener('click', () => {
      this.close();
    });

    // Reset to defaults
    this.resetBtn.addEventListener('click', () => {
      void window.electronAPI.preferences.reset().then((prefs) => {
        this.updateValues(prefs);
      });
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this._isOpen) {
        this.close();
      }
    });
  }

  /**
   * Open the panel
   */
  open(): void {
    if (this._isOpen) return;

    document.body.appendChild(this.element);
    // Trigger reflow for animation
    void this.element.offsetHeight;

    requestAnimationFrame(() => {
      this.element.classList.add('is-open');
    });

    this._isOpen = true;
  }

  /**
   * Close the panel
   */
  close(): void {
    if (!this._isOpen) return;

    this.element.classList.remove('is-open');
    this.callbacks.onClose?.();

    // Remove from DOM after animation
    setTimeout(() => {
      if (this.element.parentNode) {
        this.element.parentNode.removeChild(this.element);
      }
    }, 300);

    this._isOpen = false;
  }

  /**
   * Check if panel is open
   */
  isOpen(): boolean {
    return this._isOpen;
  }

  /**
   * Update displayed values
   */
  updateValues(preferences: AppPreferences): void {
    this.currentPreferences = preferences;
    this.renderSections();
  }

  /**
   * Set plugin schemas for dynamic UI
   */
  setPluginSchemas(schemas: Map<string, PluginPreferencesSchema>): void {
    this.pluginSchemas = schemas;
    if (this.currentPreferences) {
      this.renderSections();
    }
  }

  /**
   * Set callbacks
   */
  setCallbacks(callbacks: Partial<PreferencesPanelCallbacks>): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Render all preference sections
   */
  private renderSections(): void {
    this.sectionsContainer.innerHTML = '';

    if (!this.currentPreferences) return;

    this.renderAppearanceSection();
    this.renderTypographySection();
    this.renderPluginSections();
  }

  /**
   * Render the Appearance section
   */
  private renderAppearanceSection(): void {
    if (!this.currentPreferences) return;

    const section = new CollapsibleSection({
      title: 'Appearance',
      initiallyOpen: true,
    });

    const fields: HTMLElement[] = [];

    // Theme mode selector
    const themeSelect = new Select({
      label: 'Theme Mode',
      options: [
        { value: 'system', label: 'System' },
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ],
      value: this.currentPreferences.core.theme.mode,
    });
    themeSelect.setOnChange((value) => {
      this.emitChange({
        core: { theme: { mode: value as 'light' | 'dark' | 'system' } },
      });
    });
    fields.push(themeSelect.getElement());

    // Background colors
    const bgPicker = new ColorPairPicker({
      label: 'Background Color',
      value: this.currentPreferences.core.theme.background,
    });
    bgPicker.setOnChange((pair) => {
      this.emitChange({ core: { theme: { background: pair } } });
    });
    fields.push(bgPicker.getElement());

    section.setContent(fields);
    this.sectionsContainer.appendChild(section.getElement());
  }

  /**
   * Render the Typography section
   */
  private renderTypographySection(): void {
    if (!this.currentPreferences) return;

    const section = new CollapsibleSection({
      title: 'Typography',
      initiallyOpen: false,
    });

    const fields: HTMLElement[] = [];

    // Base font size
    const fontSizeInput = new TextInput({
      label: 'Base Font Size',
      value: this.currentPreferences.core.typography.baseFontSize,
      placeholder: '14px',
    });
    fontSizeInput.setOnChange((value) => {
      this.emitChange({ core: { typography: { baseFontSize: value } } });
    });
    fields.push(fontSizeInput.getElement());

    // Link color
    const linkColorPicker = new ColorPairPicker({
      label: 'Link Color',
      value: this.currentPreferences.core.typography.link.color,
    });
    linkColorPicker.setOnChange((pair) => {
      this.emitChange({ core: { typography: { link: { color: pair } } } });
    });
    fields.push(linkColorPicker.getElement());

    // Heading subsections
    const headingLevels = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;
    for (const level of headingLevels) {
      const headingSection = new CollapsibleSection({
        title: `Heading ${level.charAt(1)}`,
        initiallyOpen: false,
      });

      const headingFields: HTMLElement[] = [];
      const headingStyle =
        this.currentPreferences.core.typography[level];

      // Color
      const colorPicker = new ColorPairPicker({
        label: 'Color',
        value: headingStyle.color,
      });
      colorPicker.setOnChange((pair) => {
        this.emitChange({
          core: { typography: { [level]: { color: pair } } },
        });
      });
      headingFields.push(colorPicker.getElement());

      // Font size
      const sizeInput = new TextInput({
        label: 'Font Size',
        value: headingStyle.fontSize,
        placeholder: '2em',
      });
      sizeInput.setOnChange((value) => {
        this.emitChange({
          core: { typography: { [level]: { fontSize: value } } },
        });
      });
      headingFields.push(sizeInput.getElement());

      // Font weight
      const weightInput = new NumberInput({
        label: 'Font Weight',
        value: headingStyle.fontWeight,
        min: 100,
        max: 900,
        step: 100,
      });
      weightInput.setOnChange((value) => {
        this.emitChange({
          core: { typography: { [level]: { fontWeight: value } } },
        });
      });
      headingFields.push(weightInput.getElement());

      headingSection.setContent(headingFields);
      fields.push(headingSection.getElement());
    }

    section.setContent(fields);
    this.sectionsContainer.appendChild(section.getElement());
  }

  /**
   * Render plugin preference sections
   */
  private renderPluginSections(): void {
    if (!this.currentPreferences) return;

    for (const [pluginId, schema] of this.pluginSchemas) {
      const pluginPrefs = this.currentPreferences.plugins[pluginId] ?? {};

      for (const schemaSection of schema.sections) {
        const section = new CollapsibleSection({
          title: schemaSection.title,
          initiallyOpen: false,
        });

        const fields: HTMLElement[] = [];

        for (const field of schemaSection.fields) {
          const fieldElement = this.renderPluginField(
            pluginId,
            field,
            this.getNestedValue(pluginPrefs, field.key) ?? field.defaultValue
          );
          if (fieldElement) {
            fields.push(fieldElement);
          }
        }

        section.setContent(fields);
        this.sectionsContainer.appendChild(section.getElement());
      }
    }
  }

  /**
   * Render a single plugin preference field
   */
  private renderPluginField(
    pluginId: string,
    field: PreferenceField,
    currentValue: unknown
  ): HTMLElement | null {
    switch (field.type) {
      case 'boolean': {
        const toggle = new Toggle({
          label: field.label,
          description: field.description,
          value: currentValue as boolean,
        });
        toggle.setOnChange((value) => {
          this.emitPluginChange(pluginId, field.key, value);
        });
        return toggle.getElement();
      }

      case 'select': {
        const select = new Select({
          label: field.label,
          description: field.description,
          options: field.options,
          value: currentValue as string,
        });
        select.setOnChange((value) => {
          this.emitPluginChange(pluginId, field.key, value);
        });
        return select.getElement();
      }

      case 'number': {
        const numberInput = new NumberInput({
          label: field.label,
          description: field.description,
          value: currentValue as number,
          min: field.min,
          max: field.max,
          step: field.step,
        });
        numberInput.setOnChange((value) => {
          this.emitPluginChange(pluginId, field.key, value);
        });
        return numberInput.getElement();
      }

      case 'color': {
        const colorPicker = new ColorPicker({
          label: field.label,
          description: field.description,
          value: currentValue as string,
        });
        colorPicker.setOnChange((value) => {
          this.emitPluginChange(pluginId, field.key, value);
        });
        return colorPicker.getElement();
      }

      case 'color-pair': {
        const colorPairPicker = new ColorPairPicker({
          label: field.label,
          description: field.description,
          value: currentValue as ColorPair,
        });
        colorPairPicker.setOnChange((value) => {
          this.emitPluginChange(pluginId, field.key, value);
        });
        return colorPairPicker.getElement();
      }

      case 'string': {
        const textInput = new TextInput({
          label: field.label,
          description: field.description,
          value: currentValue as string,
          placeholder: field.placeholder,
        });
        textInput.setOnChange((value) => {
          this.emitPluginChange(pluginId, field.key, value);
        });
        return textInput.getElement();
      }

      default:
        return null;
    }
  }

  /**
   * Emit a preference change
   */
  private emitChange(updates: DeepPartial<AppPreferences>): void {
    this.callbacks.onPreferencesChange?.(updates);
  }

  /**
   * Emit a plugin preference change
   */
  private emitPluginChange(
    pluginId: string,
    key: string,
    value: unknown
  ): void {
    // Build nested object from dot-notation key
    const nested = this.buildNestedObject(key, value);
    this.emitChange({
      plugins: {
        [pluginId]: nested,
      },
    });
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: unknown, path: string): unknown {
    const keys = path.split('.');
    let current = obj as Record<string, unknown>;

    for (const key of keys) {
      if (current === undefined || current === null) {
        return undefined;
      }
      current = current[key] as Record<string, unknown>;
    }

    return current;
  }

  /**
   * Build nested object from dot-notation path
   */
  private buildNestedObject(path: string, value: unknown): Record<string, unknown> {
    const keys = path.split('.');
    const result: Record<string, unknown> = {};
    let current = result;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (key !== undefined) {
        current[key] = {};
        current = current[key] as Record<string, unknown>;
      }
    }

    const lastKey = keys[keys.length - 1];
    if (lastKey !== undefined) {
      current[lastKey] = value;
    }
    return result;
  }
}

/**
 * Factory function
 */
export function createPreferencesPanel(): PreferencesPanel {
  return new PreferencesPanel();
}
