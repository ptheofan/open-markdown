/**
 * Dark Theme
 *
 * Dark color scheme for the application.
 * Based on GitHub's dark theme colors.
 */
import type { ThemeVariables } from './types';

export const darkTheme: ThemeVariables = {
  colors: {
    // Base colors
    bg: '#0d1117',
    text: '#c9d1d9',
    textMuted: '#8b949e',
    border: '#30363d',
    link: '#58a6ff',

    // Component backgrounds
    toolbarBg: '#161b22',
    toolbarBorder: '#30363d',
    statusBg: '#161b22',
    codeBg: '#161b22',

    // Interactive states
    hoverBg: '#21262d',
    activeBg: '#30363d',

    // Table
    tableBorder: '#30363d',
    tableHeaderBg: '#161b22',
    tableRowAltBg: '#161b22',

    // Blockquote
    blockquoteBorder: '#3b434b',

    // Drop zone
    dropZoneBg: '#161b22',
    dropZoneBorder: '#30363d',
    dropZoneActiveBg: '#0d419d',
    dropZoneActiveBorder: '#58a6ff',

    // Status colors
    errorBg: '#490202',
    errorBorder: '#f85149',
    errorText: '#f85149',
    successColor: '#3fb950',
    warningColor: '#d29922',
  },

  fonts: {
    body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif",
    mono: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
  },
};
