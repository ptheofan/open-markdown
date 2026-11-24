import type { ResolvedTheme, ThemeMode } from '@shared/types';

/**
 * Turns a theme mode into a concrete light/dark theme, latest request wins.
 *
 * Resolving `system` waits on an IPC round trip, unless the caller already
 * knows the system theme (an OS appearance change event carries it). If
 * another resolve() starts while a lookup is in flight, the older lookup
 * resolves to `null` so its caller can skip applying a theme the user has
 * already moved away from.
 */
export class ThemeResolver {
  private generation = 0;

  constructor(private readonly getSystem: () => Promise<ResolvedTheme>) {}

  async resolve(mode: ThemeMode, knownSystem?: ResolvedTheme): Promise<ResolvedTheme | null> {
    const generation = ++this.generation;
    if (mode !== 'system') return mode;
    if (knownSystem) return knownSystem;

    let resolved: ResolvedTheme;
    try {
      resolved = await this.getSystem();
    } catch {
      resolved = 'light';
    }
    return generation === this.generation ? resolved : null;
  }
}
