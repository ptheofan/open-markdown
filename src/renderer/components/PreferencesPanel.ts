/**
 * PreferencesPanel - Slide-in sidebar for application preferences
 */

import type {
  AppPreferences,
  DeepPartial,
  PluginPreferencesSchema,
  PreferenceField,
  ColorPair,
  FileAssociationStatus,
  ExternalEditorId,
} from '@shared/types';
import { CollapsibleSection } from './CollapsibleSection';
import { Select, Toggle, NumberInput, TextInput, FontSelect } from './FormControls';
import { ColorPicker } from './ColorPicker';
import { ColorPairPicker } from './ColorPairPicker';
import { DEFAULT_CORE_PREFERENCES } from '../../preferences/defaults';

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
  private renderGeneration = 0;
  private sectionsBuilt = false;

  // Stored control references for in-place updates
  private themeSelect: Select | null = null;
  private bgPicker: ColorPairPicker | null = null;
  private fontFamilyInput: FontSelect | null = null;
  private monoFontFamilyInput: FontSelect | null = null;
  private fontSizeInput: TextInput | null = null;
  private linkColorPicker: ColorPairPicker | null = null;
  private headingControls: Map<string, { color: ColorPairPicker; size: TextInput; weight: NumberInput }> = new Map();
  private externalEditorSelect: Select | null = null;
  private customCommandInput: TextInput | null = null;
  private customCommandField: HTMLElement | null = null;

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
   * Update displayed values — updates controls in-place when possible
   */
  updateValues(preferences: AppPreferences): void {
    this.currentPreferences = preferences;

    if (!this.sectionsBuilt) {
      this.renderSections();
      return;
    }

    // Update existing controls in-place (no DOM teardown)
    this.themeSelect?.setValue(preferences.core.theme.mode);
    this.bgPicker?.setValue(preferences.core.theme.background);
    this.fontFamilyInput?.setValue(preferences.core.typography.fontFamily);
    this.monoFontFamilyInput?.setValue(preferences.core.typography.monoFontFamily);
    this.fontSizeInput?.setValue(preferences.core.typography.baseFontSize);
    this.linkColorPicker?.setValue(preferences.core.typography.link.color);

    this.externalEditorSelect?.setValue(preferences.core.externalEditor.editor);
    this.customCommandInput?.setValue(preferences.core.externalEditor.customCommand);
    this.updateCustomCommandVisibility(preferences.core.externalEditor.editor);

    for (const [level, controls] of this.headingControls) {
      const style = preferences.core.typography[level as keyof typeof preferences.core.typography] as { color: ColorPair; fontSize: string; fontWeight: number };
      controls.color.setValue(style.color);
      controls.size.setValue(style.fontSize);
      controls.weight.setValue(style.fontWeight);
    }
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
    this.renderGeneration++;
    this.sectionsBuilt = false;
    this.sectionsContainer.replaceChildren();

    if (!this.currentPreferences) return;

    void this.renderSystemSection(this.renderGeneration);
    this.renderExternalEditorSection();
    this.renderAppearanceSection();
    this.renderTypographySection();
    this.renderPluginSections();
    this.sectionsBuilt = true;
  }

  /**
   * Render the System section with file association settings
   */
  private async renderSystemSection(generation: number): Promise<void> {
    const section = new CollapsibleSection({
      title: 'System',
      initiallyOpen: true,
    });

    const fields: HTMLElement[] = [];

    // File association field
    const fieldWrapper = document.createElement('div');
    fieldWrapper.className = 'form-field form-field-action';

    // Fetch current status
    let status: FileAssociationStatus;
    try {
      status = await window.electronAPI.fileAssociation.getStatus();
    } catch {
      status = { canSetDefault: false, isDefault: false };
    }

    // A newer renderSections() call already cleared and rebuilt the container
    if (generation !== this.renderGeneration) return;

    const canSet = status.canSetDefault;
    const isDefault = status.isDefault;

    fieldWrapper.innerHTML = `
      <label class="form-label">Default Application</label>
      <p class="form-description">Set Open Markdown as the default app for .md, .markdown, .mdown, .mkdn, and .mkd files.</p>
      <div class="action-button-row">
        <button class="action-button" type="button" ${!canSet || isDefault ? 'disabled' : ''}>
          ${isDefault ? 'Already Default' : 'Set as Default'}
        </button>
        <span class="action-button-status ${isDefault ? 'status-success' : !canSet ? 'status-info' : ''}">
          ${isDefault ? '✓ Already set' : !canSet ? 'Only available in packaged app' : ''}
        </span>
      </div>
    `;

    const button = fieldWrapper.querySelector('.action-button') as HTMLButtonElement;
    const statusEl = fieldWrapper.querySelector('.action-button-status') as HTMLElement;

    if (canSet && !isDefault) {
      button.addEventListener('click', () => {
        void (async () => {
        button.disabled = true;
        button.textContent = 'Setting...';
        statusEl.textContent = '';
        statusEl.className = 'action-button-status';

        try {
          const result = await window.electronAPI.fileAssociation.setAsDefault();

          if (result.success) {
            statusEl.textContent = '✓ Successfully set';
            statusEl.className = 'action-button-status status-success';
            button.textContent = 'Already Default';
          } else {
            const errorMessages: Record<string, string> = {
              NOT_SUPPORTED: 'Not supported on this platform',
              NOT_PACKAGED: 'Only available in packaged app',
              PERMISSION_DENIED: 'Permission denied',
              DUTI_NOT_FOUND: 'Configuration tool not found',
              UNKNOWN: 'An error occurred',
            };
            statusEl.textContent = errorMessages[result.error ?? 'UNKNOWN'] ?? 'Failed';
            statusEl.className = 'action-button-status status-error';
            button.disabled = false;
            button.textContent = 'Set as Default';
          }
        } catch {
          statusEl.textContent = 'An error occurred';
          statusEl.className = 'action-button-status status-error';
          button.disabled = false;
          button.textContent = 'Set as Default';
        }
        })();
      });
    }

    fields.push(fieldWrapper);

    section.setContent(fields);
    this.sectionsContainer.insertBefore(
      section.getElement(),
      this.sectionsContainer.firstChild
    );
  }

  /**
   * Render the External Editor section
   */
  private renderExternalEditorSection(): void {
    if (!this.currentPreferences) return;

    const section = new CollapsibleSection({
      title: 'External Editor',
      initiallyOpen: true,
    });

    const fields: HTMLElement[] = [];

    // Editor preset selector
    this.externalEditorSelect = new Select({
      label: 'Editor',
      description: 'Choose an IDE or editor to open files in.',
      options: [
        { value: 'none', label: 'None' },
        { value: 'vscode', label: 'VS Code' },
        { value: 'cursor', label: 'Cursor' },
        { value: 'webstorm', label: 'WebStorm' },
        { value: 'sublime', label: 'Sublime Text' },
        { value: 'zed', label: 'Zed' },
        { value: 'custom', label: 'Custom...' },
      ],
      value: this.currentPreferences.core.externalEditor.editor,
    });
    this.externalEditorSelect.setOnChange((value) => {
      this.emitChange({
        core: { externalEditor: { editor: value as ExternalEditorId } },
      });
      // Toggle custom command field visibility
      this.updateCustomCommandVisibility(value);
    });
    fields.push(this.externalEditorSelect.getElement());

    // Custom command input (conditionally visible)
    this.customCommandField = document.createElement('div');
    this.customCommandField.className = 'form-field';
    if (this.currentPreferences.core.externalEditor.editor !== 'custom') {
      this.customCommandField.classList.add('hidden');
    }

    this.customCommandInput = new TextInput({
      label: 'Custom Command',
      description: 'The command to launch your editor (e.g., code, subl, vim).',
      value: this.currentPreferences.core.externalEditor.customCommand,
      placeholder: 'e.g., code',
    });
    this.customCommandInput.setOnChange((value) => {
      this.emitChange({
        core: { externalEditor: { customCommand: value } },
      });
    });
    this.customCommandField.appendChild(this.customCommandInput.getElement());
    fields.push(this.customCommandField);

    section.setContent(fields);
    this.sectionsContainer.appendChild(section.getElement());
  }

  /**
   * Toggle visibility of the custom command input based on editor selection
   */
  private updateCustomCommandVisibility(editor: string): void {
    if (!this.customCommandField) return;
    if (editor === 'custom') {
      this.customCommandField.classList.remove('hidden');
    } else {
      this.customCommandField.classList.add('hidden');
    }
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
    this.themeSelect = new Select({
      label: 'Theme Mode',
      options: [
        { value: 'system', label: 'System' },
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ],
      value: this.currentPreferences.core.theme.mode,
    });
    this.themeSelect.setOnChange((value) => {
      this.emitChange({
        core: { theme: { mode: value as 'light' | 'dark' | 'system' } },
      });
    });
    fields.push(this.themeSelect.getElement());

    // Background colors
    this.bgPicker = new ColorPairPicker({
      label: 'Background Color',
      value: this.currentPreferences.core.theme.background,
      defaultValue: DEFAULT_CORE_PREFERENCES.theme.background,
    });
    this.bgPicker.setOnChange((pair) => {
      this.emitChange({ core: { theme: { background: pair } } });
    });
    fields.push(this.bgPicker.getElement());

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

    // Font family
    this.fontFamilyInput = new FontSelect({
      label: 'Font Family',
      value: this.currentPreferences.core.typography.fontFamily,
    });
    this.fontFamilyInput.setOnChange((value) => {
      this.emitChange({ core: { typography: { fontFamily: value } } });
    });
    fields.push(this.fontFamilyInput.getElement());

    // Monospace font family
    this.monoFontFamilyInput = new FontSelect({
      label: 'Monospace Font Family',
      value: this.currentPreferences.core.typography.monoFontFamily,
    });
    this.monoFontFamilyInput.setOnChange((value) => {
      this.emitChange({ core: { typography: { monoFontFamily: value } } });
    });
    fields.push(this.monoFontFamilyInput.getElement());

    // Base font size
    this.fontSizeInput = new TextInput({
      label: 'Base Font Size',
      value: this.currentPreferences.core.typography.baseFontSize,
      placeholder: '14px',
    });
    this.fontSizeInput.setOnChange((value) => {
      this.emitChange({ core: { typography: { baseFontSize: value } } });
    });
    fields.push(this.fontSizeInput.getElement());

    // Separator before link color
    fields.push(this.createSeparator());

    // Link color
    this.linkColorPicker = new ColorPairPicker({
      label: 'Link Color',
      value: this.currentPreferences.core.typography.link.color,
      defaultValue: DEFAULT_CORE_PREFERENCES.typography.link.color,
    });
    this.linkColorPicker.setOnChange((pair) => {
      this.emitChange({ core: { typography: { link: { color: pair } } } });
    });
    fields.push(this.linkColorPicker.getElement());

    // Heading fields inline
    this.headingControls.clear();
    const headingLevels = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;
    for (const level of headingLevels) {
      fields.push(this.createSeparator());

      const headingLabel = document.createElement('label');
      headingLabel.className = 'form-label form-group-label';
      headingLabel.textContent = `Heading ${level.charAt(1)}`;
      fields.push(headingLabel);

      const headingStyle =
        this.currentPreferences.core.typography[level];

      // Color
      const defaultHeadingStyle = DEFAULT_CORE_PREFERENCES.typography[level];
      const colorPicker = new ColorPairPicker({
        label: 'Color',
        value: headingStyle.color,
        defaultValue: defaultHeadingStyle.color,
      });
      colorPicker.setOnChange((pair) => {
        this.emitChange({
          core: { typography: { [level]: { color: pair } } },
        });
      });
      fields.push(colorPicker.getElement());

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
      fields.push(sizeInput.getElement());

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
      fields.push(weightInput.getElement());

      this.headingControls.set(level, { color: colorPicker, size: sizeInput, weight: weightInput });
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
          defaultValue: field.defaultValue,
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
          defaultValue: field.defaultValue,
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
   * Create a visual separator line between form field groups
   */
  private createSeparator(): HTMLElement {
    const hr = document.createElement('hr');
    hr.className = 'form-separator';
    return hr;
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
