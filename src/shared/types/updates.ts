/**
 * Update types: checking for, downloading and installing new versions of
 * the app from GitHub Releases.
 */

/** Which releases an install follows */
export type UpdateChannel = 'stable' | 'beta';

export interface UpdatePreferences {
  /** Check on launch and every few hours */
  automatic: boolean;
  /** Also announce pre-releases (they are never installed automatically) */
  channel: UpdateChannel;
}

export type UpdateState =
  /** This build does not update itself: a Mac App Store or development build */
  | 'unsupported'
  /** Nothing checked yet */
  | 'idle'
  | 'checking'
  | 'up-to-date'
  /** A newer release exists but has to be fetched by hand (Linux, pre-releases) */
  | 'available'
  | 'downloading'
  /** The update is on disk; restarting installs it */
  | 'downloaded'
  | 'error';

export interface UpdateStatus {
  state: UpdateState;
  currentVersion: string;
  /** The newest version known, when one newer than the current was found */
  latestVersion: string | null;
  /** Page of that release on GitHub */
  releaseUrl: string | null;
  /** Whether that release is a pre-release */
  prerelease: boolean;
  /** ISO time of the last completed check, or null */
  checkedAt: string | null;
  error: string | null;
}

/**
 * Update API exposed to the renderer
 */
export interface UpdatesAPI {
  getStatus: () => Promise<UpdateStatus>;
  /** Check now, whatever the schedule says */
  check: () => Promise<UpdateStatus>;
  /** Restart into a downloaded update */
  install: () => Promise<void>;
  /** The release notes (markdown) of the latest known release, or null */
  getReleaseNotes: () => Promise<string | null>;
  onStatus: (callback: (status: UpdateStatus) => void) => () => void;
}
