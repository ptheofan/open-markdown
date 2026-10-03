/**
 * ClipboardService: the plain-text alternative written alongside HTML.
 */
import { clipboard } from 'electron';
import { ClipboardService } from '@main/services/ClipboardService';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  clipboard: { write: vi.fn(), writeText: vi.fn(), writeImage: vi.fn() },
  dialog: { showSaveDialog: vi.fn() },
  nativeImage: { createFromBuffer: vi.fn() },
  BrowserWindow: class {},
}));

describe('ClipboardService.writeHtml', () => {
  let service: ClipboardService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ClipboardService();
  });

  it('strips tags for the plain text when none is given', () => {
    service.writeHtml('<p>Hello <b>world</b></p>');
    expect(clipboard.write).toHaveBeenCalledWith({
      html: '<p>Hello <b>world</b></p>',
      text: 'Hello world',
    });
  });

  it('uses the plain text it is handed', () => {
    service.writeHtml('<h1>Title</h1>', '# Title');
    expect(clipboard.write).toHaveBeenCalledWith({
      html: '<h1>Title</h1>',
      text: '# Title',
    });
  });

  it('keeps an empty plain text rather than falling back', () => {
    service.writeHtml('<p>x</p>', '');
    expect(clipboard.write).toHaveBeenCalledWith({ html: '<p>x</p>', text: '' });
  });
});
