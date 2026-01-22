# Technical Debt: Electron Fuses Security Hardening Disabled

**Created:** 2026-01-22
**Status:** Open
**Priority:** Medium

---

## Summary

The Electron Fuses plugin (`@electron-forge/plugin-fuses`) is disabled in `forge.config.ts` to allow the app to run without Apple Developer code signing credentials.

## Problem

Electron Fuses modify the Electron binary at package time to enable/disable various security features. However, this modification invalidates the ad-hoc code signature that Electron applies by default.

Without proper Apple Developer credentials for re-signing:
- The app ends up with an **invalid code signature**
- macOS Gatekeeper shows **"app is damaged and can't be opened"** error
- Users cannot launch the app from Finder

## Current State

The FusesPlugin has been removed from the plugins array in `forge.config.ts`. The app now packages with a valid ad-hoc signature and can be launched on macOS.

**Disabled security features:**
- `RunAsNode: false` - Prevents `ELECTRON_RUN_AS_NODE` environment variable
- `EnableCookieEncryption: true` - Encrypts cookies on disk
- `EnableNodeOptionsEnvironmentVariable: false` - Prevents `NODE_OPTIONS` manipulation
- `EnableNodeCliInspectArguments: false` - Disables `--inspect` debugging flags
- `EnableEmbeddedAsarIntegrityValidation: true` - Validates ASAR archive integrity
- `OnlyLoadAppFromAsar: true` - Prevents loading code from outside ASAR

## Impact

The app functions correctly but lacks defense-in-depth security hardening. These are primarily protections against:
- Local privilege escalation attacks
- Tampering with the application bundle
- Debugging/inspection of production apps

**Risk level:** Low for a markdown viewer app with no sensitive data handling.

## Resolution

When Apple Developer credentials are available:

1. **Re-enable FusesPlugin** in `forge.config.ts`:
```typescript
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

// In plugins array:
new FusesPlugin({
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
}),
```

2. **Configure code signing** in `packagerConfig.osxSign` (already stubbed)

3. **Configure notarization** in `packagerConfig.osxNotarize` (already stubbed)

4. **Add GitHub secrets:**
   - `MACOS_CERTIFICATE` - Base64-encoded .p12 certificate
   - `MACOS_CERTIFICATE_PWD` - Certificate password
   - `MACOS_KEYCHAIN_PWD` - Keychain password
   - `APPLE_ID` - Apple Developer account email
   - `APPLE_PASSWORD` - App-specific password
   - `APPLE_TEAM_ID` - Apple Developer Team ID

## References

- [Electron Fuses Documentation](https://www.electronjs.org/docs/latest/tutorial/fuses)
- [Electron Forge FusesPlugin](https://www.electronforge.io/config/plugins/fuses)
- [Apple Code Signing Guide](https://developer.apple.com/support/code-signing/)
