/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PreferencesPanel } from '../../../../src/renderer/components/PreferencesPanel';
import { DEFAULT_APP_PREFERENCES } from '../../../../src/preferences/defaults';

/**
 * The panel reads auth and file-association state on render, both async. Those
 * awaits are the whole reason section order needs pinning: a section that
 * finishes last would otherwise land last.
 */
function stubElectronAPI(): void {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    googleDocs: {
      getAuthStatus: vi.fn().mockResolvedValue({ isAuthenticated: false }),
      signOut: vi.fn(),
    },
    fileAssociation: {
      getStatus: vi.fn().mockResolvedValue({ isDefault: true, canSetDefault: false }),
    },
    preferences: { reset: vi.fn() },
  };
}

/** Let every render's awaited work settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function sectionTitles(): string[] {
  return Array.from(
    document.querySelectorAll('.collapsible-section .collapsible-title'),
  ).map((el) => el.textContent ?? '');
}

/** The badge text on the section with this title, or null if it has none. */
function badgeFor(title: string): string | null {
  const heading = Array.from(
    document.querySelectorAll('.collapsible-section .collapsible-title'),
  ).find((el) => el.textContent === title);
  const badge = heading?.parentElement?.querySelector('.collapsible-badge');
  return badge?.textContent ?? null;
}

describe('PreferencesPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    stubElectronAPI();
  });

  it('keeps Experimental Features last, below the Google Docs section', async () => {
    const panel = new PreferencesPanel();
    panel.updateValues(DEFAULT_APP_PREFERENCES);
    panel.open();
    await settle();

    const titles = sectionTitles();
    expect(titles).toContain('Experimental Features');
    expect(titles.at(-1)).toBe('Experimental Features');
  });

  it('pins Reset to Defaults to the panel, not to the end of the scrolling list', async () => {
    // Inside the scroll container the button rides up under the last section
    // whenever the content is short. It belongs to the panel.
    const panel = new PreferencesPanel();
    panel.updateValues(DEFAULT_APP_PREFERENCES);
    panel.open();
    await settle();

    const footer = document.querySelector('.preferences-footer');
    expect(footer?.closest('.preferences-content')).toBeNull();
    expect(footer?.parentElement?.classList.contains('preferences-panel')).toBe(true);
  });

  it('badges sections that only exist because an experimental feature is on', async () => {
    const panel = new PreferencesPanel();
    panel.updateValues(DEFAULT_APP_PREFERENCES);
    panel.open();
    await settle();

    expect(badgeFor('Google Docs')).toBe('exp');
    // Ordinary settings carry no badge, or the marker means nothing.
    expect(badgeFor('Appearance')).toBeNull();
  });
});
