/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGoogleDocsButton } from '../../../../src/renderer/components/GoogleDocsButton';
import type {
  GoogleDocsButton,
  GoogleDocsButtonElements,
} from '../../../../src/renderer/components/GoogleDocsButton';

function makeGroup(): GoogleDocsButtonElements & { button: GoogleDocsButton } {
  document.body.innerHTML = `
    <div id="gdocs-group" class="toolbar-group gdocs-group">
      <button id="gdocs-pull-btn"><span class="gdocs-icon"></span></button>
      <button id="gdocs-sync-btn"><span class="gdocs-icon"></span></button>
      <button id="gdocs-target-btn"><span class="gdocs-icon"></span></button>
      <button id="gdocs-busy" class="gdocs-busy hidden"><span class="spinner-icon"></span></button>
    </div>`;
  const el = (id: string): HTMLButtonElement => document.getElementById(id) as HTMLButtonElement;
  const group = document.getElementById('gdocs-group') as HTMLElement;
  const elements: GoogleDocsButtonElements = {
    group,
    push: el('gdocs-sync-btn'),
    pull: el('gdocs-pull-btn'),
    target: el('gdocs-target-btn'),
    busy: el('gdocs-busy'),
  };
  return { ...elements, button: createGoogleDocsButton(elements) };
}

describe('GoogleDocsButton', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('syncs in the direction of the button that was clicked', () => {
    const { push, pull, button } = makeGroup();
    const onSyncRequest = vi.fn();
    button.setCallbacks({ onSyncRequest });
    button.setEnabled(true);
    button.setState('ready');

    push.click();
    pull.click();

    expect(onSyncRequest.mock.calls).toEqual([['push'], ['pull']]);
  });

  it('lets a linked file be pointed at a different Doc', () => {
    // Re-linking used to be reachable only before the first link, which left
    // no way to correct a document chosen by mistake.
    const { target, button } = makeGroup();
    const onLinkRequest = vi.fn();
    const onSyncRequest = vi.fn();
    button.setCallbacks({ onLinkRequest, onSyncRequest });
    button.setEnabled(true);
    button.setState('ready');

    target.click();

    expect(onLinkRequest).toHaveBeenCalledOnce();
    expect(onSyncRequest).not.toHaveBeenCalled();
  });

  describe('while syncing', () => {
    it('shows one spinner for the whole panel, not one per button', () => {
      const { group, busy, button } = makeGroup();
      button.setEnabled(true);
      button.setState('syncing');

      expect(busy.classList.contains('hidden')).toBe(false);
      expect(group.querySelectorAll(':scope > :not(.hidden) .spinner-icon')).toHaveLength(1);
    });

    it('disables every button in the panel', () => {
      const { push, pull, target, button } = makeGroup();
      button.setEnabled(true);
      button.setState('syncing');

      expect([push.disabled, pull.disabled, target.disabled]).toEqual([true, true, true]);
    });

    it('reopens progress from the spinner, so a dismissed bar is not lost', () => {
      // The buttons are disabled now, so the overlay is the only way back to a
      // progress bar the user dismissed.
      const { busy, button } = makeGroup();
      const onShowProgressRequest = vi.fn();
      const onSyncRequest = vi.fn();
      button.setCallbacks({ onShowProgressRequest, onSyncRequest });
      button.setEnabled(true);
      button.setState('syncing');

      busy.click();

      expect(onShowProgressRequest).toHaveBeenCalledOnce();
      expect(onSyncRequest).not.toHaveBeenCalled();
    });

    it('reads as busy to assistive tech', () => {
      const { group, button } = makeGroup();
      button.setEnabled(true);
      button.setState('syncing');

      expect(group.getAttribute('aria-busy')).toBe('true');
    });

    it('comes back to life once the sync ends', () => {
      const { push, group, busy, button } = makeGroup();
      button.setEnabled(true);
      button.setState('syncing');
      button.setState('ready');

      expect(busy.classList.contains('hidden')).toBe(true);
      expect(group.getAttribute('aria-busy')).toBe('false');
      expect(push.disabled).toBe(false);
    });
  });

  it('stays disabled when no file is open', () => {
    const { push, pull, target, button } = makeGroup();
    button.setEnabled(false);
    button.setState('ready');

    expect([push.disabled, pull.disabled, target.disabled]).toEqual([true, true, true]);
  });

  it('hides the whole panel when the feature is off', () => {
    const { group, button } = makeGroup();
    button.setVisible(false);
    expect(group.classList.contains('hidden')).toBe(true);
  });
});
