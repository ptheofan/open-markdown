/**
 * GoogleDocsButton - the toolbar's push and pull actions for a linked Doc.
 *
 * Two buttons, one state machine. Direction is never inferred: the user says
 * which way, and the answer is the same either way when there is nothing to
 * carry -- "nothing to push" is a result, not a silence.
 *
 * Before a document is linked or the user is signed in, both buttons do the
 * one thing that can be done, so neither is a dead end.
 */

/** Which way the user asked to sync. */
export type SyncButtonDirection = 'push' | 'pull';

/**
 * Possible states for the Google Docs buttons
 */
export type GoogleDocsButtonState = 'unlinked' | 'needs-auth' | 'ready' | 'syncing';

/**
 * Callbacks for button interactions
 */
export interface GoogleDocsButtonCallbacks {
  onLinkRequest?: () => void;     // State: unlinked -> show link dialog
  onSignInRequest?: () => void;   // State: needs-auth -> trigger OAuth
  onSyncRequest?: (direction: SyncButtonDirection) => void; // State: ready
  onShowProgressRequest?: () => void; // State: syncing -> reopen the progress bar
  onUnlinkRequest?: () => void;   // Context: right-click or long press
}

const TITLES: Record<GoogleDocsButtonState, Record<SyncButtonDirection, string>> = {
  unlinked: { push: 'Link to Google Docs', pull: 'Link to Google Docs' },
  'needs-auth': { push: 'Sign in to Google', pull: 'Sign in to Google' },
  ready: { push: 'Push to Google Doc', pull: 'Pull from Google Doc' },
  syncing: { push: 'Syncing...', pull: 'Syncing...' },
};

export class GoogleDocsButton {
  private buttons: Array<{ el: HTMLButtonElement; direction: SyncButtonDirection }>;
  private state: GoogleDocsButtonState = 'unlinked';
  private callbacks: GoogleDocsButtonCallbacks = {};
  private enabled = false;

  constructor(pushButton: HTMLButtonElement, pullButton?: HTMLButtonElement | null) {
    this.buttons = [
      { el: pushButton, direction: 'push' as const },
      ...(pullButton ? [{ el: pullButton, direction: 'pull' as const }] : []),
    ];
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    for (const { el, direction } of this.buttons) {
      el.addEventListener('click', () => {
        if (!this.enabled) return;
        switch (this.state) {
          case 'unlinked':
            this.callbacks.onLinkRequest?.();
            break;
          case 'needs-auth':
            this.callbacks.onSignInRequest?.();
            break;
          case 'ready':
            this.callbacks.onSyncRequest?.(direction);
            break;
          case 'syncing':
            // Not a second sync -- the click reopens a dismissed progress bar.
            this.callbacks.onShowProgressRequest?.();
            break;
        }
      });
    }
  }

  setCallbacks(callbacks: GoogleDocsButtonCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Set the button state, updating icon/spinner/title
   */
  setState(state: GoogleDocsButtonState): void {
    this.state = state;
    const syncing = state === 'syncing';

    for (const { el, direction } of this.buttons) {
      el.querySelector('.gdocs-icon')?.classList.toggle('hidden', syncing);
      el.querySelector('.gdocs-spinner')?.classList.toggle('hidden', !syncing);

      // Deliberately NOT the `disabled` attribute while syncing: a disabled
      // button never fires click, which would strand the user with no way to
      // reopen a progress bar they dismissed. It still reads as busy.
      el.disabled = !this.enabled;
      el.setAttribute('aria-busy', syncing ? 'true' : 'false');
      el.classList.toggle('is-syncing', syncing);
      el.title = TITLES[state][direction];
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    for (const { el } of this.buttons) el.disabled = !enabled;
  }

  setVisible(visible: boolean): void {
    for (const { el } of this.buttons) el.classList.toggle('hidden', !visible);
  }

  getState(): GoogleDocsButtonState {
    return this.state;
  }

  destroy(): void {
    // Event listeners are on the button elements, will be GC'd
  }
}

export function createGoogleDocsButton(
  pushButton: HTMLButtonElement,
  pullButton?: HTMLButtonElement | null,
): GoogleDocsButton {
  return new GoogleDocsButton(pushButton, pullButton);
}
