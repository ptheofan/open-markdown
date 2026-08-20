/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGoogleDocsButton } from '../../../../src/renderer/components/GoogleDocsButton';

function makeButton(): HTMLButtonElement {
  document.body.innerHTML = `
    <button id="gdocs-sync-btn">
      <span id="gdocs-icon"></span>
      <span id="gdocs-spinner" class="hidden"></span>
    </button>`;
  return document.getElementById('gdocs-sync-btn') as HTMLButtonElement;
}

describe('GoogleDocsButton', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('syncs when ready', () => {
    const el = makeButton();
    const btn = createGoogleDocsButton(el);
    const onSyncRequest = vi.fn();
    btn.setCallbacks({ onSyncRequest });
    btn.setEnabled(true);
    btn.setState('ready');

    el.click();
    expect(onSyncRequest).toHaveBeenCalledOnce();
  });

  describe('while syncing', () => {
    it('still receives clicks, so a dismissed progress bar can be reopened', () => {
      const el = makeButton();
      const btn = createGoogleDocsButton(el);
      btn.setEnabled(true);
      btn.setState('syncing');

      // A genuinely `disabled` button never fires click, which would make the
      // progress bar unreachable once dismissed.
      expect(el.disabled).toBe(false);
    });

    it('reopens progress rather than starting a second sync', () => {
      const el = makeButton();
      const btn = createGoogleDocsButton(el);
      const onSyncRequest = vi.fn();
      const onShowProgressRequest = vi.fn();
      btn.setCallbacks({ onSyncRequest, onShowProgressRequest });
      btn.setEnabled(true);
      btn.setState('syncing');

      el.click();

      expect(onShowProgressRequest).toHaveBeenCalledOnce();
      expect(onSyncRequest).not.toHaveBeenCalled();
    });

    it('still reads as busy to assistive tech and to CSS', () => {
      const el = makeButton();
      const btn = createGoogleDocsButton(el);
      btn.setEnabled(true);
      btn.setState('syncing');

      expect(el.getAttribute('aria-busy')).toBe('true');
      expect(el.classList.contains('is-syncing')).toBe(true);
    });

    it('is no longer busy once the sync ends', () => {
      const el = makeButton();
      const btn = createGoogleDocsButton(el);
      btn.setEnabled(true);
      btn.setState('syncing');
      btn.setState('ready');

      expect(el.getAttribute('aria-busy')).toBe('false');
      expect(el.classList.contains('is-syncing')).toBe(false);
    });
  });

  it('stays truly disabled when the feature is unavailable', () => {
    const el = makeButton();
    const btn = createGoogleDocsButton(el);
    btn.setEnabled(false);
    btn.setState('ready');
    expect(el.disabled).toBe(true);
  });
});
