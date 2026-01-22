/**
 * Preferences System Types
 *
 * Type definitions for the application preferences system including
 * core preferences, plugin preferences, and OKLCH color support.
 */

import type { ThemeMode } from './theme';

/**
 * OKLCH color representation with alpha support
 * Format: "oklch(L% C H / A)" where L=0-100, C=0-0.4, H=0-360, A=0-1
 * Examples:
 *   - "oklch(100% 0 0)"         - Opaque white
 *   - "oklch(100% 0 0 / 0.5)"   - 50% transparent white
 *   - "oklch(52% 0.18 250 / 1)" - Opaque blue
 */
export type OklchColor = string;

/**
 * Light and dark color pair for theme-aware colors
 */
export interface ColorPair {
  light: OklchColor;
  dark: OklchColor;
}

/**
 * Typography element styling
 */
export interface TypographyStyle {
  fontSize: string;
  fontWeight: number;
  lineHeight: number;
  color: ColorPair;
  marginTop: string;
  marginBottom: string;
  paddingBottom?: string;
  borderBottom?: {
    width: string;
    style: string;
  };
}

/**
 * List styling
 */
export interface ListStyle {
  paddingLeft: string;
  itemSpacing: string;
  markerColor?: ColorPair;
}

/**
 * Core application preferences
 */
export interface CorePreferences {
  theme: {
    mode: ThemeMode;
    background: ColorPair;
  };
  typography: {
    baseFontSize: string;
    h1: TypographyStyle;
    h2: TypographyStyle;
    h3: TypographyStyle;
    h4: TypographyStyle;
    h5: TypographyStyle;
    h6: TypographyStyle;
    paragraph: {
      marginBottom: string;
    };
    link: {
      color: ColorPair;
    };
    blockquote: {
      borderWidth: string;
      borderColor: ColorPair;
      textColor: ColorPair;
    };
    code: {
      fontSize: string;
      background: ColorPair;
      borderRadius: string;
    };
  };
  lists: {
    ul: ListStyle;
    ol: ListStyle;
  };
}

/**
 * Plugin preferences - keyed by plugin ID
 */
export type PluginPreferencesMap = Record<string, unknown>;

/**
 * Complete preferences structure
 */
export interface AppPreferences {
  version: number;
  core: CorePreferences;
  plugins: PluginPreferencesMap;
}

/**
 * Preference change event
 */
export interface PreferencesChangeEvent {
  preferences: AppPreferences;
  changedPaths: string[];
}

/**
 * Deep partial type utility - makes all nested properties optional
 */
export type DeepPartial<T> = T extends object
  ? { [P in keyof T]?: DeepPartial<T[P]> }
  : T;

/**
 * Preference field types for plugin preferences UI
 */
export type PreferenceFieldType =
  | 'boolean'
  | 'string'
  | 'number'
  | 'color'
  | 'select'
  | 'color-pair';

/**
 * Base preference field definition
 */
export interface PreferenceFieldBase {
  key: string;
  label: string;
  description?: string;
}

/**
 * Boolean preference (checkbox/toggle)
 */
export interface BooleanPreferenceField extends PreferenceFieldBase {
  type: 'boolean';
  defaultValue: boolean;
}

/**
 * String preference (text input)
 */
export interface StringPreferenceField extends PreferenceFieldBase {
  type: 'string';
  defaultValue: string;
  placeholder?: string;
}

/**
 * Select preference (dropdown)
 */
export interface SelectPreferenceField extends PreferenceFieldBase {
  type: 'select';
  options: Array<{ value: string; label: string }>;
  defaultValue: string;
}

/**
 * Color preference (single OKLCH color)
 */
export interface ColorPreferenceField extends PreferenceFieldBase {
  type: 'color';
  defaultValue: OklchColor;
}

/**
 * Color pair preference (light/dark)
 */
export interface ColorPairPreferenceField extends PreferenceFieldBase {
  type: 'color-pair';
  defaultValue: ColorPair;
}

/**
 * Number preference
 */
export interface NumberPreferenceField extends PreferenceFieldBase {
  type: 'number';
  defaultValue: number;
  min?: number;
  max?: number;
  step?: number;
}

/**
 * Union of all preference field types
 */
export type PreferenceField =
  | BooleanPreferenceField
  | StringPreferenceField
  | SelectPreferenceField
  | ColorPreferenceField
  | ColorPairPreferenceField
  | NumberPreferenceField;

/**
 * Plugin preferences schema section
 */
export interface PreferencesSection {
  id: string;
  title: string;
  fields: PreferenceField[];
}

/**
 * Plugin preferences schema
 */
export interface PluginPreferencesSchema {
  version: number;
  sections: PreferencesSection[];
}
