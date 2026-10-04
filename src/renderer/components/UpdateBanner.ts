/**
 * UpdateBanner - a bar at the bottom of the window when a new version is in
 *
 * Downloaded: "Open Markdown 1.6.0 is ready" with Restart, What's new and
 * Later. Available but not installable here (Linux, a pre-release): the
 * same with Download instead of Restart. Never modal, never on a timer:
 * the user decides, and Later keeps it away until a different version shows.
 */
import type { UpdateStatus } from '@shared/types/updates';

export interface UpdateBannerCallbacks {
  onInstall: () => void;
  onDownload: (releaseUrl: string) => void;
  onShowNotes: () => void;
}

export class UpdateBanner {
  private readonly element: HTMLElement;
  private readonly text: HTMLElement;
  private readonly primary: HTMLButtonElement;
  private dismissedVersion: string | null = null;
  private status: UpdateStatus | null = null;

  constructor(container: HTMLElement, private readonly callbacks: UpdateBannerCallbacks) {
    this.element = document.createElement('div');
    this.element.className = 'update-banner';
    this.element.setAttribute('role', 'status');
    this.element.hidden = true;
    this.element.innerHTML = `
      <span class="update-banner-text"></span>
      <span class="update-banner-actions">
        <button type="button" class="update-banner-btn update-banner-btn-primary" data-update-primary></button>
        <button type="button" class="update-banner-btn" data-update-notes>What's new</button>
        <button type="button" class="update-banner-btn" data-update-later>Later</button>
      </span>
    `;
    this.text = this.element.querySelector('.update-banner-text')!;
    this.primary = this.element.querySelector('[data-update-primary]')!;

    this.primary.addEventListener('click', () => {
      if (!this.status) return;
      if (this.status.state === 'downloaded') this.callbacks.onInstall();
      else if (this.status.releaseUrl) this.callbacks.onDownload(this.status.releaseUrl);
    });
    this.element.querySelector('[data-update-notes]')?.addEventListener('click', () => this.callbacks.onShowNotes());
    this.element.querySelector('[data-update-later]')?.addEventListener('click', () => {
      this.dismissedVersion = this.status?.latestVersion ?? null;
      this.element.hidden = true;
    });

    container.appendChild(this.element);
  }

  /** Show, update or hide the bar for this status */
  update(status: UpdateStatus): void {
    this.status = status;
    const announce = status.state === 'downloaded' || status.state === 'available';
    if (!announce || !status.latestVersion || status.latestVersion === this.dismissedVersion) {
      this.element.hidden = true;
      return;
    }

    const kind = status.prerelease ? 'pre-release ' : '';
    if (status.state === 'downloaded') {
      this.text.textContent = `Open Markdown ${status.latestVersion} is ready to install.`;
      this.primary.textContent = 'Restart to update';
    } else {
      this.text.textContent = `Open Markdown ${kind}${status.latestVersion} is available.`;
      this.primary.textContent = 'Download';
    }
    this.element.dataset['state'] = status.state;
    this.element.hidden = false;
  }

  isVisible(): boolean {
    return !this.element.hidden;
  }
}

export function createUpdateBanner(container: HTMLElement, callbacks: UpdateBannerCallbacks): UpdateBanner {
  return new UpdateBanner(container, callbacks);
}
