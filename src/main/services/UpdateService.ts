/**
 * UpdateService - keeps the app current from GitHub Releases
 *
 * On macOS and Windows the work is done by Electron's own autoUpdater
 * (Squirrel), pointed at update.electronjs.org, which reads this repo's
 * releases and serves the right asset for the platform. Updates download in
 * the background; installing waits for the user to choose Restart, so an
 * edit in progress is never interrupted. On Linux there is no in-place
 * update: the latest release is looked up on GitHub and announced.
 *
 * Pre-releases are only ever announced, on any platform, when the beta
 * channel is on. A Mac App Store build gets its updates from the store and
 * never starts any of this; neither does a development build.
 */
import type { UpdateChannel, UpdatePreferences, UpdateStatus } from '@shared/types/updates';

/** How often an automatic check may run */
export const MIN_CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** How often the scheduler wakes while the app runs */
export const SCHEDULE_INTERVAL_MS = 4 * 60 * 60 * 1000;
/** Delay before the launch-time check, so startup is not slowed */
export const INITIAL_CHECK_DELAY_MS = 15 * 1000;

/** The part of Electron's autoUpdater this service uses */
export interface UpdaterLike {
  setFeedURL(options: { url: string }): void;
  checkForUpdates(): void;
  quitAndInstall(): void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

/** One release as GitHub lists it */
export interface GitHubRelease {
  tag_name: string;
  html_url: string;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
}

export interface UpdateServiceDeps {
  platform: NodeJS.Platform;
  arch: string;
  isPackaged: boolean;
  isMas: boolean;
  currentVersion: string;
  /** owner/repo on GitHub */
  repo: string;
  /** Electron's autoUpdater, or null where it cannot work */
  autoUpdater: UpdaterLike | null;
  /** Fetch JSON from a URL; rejects on failure */
  fetchJson: (url: string) => Promise<unknown>;
  getPreferences: () => UpdatePreferences;
  onStatus: (status: UpdateStatus) => void;
  now?: () => number;
  setTimeout?: typeof globalThis.setTimeout;
  setInterval?: typeof globalThis.setInterval;
}

/** Compare two semantic versions; negative when a < b. Pre-release tags sort below the release. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): { nums: number[]; pre: string | null } => {
    const cleaned = v.trim().replace(/^v/i, '');
    const [core = '', pre] = cleaned.split('-', 2);
    const nums = core.split('.').map((n) => Number.parseInt(n, 10) || 0);
    while (nums.length < 3) nums.push(0);
    return { nums, pre: pre ?? null };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0);
    if (d !== 0) return d;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

/**
 * The newest release the channel allows that is newer than the current
 * version, or null.
 */
export function newestEligible(
  releases: GitHubRelease[],
  currentVersion: string,
  channel: UpdateChannel
): GitHubRelease | null {
  let best: GitHubRelease | null = null;
  for (const release of releases) {
    if (release.draft) continue;
    if (release.prerelease && channel !== 'beta') continue;
    if (!/^v?\d+\.\d+/.test(release.tag_name)) continue;
    if (compareVersions(release.tag_name, currentVersion) <= 0) continue;
    if (!best || compareVersions(release.tag_name, best.tag_name) > 0) best = release;
  }
  return best;
}

export class UpdateService {
  private readonly deps: Required<Pick<UpdateServiceDeps, 'now' | 'setTimeout' | 'setInterval'>> & UpdateServiceDeps;
  private status: UpdateStatus;
  private lastCheckAt = 0;
  private started = false;
  private releaseNotes: string | null = null;
  private latestTag: string | null = null;

  constructor(deps: UpdateServiceDeps) {
    this.deps = {
      now: () => Date.now(),
      setTimeout: globalThis.setTimeout.bind(globalThis),
      setInterval: globalThis.setInterval.bind(globalThis),
      ...deps,
    };
    this.status = {
      state: this.supported() ? 'idle' : 'unsupported',
      currentVersion: deps.currentVersion,
      latestVersion: null,
      releaseUrl: null,
      prerelease: false,
      checkedAt: null,
      error: null,
    };
  }

  /** Whether this build can look for updates at all */
  supported(): boolean {
    return this.deps.isPackaged && !this.deps.isMas;
  }

  /** Whether Squirrel can download and install here */
  private canSelfUpdate(): boolean {
    return (
      this.supported() &&
      this.deps.autoUpdater !== null &&
      (this.deps.platform === 'darwin' || this.deps.platform === 'win32')
    );
  }

  getStatus(): UpdateStatus {
    return { ...this.status };
  }

  /**
   * Wire the updater and schedule the automatic checks. Safe to call once.
   */
  start(): void {
    if (this.started || !this.supported()) return;
    this.started = true;

    if (this.canSelfUpdate()) {
      this.wireAutoUpdater();
    }

    this.deps.setTimeout(() => void this.scheduledCheck(), INITIAL_CHECK_DELAY_MS);
    this.deps.setInterval(() => void this.scheduledCheck(), SCHEDULE_INTERVAL_MS);
  }

