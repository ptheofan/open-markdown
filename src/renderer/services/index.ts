/**
 * Renderer Services - Public API
 */

export {
  DocumentCopyService,
  createDocumentCopyService,
  type CopyDocumentType,
  type DocumentCopyOptions,
  type DocumentCopyResult,
} from './DocumentCopyService';

export { DiffService } from './DiffService';

export { FindService, type FindResult } from './FindService';

export {
  MarkdownSlicer,
  type MarkdownSlice,
  type SliceType,
} from './MarkdownSlicer';
