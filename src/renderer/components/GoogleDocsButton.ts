/**
 * GoogleDocsButton - Toolbar button for Google Docs sync with contextual states
 */

/**
 * Possible states for the Google Docs button
 */
export type GoogleDocsButtonState = 'unlinked' | 'needs-auth' | 'ready' | 'syncing';

/**
 * Callbacks for button interactions
 */
export interface GoogleDocsButtonCallbacks {
  onLinkRequest?: () => void;     // State: unlinked -> show link dialog
  onSignInRequest?: () => void;   // State: needs-auth -> trigger OAuth
  onSyncRequest?: () => void;     // State: ready -> trigger sync
  onUnlinkRequest?: () => void;   // Context: right-click or long press
}

/**
 * GoogleDocsButton component
 * A toolbar button that changes behavior based on Google Docs link/auth state
 */
export class GoogleDocsButton {
  private button: HTMLButtonElement;
  private icon: HTMLElement | null = null;
  private spinner: HTMLElement | null = null;
  private state: GoogleDocsButtonState = 'unlinked';
  private callbacks: GoogleDocsButtonCallbacks = {};
  private enabled = false;

  constructor(button: HTMLButtonElement) {
    this.button = button;
    this.icon = button.querySelector('#gdocs-icon');
    this.spinner = button.querySelector('#gdocs-spinner');
    this.setupEventListeners();
  }

  /**
   * Set up event listeners
   */
  private setupEventListeners(): void {
    this.button.addEventListener('click', () => {
      if (!this.enabled) return;
      switch (this.state) {
        case 'unlinked':
          this.callbacks.onLinkRequest?.();
          break;
        case 'needs-auth':
          this.callbacks.onSignInRequest?.();
          break;
        case 'ready':
          this.callbacks.onSyncRequest?.();
          break;
      }
    });
  }

  /**
   * Set the callbacks for button interactions
   */
  setCallbacks(callbacks: GoogleDocsButtonCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Set the button state, updating icon/spinner/title
   */
  setState(state: GoogleDocsButtonState): void {
    this.state = state;
    const syncing = state === 'syncing';

    if (this.icon) this.icon.classList.toggle('hidden', syncing);
    if (this.spinner) this.spinner.classList.toggle('hidden', !syncing);

    this.button.disabled = syncing || !this.enabled;

    // Update title
    const titles: Record<GoogleDocsButtonState, string> = {
      unlinked: 'Link to Google Docs',
      'needs-auth': 'Sign in to Google',
      ready: 'Sync to Google Docs',
      syncing: 'Syncing...',
    };
    this.button.title = titles[state];
  }

  /**
   * Enable or disable the button
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.button.disabled = !enabled || this.state === 'syncing';
  }

  /**
   * Show or hide the button entirely
   */
  setVisible(visible: boolean): void {
    this.button.classList.toggle('hidden', !visible);
  }

  /**
   * Get the current button state
   */
  getState(): GoogleDocsButtonState {
    return this.state;
  }

  /**
   * Cleanup
   */
  destroy(): void {
    // Event listeners are on the button element, will be GC'd
  }
}

/**
 * Factory function to create a GoogleDocsButton
 */
export function createGoogleDocsButton(button: HTMLButtonElement): GoogleDocsButton {
  return new GoogleDocsButton(button);
}