  /**
   * Check now. A scheduled check respects the hourly minimum and the
   * preference; a requested one always runs.
   */
  async check(options: { force?: boolean } = {}): Promise<UpdateStatus> {
    if (!this.supported()) return this.getStatus();
    if (this.status.state === 'checking' || this.status.state === 'downloading') return this.getStatus();
    if (this.status.state === 'downloaded') return this.getStatus();

    const now = this.deps.now();
    if (!options.force && now - this.lastCheckAt < MIN_CHECK_INTERVAL_MS) return this.getStatus();
    this.lastCheckAt = now;

    this.setStatus({ state: 'checking', error: null });

    try {
      const prefs = this.deps.getPreferences();
      if (this.canSelfUpdate()) {
        // Squirrel reports back through its events; meanwhile, the beta
        // channel also looks for a pre-release to announce
        this.deps.autoUpdater!.checkForUpdates();
        if (prefs.channel === 'beta') {
          await this.announceFromGitHub(prefs.channel, { onlyPrerelease: true });
        }
      } else {
        await this.announceFromGitHub(prefs.channel);
      }
    } catch (error) {
      this.setStatus({
        state: 'error',
        error: error instanceof Error ? error.message : 'Update check failed',
        checkedAt: new Date(this.deps.now()).toISOString(),
      });
    }
    return this.getStatus();
  }

  /** Restart into the downloaded update. Does nothing unless one is ready. */
  install(): void {
    if (this.status.state !== 'downloaded' || !this.deps.autoUpdater) return;
    this.deps.autoUpdater.quitAndInstall();
  }

  /** Markdown of the latest known release's notes, fetched on demand */
  async getReleaseNotes(): Promise<string | null> {
    if (this.releaseNotes !== null) return this.releaseNotes;
    const tag = this.latestTag ?? (this.status.latestVersion ? `v${this.status.latestVersion}` : null);
    if (!tag) return null;
    try {
      const release = (await this.deps.fetchJson(
        `https://api.github.com/repos/${this.deps.repo}/releases/tags/${encodeURIComponent(tag)}`
      )) as GitHubRelease;
      this.releaseNotes = release.body ?? '';
      return this.releaseNotes;
    } catch {
      return null;
    }
  }

  private async scheduledCheck(): Promise<void> {
    if (!this.deps.getPreferences().automatic) return;
    await this.check();
  }

  private wireAutoUpdater(): void {
    const updater = this.deps.autoUpdater!;
    const { platform, arch, repo, currentVersion } = this.deps;
    updater.setFeedURL({
      url: `https://update.electronjs.org/${repo}/${platform}-${arch}/${currentVersion}`,
    });

    updater.on('checking-for-update', () => this.setStatus({ state: 'checking', error: null }));
    updater.on('update-available', () => this.setStatus({ state: 'downloading', error: null }));
    updater.on('update-not-available', () => {
      // A pre-release announced by the beta channel stays announced
      if (this.status.state !== 'available') {
        this.setStatus({ state: 'up-to-date', checkedAt: new Date(this.deps.now()).toISOString(), error: null });
      }
    });
    updater.on('update-downloaded', (...args: unknown[]) => {
      const releaseName = typeof args[1] === 'string' ? args[1] : null;
      const releaseNotes = typeof args[2] === 'string' ? args[2] : null;
      const version = releaseName ? releaseName.replace(/^v/i, '') : null;
      this.releaseNotes = releaseNotes;
      this.latestTag = releaseName ? (releaseName.startsWith('v') ? releaseName : `v${releaseName}`) : null;
      this.setStatus({
        state: 'downloaded',
        latestVersion: version,
        releaseUrl: `https://github.com/${repo}/releases/tag/${this.latestTag ?? ''}`,
        prerelease: false,
        checkedAt: new Date(this.deps.now()).toISOString(),
        error: null,
      });
    });
    updater.on('error', (...args: unknown[]) => {
      const error = args[0];
      this.setStatus({
        state: 'error',
        error: error instanceof Error ? error.message : typeof error === 'string' ? error : 'Update failed',
        checkedAt: new Date(this.deps.now()).toISOString(),
      });
    });
  }

  /**
   * Look the releases up on GitHub and announce the newest the channel
   * allows. With `onlyPrerelease`, a stable newer release is left to
   * Squirrel and only a pre-release is announced.
   */
  private async announceFromGitHub(channel: UpdateChannel, options: { onlyPrerelease?: boolean } = {}): Promise<void> {
    const releases = (await this.deps.fetchJson(
      `https://api.github.com/repos/${this.deps.repo}/releases?per_page=20`
    )) as GitHubRelease[];
    if (!Array.isArray(releases)) throw new Error('Unexpected answer from GitHub');

    let newest = newestEligible(releases, this.deps.currentVersion, channel);
    if (options.onlyPrerelease && newest && !newest.prerelease) newest = null;

    const checkedAt = new Date(this.deps.now()).toISOString();
    if (!newest) {
      if (!options.onlyPrerelease) this.setStatus({ state: 'up-to-date', checkedAt, error: null });
      return;
    }

    this.latestTag = newest.tag_name;
    this.releaseNotes = newest.body ?? '';
    this.setStatus({
      state: 'available',
      latestVersion: newest.tag_name.replace(/^v/i, ''),
      releaseUrl: newest.html_url,
      prerelease: Boolean(newest.prerelease),
      checkedAt,
      error: null,
    });
  }

  private setStatus(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch };
    this.deps.onStatus(this.getStatus());
  }
}
