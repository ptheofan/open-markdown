/**
 * Error codes for file association operations
 */
export type FileAssociationErrorCode =
  | 'NOT_SUPPORTED'
  | 'NOT_PACKAGED'
  | 'PERMISSION_DENIED'
  | 'DUTI_NOT_FOUND'
  | 'UNKNOWN';

/**
 * Result of attempting to set file association
 */
export interface FileAssociationResult {
  success: boolean;
  error?: FileAssociationErrorCode;
}

/**
 * Current file association status
 */
export interface FileAssociationStatus {
  isDefault: boolean;
  canSetDefault: boolean;
}

/**
 * Event sent to renderer when a file or a folder is opened externally
 * (Finder, the command line, a drop on the dock)
 */
export interface ExternalFileOpenEvent {
  filePath?: string;
  folderPath?: string;
}
