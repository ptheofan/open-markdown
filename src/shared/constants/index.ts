/**
 * Supported file extensions for markdown files
 */
export const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkdn', '.mkd'] as const;

/**
 * Default debounce time for file watching (ms)
 */
export const FILE_WATCH_DEBOUNCE_MS = 300;

/**
 * Maximum file size to render (bytes) - 5MB
 */
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Default window dimensions
 */
export const DEFAULT_WINDOW = {
  WIDTH: 900,
  HEIGHT: 700,
  MIN_WIDTH: 400,
  MIN_HEIGHT: 300,
} as const;

/**
 * Application metadata
 */
export const APP_CONFIG = {
  NAME: 'Open Markdown',
  BUNDLE_ID: 'com.aralu.markdown-viewer',
} as const;

/**
 * Built-in plugin IDs
 */
export const BUILTIN_PLUGINS = {
  SYNTAX_HIGHLIGHT: 'syntax-highlight',
  MERMAID: 'mermaid',
  GITHUB_FLAVORED: 'github-flavored',
} as const;

/**
 * Theme IDs
 */
export const THEMES = {
  GITHUB_LIGHT: 'github-light',
  GITHUB_DARK: 'github-dark',
} as const;
