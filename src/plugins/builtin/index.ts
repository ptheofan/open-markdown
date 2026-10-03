/**
 * Built-in plugins exports
 */
export {
  GithubFlavoredPlugin,
  createGithubFlavoredPlugin,
} from './GithubFlavoredPlugin';

export {
  SyntaxHighlightPlugin,
  createSyntaxHighlightPlugin,
} from './SyntaxHighlightPlugin';
export type { SyntaxHighlightOptions } from './SyntaxHighlightPlugin';

export { MermaidPlugin, createMermaidPlugin } from './MermaidPlugin';
export type { MermaidOptions } from './MermaidPlugin';

export { MathPlugin, createMathPlugin } from './MathPlugin';

export {
  FrontMatterPlugin,
  createFrontMatterPlugin,
  frontMatterBlockRule,
  FRONT_MATTER_TOKEN,
  DEFAULT_FRONT_MATTER_PREFERENCES,
} from './FrontMatterPlugin';
export type { FrontMatterPreferences } from './FrontMatterPlugin';

export { FileReferencePlugin, createFileReferencePlugin, FILE_REF_CLASS } from './FileReferencePlugin';
