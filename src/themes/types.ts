/**
 * Theme System Types
 *
 * Defines the structure for theme variables used throughout the application.
 * All colors, fonts, and styling tokens are defined here.
 */

/**
 * Core color palette for the application
 */
export interface ThemeColors {
  // Base colors
  bg: string;
  text: string;
  textMuted: string;
  border: string;
  link: string;

  // Component backgrounds
  toolbarBg: string;
  toolbarBorder: string;
  statusBg: string;
  codeBg: string;

  // Interactive states
  hoverBg: string;
  activeBg: string;

  // Table
  tableBorder: string;
  tableHeaderBg: string;
  tableRowAltBg: string;

  // Blockquote
  blockquoteBorder: string;

  // Drop zone
  dropZoneBg: string;
  dropZoneBorder: string;
  dropZoneActiveBg: string;
  dropZoneActiveBorder: string;

  // Status colors
  errorBg: string;
  errorBorder: string;
  errorText: string;
  successColor: string;
  warningColor: string;
}

/**
 * Font definitions for the theme
 */
export interface ThemeFonts {
  body: string;
  mono: string;
}

/**
 * Complete theme definition
 */
export interface ThemeVariables {
  colors: ThemeColors;
  fonts: ThemeFonts;
}

/**
 * Plugin theme variable declaration
 * Plugins use this to declare their custom CSS variables
 */
export interface PluginThemeVariable {
  /** Value for light theme */
  light: string;
  /** Value for dark theme */
  dark: string;
  /** Optional description for documentation */
  description?: string;
}

/**
 * Map of variable names to their theme values
 */
export type PluginThemeDeclaration = Record<string, PluginThemeVariable>;

/**
 * Theme mode as stored in preferences
 */
export type ThemeMode = 'light' | 'dark' | 'system';

/**
 * Resolved theme after system preference is applied
 */
export type ResolvedTheme = 'light' | 'dark';
