/**
 * Theme System
 *
 * Provides runtime CSS generation from theme definitions
 * and manages theme application to the document.
 */
import type {
  ThemeVariables,
  PluginThemeDeclaration,
  ResolvedTheme,
} from './types';
import { lightTheme } from './light';
import { darkTheme } from './dark';

// Re-export types
export type {
  ThemeVariables,
  ThemeColors,
  ThemeFonts,
  PluginThemeDeclaration,
  PluginThemeVariable,
  ThemeMode,
  ResolvedTheme,
} from './types';

// Export theme definitions
export { lightTheme } from './light';
export { darkTheme } from './dark';

/**
 * Theme registry mapping theme names to their definitions
 */
export const themes: Record<ResolvedTheme, ThemeVariables> = {
  light: lightTheme,
  dark: darkTheme,
};

/**
 * Convert camelCase to kebab-case for CSS variable names
 */
function toKebabCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Generate CSS variables from a theme definition
 */
export function generateThemeCSS(theme: ThemeVariables): string {
  const lines: string[] = [];

  // Generate color variables
  for (const [key, value] of Object.entries(theme.colors)) {
    lines.push(`  --${toKebabCase(key)}: ${value};`);
  }

  // Generate font variables
  for (const [key, value] of Object.entries(theme.fonts)) {
    lines.push(`  --font-${toKebabCase(key)}: ${value};`);
  }

  return lines.join('\n');
}

/**
 * Generate CSS for plugin theme variables
 */
export function generatePluginThemeCSS(
  declarations: PluginThemeDeclaration,
  theme: ResolvedTheme
): string {
  const lines: string[] = [];

  for (const [name, values] of Object.entries(declarations)) {
    const value = theme === 'dark' ? values.dark : values.light;
    lines.push(`  --${name}: ${value};`);
  }

  return lines.join('\n');
}

/**
 * Aggregate multiple plugin theme declarations into one
 */
export function aggregatePluginThemeDeclarations(
  declarations: PluginThemeDeclaration[]
): PluginThemeDeclaration {
  const aggregated: PluginThemeDeclaration = {};

  for (const declaration of declarations) {
    for (const [name, values] of Object.entries(declaration)) {
      if (aggregated[name]) {
        console.warn(
          `[ThemeSystem] Duplicate plugin theme variable: --${name}. Using latest declaration.`
        );
      }
      aggregated[name] = values;
    }
  }

  return aggregated;
}

/**
 * Generate complete CSS for a theme including plugin variables
 */
export function generateCompleteThemeCSS(
  theme: ResolvedTheme,
  pluginDeclarations: PluginThemeDeclaration = {}
): string {
  const themeVars = themes[theme];
  const baseCSS = generateThemeCSS(themeVars);
  const pluginCSS = generatePluginThemeCSS(pluginDeclarations, theme);

  const allVariables = pluginCSS ? `${baseCSS}\n${pluginCSS}` : baseCSS;

  return `:root {\n${allVariables}\n}`;
}

/**
 * Apply theme to the document by updating CSS variables
 */
export function applyTheme(
  theme: ResolvedTheme,
  pluginDeclarations: PluginThemeDeclaration = {}
): void {
  const styleId = 'theme-variables';
  let styleElement = document.getElementById(styleId) as HTMLStyleElement | null;

  if (!styleElement) {
    styleElement = document.createElement('style');
    styleElement.id = styleId;
    document.head.appendChild(styleElement);
  }

  const css = generateCompleteThemeCSS(theme, pluginDeclarations);
  styleElement.textContent = css;

  // Also set data-theme attribute for any CSS that uses it
  document.documentElement.setAttribute('data-theme', theme);
}

/**
 * Get the current theme from the document
 */
export function getCurrentTheme(): ResolvedTheme {
  const theme = document.documentElement.getAttribute('data-theme');
  return theme === 'dark' ? 'dark' : 'light';
}
