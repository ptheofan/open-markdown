/**
 * Light Theme
 *
 * Default light color scheme for the application.
 * Based on GitHub's light theme colors.
 */
import type { ThemeVariables } from './types';

export const lightTheme: ThemeVariables = {
  colors: {
    // Base colors
    bg: '#ffffff',
    text: '#24292f',
    textMuted: '#57606a',
    border: '#d0d7de',
    link: '#0969da',

    // Component backgrounds
    toolbarBg: '#f6f8fa',
    toolbarBorder: '#d0d7de',
    statusBg: '#f6f8fa',
    codeBg: '#f6f8fa',

    // Interactive states
    hoverBg: '#f3f4f6',
    activeBg: '#ebecf0',

    // Table
    tableBorder: '#d0d7de',
    tableHeaderBg: '#f6f8fa',
    tableRowAltBg: '#f6f8fa',

    // Blockquote
    blockquoteBorder: '#d0d7de',

    // Drop zone
    dropZoneBg: '#f6f8fa',
    dropZoneBorder: '#d0d7de',
    dropZoneActiveBg: '#ddf4ff',
    dropZoneActiveBorder: '#0969da',

    // Status colors
    errorBg: '#ffebe9',
    errorBorder: '#ff8182',
    errorText: '#cf222e',
    successColor: '#1a7f37',
    warningColor: '#9a6700',
  },

  fonts: {
    body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif",
    mono: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
  },
};
