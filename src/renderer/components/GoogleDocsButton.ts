/**
 * GoogleDocsButton - the toolbar panel for the file's linked Google Doc.
 *
 * One panel, because it is one document: pull, push, and the button that
 * chooses which Doc the file points at. Direction is never inferred -- the
 * user says which way, and the answer is the same either way when there is
 * nothing to carry: "nothing to push" is a result, not a silence.
 *
 * A sync is one operation, so the panel busies as a whole: every button goes
 * disabled and a single spinner covers the group. That spinner is itself a
 * button -- it is the way back to a progress bar the user dismissed, which is
 * otherwise unreachable once the buttons stop taking clicks.
 */

/** Which way the user asked to sync. */
export type SyncButtonDirection = 'push' | 'pull';

/**
 * Possible states for the Google Docs panel
 */
export type GoogleDocsButtonState = 'unlinked' | 'needs-auth' | 'ready' | 'syncing';

/** The toolbar elements this component owns. */
export interface GoogleDocsButtonElements {
  group: HTMLElement;
  push: HTMLButtonElement;
  pull: HTMLButtonElement;
  target: HTMLButtonElement;
  busy: HTMLElement;
}

/**
 * Callbacks for button interactions
 */
export interface GoogleDocsButtonCallbacks {
  onLinkRequest?: () => void;     // Choose (or change) the target document
  onSignInRequest?: () => void;   // State: needs-auth -> trigger OAuth
  onSyncRequest?: (direction: SyncButtonDirection) => void; // State: ready
  onShowProgressRequest?: () => void; // State: syncing -> reopen the progress bar
}

const TITLES: Record<GoogleDocsButtonState, Record<SyncButtonDirection, string>> = {
  unlinked: { push: 'Link to Google Docs', pull: 'Link to Google Docs' },
  'needs-auth': { push: 'Sign in to Google', pull: 'Sign in to Google' },
  ready: { push: 'Push to Google Doc', pull: 'Pull from Google Doc' },
  syncing: { push: 'Syncing...', pull: 'Syncing...' },
};

const TARGET_TITLES: Record<GoogleDocsButtonState, string> = {
  unlinked: 'Choose a Google Doc to sync with',
  'needs-auth': 'Choose a Google Doc to sync with',
  ready: 'Sync with a different Google Doc',
  syncing: 'Syncing...',
};

export class GoogleDocsButton {
  private elements: GoogleDocsButtonElements;
  private directional: Array<{ el: HTMLButtonElement; direction: SyncButtonDirection }>;
  private state: GoogleDocsButtonState = 'unlinked';
  private callbacks: GoogleDocsButtonCallbacks = {};
  private enabled = false;

  constructor(elements: GoogleDocsButtonElements) {
    this.elements = elements;
    this.directional = [
      { el: elements.push, direction: 'push' },
      { el: elements.pull, direction: 'pull' },
    ];
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    for (const { el, direction } of this.directional) {
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
            break; // disabled while busy; the overlay handles it
        }
      });
    }

    // Picking is what grants access to a document, so re-picking is also how
    // the target is changed -- there is no separate "change" path.
    this.elements.target.addEventListener('click', () => {
      if (!this.enabled || this.state === 'syncing') return;
      this.callbacks.onLinkRequest?.();
    });

    this.elements.busy.addEventListener('click', () => {
      this.callbacks.onShowProgressRequest?.();
    });
  }

  setCallbacks(callbacks: GoogleDocsButtonCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Set the panel state, updating titles and the busy overlay
   */
  setState(state: GoogleDocsButtonState): void {
    this.state = state;
    const syncing = state === 'syncing';

    this.elements.group.setAttribute('aria-busy', syncing ? 'true' : 'false');
    this.elements.busy.classList.toggle('hidden', !syncing);

    for (const { el, direction } of this.directional) {
      el.title = TITLES[state][direction];
    }
    this.elements.target.title = TARGET_TITLES[state];
    this.applyDisabled();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.applyDisabled();
  }

  setVisible(visible: boolean): void {
    this.elements.group.classList.toggle('hidden', !visible);
  }

  getState(): GoogleDocsButtonState {
    return this.state;
  }

  private applyDisabled(): void {
    const disabled = !this.enabled || this.state === 'syncing';
    for (const el of [this.elements.push, this.elements.pull, this.elements.target]) {
      el.disabled = disabled;
    }
  }

  destroy(): void {
    // Event listeners are on the button elements, will be GC'd
  }
}

export function createGoogleDocsButton(
  elements: GoogleDocsButtonElements,
): GoogleDocsButton {
  return new GoogleDocsButton(elements);
}
