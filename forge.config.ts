import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { execSync } from 'child_process';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Markdown Viewer',
    executableName: 'markdown-viewer',
    appBundleId: 'com.aralu.markdown-viewer',
    appCategoryType: 'public.app-category.developer-tools',
    asar: true,
    icon: './resources/icons/icon',
    extraResource: ['./resources/bin'],
    // macOS code signing - enabled when APPLE_TEAM_ID is set (indicates CI release build)
    osxSign: process.env['APPLE_TEAM_ID']
      ? {
          identity: 'Developer ID Application',
          optionsForFile: () => ({
            entitlements: './resources/entitlements.mac.plist',
            hardenedRuntime: true,
          }),
        }
      : undefined,
    // macOS notarization using app-specific password
    // Set SKIP_NOTARIZATION=1 to skip notarization (for testing signing only)
    osxNotarize:
      !process.env['SKIP_NOTARIZATION'] &&
      process.env['APPLE_ID'] &&
      process.env['APPLE_ID_PASSWORD'] &&
      process.env['APPLE_TEAM_ID']
        ? {
            appleId: process.env['APPLE_ID'],
            appleIdPassword: process.env['APPLE_ID_PASSWORD'],
            teamId: process.env['APPLE_TEAM_ID'],
          }
        : undefined,
    // File associations for markdown files
    protocols: [
      {
        name: 'Markdown Viewer',
        schemes: ['markdown-viewer'],
      },
    ],
    // Extended info for macOS
    extendInfo: {
      CFBundleDocumentTypes: [
        {
          CFBundleTypeExtensions: ['md', 'markdown', 'mdown', 'mkdn', 'mkd'],
          CFBundleTypeName: 'Markdown Document',
          CFBundleTypeRole: 'Viewer',
          CFBundleTypeIconFile: 'document.icns',
          LSHandlerRank: 'Alternate',
        },
      ],
      CFBundleURLTypes: [
        {
          CFBundleURLName: 'Markdown Viewer URL',
          CFBundleURLSchemes: ['markdown-viewer'],
        },
      ],
      NSRequiresAquaSystemAppearance: false,
      LSMinimumSystemVersion: '10.15.0',
    },
  },
  rebuildConfig: {},
  hooks: {
    postPackage: async (_config, packageResult) => {
      // Re-sign the app with ad-hoc signature to fix "app is damaged" error
      // This is needed because Electron's default linker signature doesn't include
      // all nested frameworks, causing Gatekeeper to reject the app
      if (process.platform === 'darwin' && !process.env['APPLE_TEAM_ID']) {
        const outputDir = packageResult.outputPaths[0];
        const appPath = `${outputDir}/Markdown Viewer.app`;
        console.log(`Re-signing app with ad-hoc signature: ${appPath}`);
        execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
      }
    },
  },
  makers: [
    // macOS DMG installer
    new MakerDMG({
      format: 'ULFO',
    }),
    // macOS ZIP for direct distribution
    new MakerZIP({}, ['darwin']),
  ],
  plugins: [
    new VitePlugin({
      // Build configuration for main process and preload scripts
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Security hardening fuses - enabled in CI for release builds
    ...(process.env['CI']
      ? [
          new FusesPlugin({
            version: FuseVersion.V1,
            [FuseV1Options.RunAsNode]: false,
            [FuseV1Options.EnableCookieEncryption]: true,
            [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
            [FuseV1Options.EnableNodeCliInspectArguments]: false,
            [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
            [FuseV1Options.OnlyLoadAppFromAsar]: true,
          }),
        ]
      : []),
  ],
};

export default config;
