/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createExportDialog, type ExportChoices } from '@renderer/components/ExportDialog';

const INITIAL: ExportChoices = { theme: 'light', pageSize: 'A4', landscape: false, printBackground: true };

describe('ExportDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('offers paper options for PDF and print but not HTML', async () => {
    const dialog = createExportDialog();
    const pending = dialog.show('html', INITIAL);
    expect(document.querySelectorAll('.export-dialog select')).toHaveLength(1);
    expect(document.querySelectorAll('.export-dialog input[type="checkbox"]')).toHaveLength(0);
    document.querySelector<HTMLButtonElement>('[data-export-cancel]')!.click();
    expect(await pending).toBeNull();

    const pdf = dialog.show('pdf', INITIAL);
    expect(document.querySelectorAll('.export-dialog select')).toHaveLength(2);
    expect(document.querySelectorAll('.export-dialog input[type="checkbox"]')).toHaveLength(2);
    document.querySelector<HTMLButtonElement>('[data-export-cancel]')!.click();
    expect(await pdf).toBeNull();
  });

  it('returns the choices made', async () => {
    const dialog = createExportDialog();
    const pending = dialog.show('pdf', INITIAL);

    const selects = document.querySelectorAll<HTMLSelectElement>('.export-dialog select');
    selects[1]!.value = 'Letter';
    selects[1]!.dispatchEvent(new Event('change'));
    const toggles = document.querySelectorAll<HTMLInputElement>('.export-dialog input[type="checkbox"]');
    toggles[0]!.click();

    document.querySelector<HTMLButtonElement>('[data-export-confirm]')!.click();
    expect(await pending).toEqual({ theme: 'light', pageSize: 'Letter', landscape: true, printBackground: true });
    expect(document.querySelector('.export-overlay')).toBeNull();
  });

  it('cancels on Escape and confirms on Enter', async () => {
    const dialog = createExportDialog();
    const first = dialog.show('html', INITIAL);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(await first).toBeNull();

    const second = dialog.show('html', { ...INITIAL, theme: 'current' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(await second).toMatchObject({ theme: 'current' });
  });

  it('closes when the backdrop is clicked', async () => {
    const dialog = createExportDialog();
    const pending = dialog.show('print', INITIAL);
    document.querySelector<HTMLElement>('.export-overlay')!.click();
    expect(await pending).toBeNull();
  });
});
