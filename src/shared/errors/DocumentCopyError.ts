/**
 * Domain errors for document copy operations
 */
import { DomainError } from './DomainError';

/**
 * Error codes for document copy operations
 */
export const DocumentCopyErrorCode = {
  NO_DOCUMENT: 'DOCUMENT_COPY_NO_DOCUMENT',
  MERMAID_RENDER_FAILED: 'DOCUMENT_COPY_MERMAID_RENDER_FAILED',
  IMAGE_CAPTURE_FAILED: 'DOCUMENT_COPY_IMAGE_CAPTURE_FAILED',
  CLIPBOARD_WRITE_FAILED: 'DOCUMENT_COPY_CLIPBOARD_WRITE_FAILED',
} as const;

/**
 * Thrown when attempting to copy with no document loaded
 */
export class NoDocumentError extends DomainError {
  readonly code = DocumentCopyErrorCode.NO_DOCUMENT;
  readonly isOperational = true;

  constructor() {
    super('No document is currently loaded');
  }
}

/**
 * Thrown when a mermaid diagram fails to render during copy
 */
export class MermaidRenderError extends DomainError {
  readonly code = DocumentCopyErrorCode.MERMAID_RENDER_FAILED;
  readonly isOperational = true;

  constructor(diagramIndex: number, errorMessage: string) {
    super(`Failed to render mermaid diagram ${diagramIndex}: ${errorMessage}`, {
      diagramIndex,
      errorMessage,
    });
  }
}

/**
 * Thrown when image capture fails during copy as image
 */
export class ImageCaptureError extends DomainError {
  readonly code = DocumentCopyErrorCode.IMAGE_CAPTURE_FAILED;
  readonly isOperational = true;

  constructor(message: string, cause?: unknown) {
    super(`Failed to capture document as image: ${message}`, { cause });
  }
}

/**
 * Thrown when clipboard write operation fails
 */
export class ClipboardWriteError extends DomainError {
  readonly code = DocumentCopyErrorCode.CLIPBOARD_WRITE_FAILED;
  readonly isOperational = true;

  constructor(clipboardType: 'html' | 'image', cause?: unknown) {
    super(`Failed to write ${clipboardType} to clipboard`, {
      clipboardType,
      cause,
    });
  }
}
