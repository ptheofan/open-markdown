/**
 * GoogleDocsSettings - Settings section for Google Docs preferences
 *
 * Creates a settings section that can be integrated into the existing
 * preferences panel. Handles custom credentials toggle and sign-out.
 */

/**
 * GoogleDocsSettings component
 * A settings section for Google Docs configuration
 */
export class GoogleDocsSettings {
  private container: HTMLElement | null = null;

  /**
   * Creates and returns a settings section element using safe DOM methods
   */
  createSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'gdocs-settings-section';

    // Title
    const title = document.createElement('h4');
    title.className = 'gdocs-settings-title';
    title.textContent = 'Google Docs';
    section.appendChild(title);

    // Custom credentials toggle row
    const toggleRow = document.createElement('label');
    toggleRow.className = 'gdocs-settings-row';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.id = 'gdocs-custom-creds-toggle';
    const toggleLabel = document.createElement('span');
    toggleLabel.textContent = 'Use custom API credentials';
    toggleRow.appendChild(toggle);
    toggleRow.appendChild(toggleLabel);
    section.appendChild(toggleRow);

    // Custom credentials fields (hidden by default)
    const fields = document.createElement('div');
    fields.id = 'gdocs-custom-creds-fields';
    fields.className = 'gdocs-settings-fields hidden';

    const clientIdLabel = document.createElement('label');
    clientIdLabel.className = 'gdocs-settings-label';
    clientIdLabel.textContent = 'Client ID';

    const clientIdInput = document.createElement('input');
    clientIdInput.type = 'text';
    clientIdInput.id = 'gdocs-client-id-input';
    clientIdInput.className = 'gdocs-dialog-input';
    clientIdInput.placeholder = 'your-client-id.apps.googleusercontent.com';
    clientIdLabel.appendChild(clientIdInput);
    fields.appendChild(clientIdLabel);
    section.appendChild(fields);

    // Sign out button row
    const signOutRow = document.createElement('div');
    signOutRow.className = 'gdocs-settings-row';
    const signOutBtn = document.createElement('button');
    signOutBtn.id = 'gdocs-sign-out-btn';
    signOutBtn.className = 'gdocs-dialog-btn gdocs-dialog-btn-secondary';
    signOutBtn.style.marginTop = '8px';
    signOutBtn.textContent = 'Sign out of Google';
    signOutRow.appendChild(signOutBtn);
    section.appendChild(signOutRow);

    // Event listeners
    toggle.addEventListener('change', () => {
      fields.classList.toggle('hidden', !toggle.checked);
      this.savePreferences(toggle.checked, clientIdInput.value);
    });

    clientIdInput.addEventListener('change', () => {
      this.savePreferences(toggle.checked, clientIdInput.value);
    });

    signOutBtn.addEventListener('click', () => {
      window.electronAPI.googleDocs.signOut();
    });

    this.container = section;
    this.loadPreferences(toggle, clientIdInput, fields);

    return section;
  }

  /**
   * Load current preferences and populate the UI
   */
  private async loadPreferences(
    toggle: HTMLInputElement,
    clientIdInput: HTMLInputElement,
    fields: HTMLElement,
  ): Promise<void> {
    const prefs = await window.electronAPI.preferences.get();
    const gdocs = prefs.core.googleDocs;
    toggle.checked = gdocs.useCustomCredentials;
    clientIdInput.value = gdocs.customClientId;
    fields.classList.toggle('hidden', !gdocs.useCustomCredentials);
  }

  /**
   * Save Google Docs preferences
   */
  private async savePreferences(useCustom: boolean, clientId: string): Promise<void> {
    await window.electronAPI.preferences.set({
      core: {
        googleDocs: {
          useCustomCredentials: useCustom,
          customClientId: clientId,
        },
      },
    });
  }

  /**
   * Get the container element, if created
   */
  getContainer(): HTMLElement | null {
    return this.container;
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.container = null;
  }
}

/**
 * Factory function to create a GoogleDocsSettings
 */
export function createGoogleDocsSettings(): GoogleDocsSettings {
  return new GoogleDocsSettings();
}
