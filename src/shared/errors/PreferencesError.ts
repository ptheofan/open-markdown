/**
 * Preferences Error Classes
 *
 * Domain-specific errors for preferences operations including
 * load/save failures, validation errors, and migration issues.
 */

import { DomainError } from './DomainError';

/**
 * Error codes for preferences operations
 */
export const PreferencesErrorCode = {
  LOAD_FAILED: 'PREFERENCES_LOAD_FAILED',
  SAVE_FAILED: 'PREFERENCES_SAVE_FAILED',
  VALIDATION_FAILED: 'PREFERENCES_VALIDATION_FAILED',
  MIGRATION_FAILED: 'PREFERENCES_MIGRATION_FAILED',
  COLOR_FORMAT_INVALID: 'PREFERENCES_COLOR_FORMAT_INVALID',
  PLUGIN_PREFERENCES_FAILED: 'PREFERENCES_PLUGIN_FAILED',
} as const;

/**
 * Failed to load preferences from disk
 */
export class PreferencesLoadError extends DomainError {
  readonly code = PreferencesErrorCode.LOAD_FAILED;
  readonly isOperational = true;

  constructor(filePath: string, cause?: Error) {
    super(`Failed to load preferences from ${filePath}`, {
      filePath,
      cause: cause?.message,
    });
  }
}

/**
 * Failed to save preferences to disk
 */
export class PreferencesSaveError extends DomainError {
  readonly code = PreferencesErrorCode.SAVE_FAILED;
  readonly isOperational = true;

  constructor(filePath: string, cause?: Error) {
    super(`Failed to save preferences to ${filePath}`, {
      filePath,
      cause: cause?.message,
    });
  }
}

/**
 * Preference value failed validation
 */
export class PreferencesValidationError extends DomainError {
  readonly code = PreferencesErrorCode.VALIDATION_FAILED;
  readonly isOperational = true;

  constructor(field: string, value: unknown, expected: string) {
    super(`Invalid preference value for ${field}: expected ${expected}`, {
      field,
      value,
      expected,
    });
  }
}

/**
 * Failed to migrate preferences schema
 */
export class PreferencesMigrationError extends DomainError {
  readonly code = PreferencesErrorCode.MIGRATION_FAILED;
  readonly isOperational = true;

  constructor(fromVersion: number, toVersion: number, cause?: Error) {
    super(
      `Failed to migrate preferences from version ${fromVersion} to ${toVersion}`,
      {
        fromVersion,
        toVersion,
        cause: cause?.message,
      }
    );
  }
}

/**
 * Invalid OKLCH color format
 */
export class ColorFormatError extends DomainError {
  readonly code = PreferencesErrorCode.COLOR_FORMAT_INVALID;
  readonly isOperational = true;

  constructor(input: string, expectedFormat: string = 'oklch(L% C H / A)') {
    super(`Invalid color format: ${input}`, {
      input,
      expectedFormat,
    });
  }
}

/**
 * Plugin preferences operation failed
 */
export class PluginPreferencesError extends DomainError {
  readonly code = PreferencesErrorCode.PLUGIN_PREFERENCES_FAILED;
  readonly isOperational = true;

  constructor(
    pluginId: string,
    operation: 'get' | 'set' | 'validate',
    cause?: Error
  ) {
    super(`Failed to ${operation} preferences for plugin ${pluginId}`, {
      pluginId,
      operation,
      cause: cause?.message,
    });
  }
}
