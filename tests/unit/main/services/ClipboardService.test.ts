/**
 * ClipboardService: the plain-text alternative written alongside HTML.
 */
import { clipboard } from 'electron';
import { ClipboardService } from '@main/services/ClipboardService';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  clipboard: { write: vi.fn(), writeText: vi.fn() },
  // Electron 44+ writes ClipboardItem[]; keep the payloads so tests can read them
  ClipboardItem: class {
    constructor(public items: Record<string, unknown>) {}
  },
  dialog: { showSaveDialog: vi.fn() },
  nativeImage: { createFromBuffer: vi.fn() },
  BrowserWindow: class {},
}));

/** The MIME payloads of the single item handed to clipboard.write */
function written(): Record<string, unknown> {
  const [items] = vi.mocked(clipboard.write).mock.calls[0]!;
  expect(items).toHaveLength(1);
  return (items[0] as unknown as { items: Record<string, unknown> }).items;
}

describe('ClipboardService.writeHtml', () => {
  let service: ClipboardService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ClipboardService();
  });

  it('strips tags for the plain text when none is given', async () => {
    await service.writeHtml('<p>Hello <b>world</b></p>');
    expect(written()).toEqual({
      'text/html': '<p>Hello <b>world</b></p>',
      'text/plain': 'Hello world',
    });
  });

  it('uses the plain text it is handed', async () => {
    await service.writeHtml('<h1>Title</h1>', '# Title');
    expect(written()).toEqual({ 'text/html': '<h1>Title</h1>', 'text/plain': '# Title' });
  });

  it('keeps an empty plain text rather than falling back', async () => {
    await service.writeHtml('<p>x</p>', '');
    expect(written()).toEqual({ 'text/html': '<p>x</p>', 'text/plain': '' });
  });
});
