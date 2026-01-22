import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Markdown Viewer',
    executableName: 'markdown-viewer',
    appBundleId: 'com.aralu.markdown-viewer',
    appCategoryType: 'public.app-category.developer-tools',
    asar: true,
    icon: './resources/icons/icon',
    // macOS specific options - signing is configured via environment variables
    // Set APPLE_ID, APPLE_PASSWORD, and APPLE_TEAM_ID for notarization
    osxSign: process.env['APPLE_ID']
      ? {
          optionsForFile: () => ({
            entitlements: './resources/entitlements.mac.plist',
            hardenedRuntime: true,
          }),
        }
      : undefined,
    osxNotarize:
      process.env['APPLE_ID'] &&
      process.env['APPLE_PASSWORD'] &&
      process.env['APPLE_TEAM_ID']
        ? {
            appleId: process.env['APPLE_ID'],
            appleIdPassword: process.env['APPLE_PASSWORD'],
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
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
