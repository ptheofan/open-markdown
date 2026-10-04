/**
 * ReleaseNotesDialog - "What's new", rendered with the app's own renderer
 */

export interface ReleaseNotesDialog {
  /** Show the notes; `render` turns the markdown into HTML */
  show(title: string, markdown: string, render: (markdown: string) => string): void;
  close(): void;
}

class ReleaseNotesDialogImpl implements ReleaseNotesDialog {
  private overlay: HTMLElement | null = null;
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;

  show(title: string, markdown: string, render: (markdown: string) => string): void {
    this.close();

    const overlay = document.createElement('div');
    overlay.className = 'export-overlay release-notes-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const dialog = document.createElement('div');
    dialog.className = 'export-dialog release-notes-dialog';
    const heading = document.createElement('h2');
    heading.className = 'export-dialog-title';
    heading.textContent = title;
    const body = document.createElement('div');
    body.className = 'release-notes-body markdown-body';
    body.innerHTML = markdown.trim() ? render(markdown) : '<p>No release notes.</p>';
    const actions = document.createElement('div');
    actions.className = 'export-dialog-actions';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'export-dialog-btn export-dialog-btn-primary';
    close.textContent = 'Close';
    close.addEventListener('click', () => this.close());
    actions.appendChild(close);
    dialog.append(heading, body, actions);
    overlay.appendChild(dialog);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });
    this.onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    };
    document.addEventListener('keydown', this.onKeyDown);

    document.body.appendChild(overlay);
    this.overlay = overlay;
    close.focus();
  }

  close(): void {
    if (this.onKeyDown) {
      document.removeEventListener('keydown', this.onKeyDown);
      this.onKeyDown = null;
    }
    this.overlay?.remove();
    this.overlay = null;
  }
}

export function createReleaseNotesDialog(): ReleaseNotesDialog {
  return new ReleaseNotesDialogImpl();
}
