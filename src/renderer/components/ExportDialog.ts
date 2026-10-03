/**
 * ExportDialog - the few choices behind Print and Export
 *
 * Theme for every kind of export; paper size, orientation and background
 * for the ones that go on paper. Choices are handed back to be remembered,
 * so the next export opens with them.
 */
import { Select, Toggle } from './FormControls';

import type { ExportPageSize, ExportPreferences, ExportTheme } from '@shared/types/export';

export type ExportKind = 'pdf' | 'html' | 'print';

/** What the user settled on; a subset of the preferences, minus the folder */
export type ExportChoices = Omit<ExportPreferences, 'lastDirectory'>;

const TITLES: Record<ExportKind, string> = {
  pdf: 'Export as PDF',
  html: 'Export as HTML',
  print: 'Print',
};

const CONFIRM_LABELS: Record<ExportKind, string> = {
  pdf: 'Export',
  html: 'Export',
  print: 'Print…',
};

export interface ExportDialog {
  /** Show the dialog; resolves with the choices, or null when dismissed */
  show(kind: ExportKind, initial: ExportChoices): Promise<ExportChoices | null>;
  destroy(): void;
}

class ExportDialogImpl implements ExportDialog {
  private overlay: HTMLElement | null = null;
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;

  show(kind: ExportKind, initial: ExportChoices): Promise<ExportChoices | null> {
    this.close();

    return new Promise((resolve) => {
      const choices: ExportChoices = { ...initial };
      const onPaper = kind !== 'html';

      const overlay = document.createElement('div');
      overlay.className = 'export-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'export-dialog-title');
      overlay.dataset['exportKind'] = kind;

      const dialog = document.createElement('div');
      dialog.className = 'export-dialog';
      dialog.innerHTML = `
        <h2 id="export-dialog-title" class="export-dialog-title">${TITLES[kind]}</h2>
        <div class="export-dialog-fields"></div>
        <div class="export-dialog-actions">
          <button type="button" class="export-dialog-btn" data-export-cancel>Cancel</button>
          <button type="button" class="export-dialog-btn export-dialog-btn-primary" data-export-confirm>${CONFIRM_LABELS[kind]}</button>
        </div>
      `;
      overlay.appendChild(dialog);

      const fields = dialog.querySelector('.export-dialog-fields')!;

      const theme = new Select({
        label: 'Theme',
        description: onPaper
          ? 'Light reads best on paper and keeps diagrams printable.'
          : 'The palette the page is saved in.',
        options: [
          { value: 'light', label: 'Light' },
          { value: 'current', label: 'As shown in the app' },
        ],
        value: choices.theme,
      });
      theme.setOnChange((value) => {
        choices.theme = value as ExportTheme;
      });
      fields.appendChild(theme.getElement());

      if (onPaper) {
        const pageSize = new Select({
          label: 'Paper Size',
          options: [
            { value: 'A4', label: 'A4' },
            { value: 'Letter', label: 'Letter' },
          ],
          value: choices.pageSize,
        });
        pageSize.setOnChange((value) => {
          choices.pageSize = value as ExportPageSize;
        });
        fields.appendChild(pageSize.getElement());

        const landscape = new Toggle({
          label: 'Landscape',
          value: choices.landscape,
        });
        landscape.setOnChange((value) => {
          choices.landscape = value;
        });
        fields.appendChild(landscape.getElement());

        const background = new Toggle({
          label: 'Print backgrounds',
          description: 'Code block, alert and table backgrounds. Off saves ink.',
          value: choices.printBackground,
        });
        background.setOnChange((value) => {
          choices.printBackground = value;
        });
        fields.appendChild(background.getElement());
      }

      const finish = (result: ExportChoices | null): void => {
        this.close();
        resolve(result);
      };

      dialog.querySelector('[data-export-cancel]')?.addEventListener('click', () => finish(null));
      dialog.querySelector('[data-export-confirm]')?.addEventListener('click', () => finish(choices));
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) finish(null);
      });

      this.onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(null);
        } else if (event.key === 'Enter' && !(event.target instanceof HTMLSelectElement)) {
          event.preventDefault();
          finish(choices);
        }
      };
      document.addEventListener('keydown', this.onKeyDown);

      document.body.appendChild(overlay);
      this.overlay = overlay;
      dialog.querySelector<HTMLButtonElement>('[data-export-confirm]')?.focus();
    });
  }

  destroy(): void {
    this.close();
  }

  private close(): void {
    if (this.onKeyDown) {
      document.removeEventListener('keydown', this.onKeyDown);
      this.onKeyDown = null;
    }
    this.overlay?.remove();
    this.overlay = null;
  }
}

export function createExportDialog(): ExportDialog {
  return new ExportDialogImpl();
}
