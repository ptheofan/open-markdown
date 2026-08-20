/**
 * CodeHighlighter — turns a fenced code block into coloured spans that the
 * Google Docs API can apply.
 *
 * Google Docs code blocks are a *building block*, an editor-only feature: the
 * Docs API has no request that inserts one and no field for a language. To get
 * something comparable through the API we highlight the code ourselves and emit
 * the colours as ordinary text styling.
 *
 * highlight.js renders to HTML, so its output is parsed back into flat runs.
 * Nested spans are handled by letting the innermost class win, which is the
 * same rule the CSS cascade would apply.
 */
import hljs from 'highlight.js';

/** A colour in the 0..1 form the Docs API expects. */
export interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

/** A stretch of code sharing one colour. `color` absent means "document default". */
export interface CodeSpan {
  text: string;
  color?: RgbColor;
}

const hex = (value: string): RgbColor => ({
  red: parseInt(value.slice(1, 3), 16) / 255,
  green: parseInt(value.slice(3, 5), 16) / 255,
  blue: parseInt(value.slice(5, 7), 16) / 255,
});

/**
 * Token colours, chosen to read against a light background since that is what
 * the shaded code block uses.
 */
const TOKEN_COLORS: Record<string, RgbColor> = {
  keyword: hex('#d73a49'),
  'selector-tag': hex('#d73a49'),
  type: hex('#d73a49'),
  string: hex('#032f62'),
  'meta-string': hex('#032f62'),
  regexp: hex('#032f62'),
  comment: hex('#6a737d'),
  quote: hex('#6a737d'),
  meta: hex('#6a737d'),
  number: hex('#005cc5'),
  literal: hex('#005cc5'),
  attr: hex('#005cc5'),
  'selector-attr': hex('#005cc5'),
  property: hex('#005cc5'),
  title: hex('#6f42c1'),
  'title.function': hex('#6f42c1'),
  'title.class': hex('#6f42c1'),
  section: hex('#6f42c1'),
  'built_in': hex('#e36209'),
  variable: hex('#e36209'),
  'template-variable': hex('#e36209'),
  params: hex('#24292e'),
  tag: hex('#22863a'),
  name: hex('#22863a'),
  symbol: hex('#e36209'),
  bullet: hex('#e36209'),
  addition: hex('#22863a'),
  deletion: hex('#d73a49'),
};

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|nbsp|#x27|#39);/g, (m) => ENTITIES[m] ?? m);
}

/**
 * Resolve the colour for a highlight.js class list, e.g. `hljs-title function_`.
 * highlight.js 11 emits sub-scopes both as `title.function` and as the pair
 * `title function_`, so both spellings are checked.
 */
function colorForClasses(classes: string): RgbColor | undefined {
  const names = classes
    .split(/\s+/)
    .filter((c) => c.startsWith('hljs-'))
    .map((c) => c.slice('hljs-'.length));

  for (const name of names) {
    const direct = TOKEN_COLORS[name];
    if (direct) return direct;
    // `function_` / `class_` trailing-underscore convention
    const trimmed = name.replace(/_$/, '');
    const viaTrim = TOKEN_COLORS[trimmed];
    if (viaTrim) return viaTrim;
  }
  return undefined;
}

/** Is this language one highlight.js actually knows? */
export function isSupportedLanguage(language: string | undefined): boolean {
  return Boolean(language && hljs.getLanguage(language));
}

/**
 * Languages considered when a fence does not name one.
 *
 * Unconstrained detection ranges over every grammar highlight.js ships and
 * reaches for obscure ones on weak evidence — a plain Python snippet is
 * identified as RouterOS config, scoring higher than Python itself. Limiting
 * the field to languages a markdown document plausibly contains makes the
 * winner meaningful.
 */
const AUTO_DETECT_LANGUAGES = [
  'python', 'javascript', 'typescript', 'json', 'bash', 'shell',
  'go', 'rust', 'java', 'c', 'cpp', 'csharp', 'ruby', 'php',
  'sql', 'yaml', 'xml', 'html', 'css', 'scss', 'markdown',
  'dockerfile', 'ini', 'diff', 'kotlin', 'swift',
];

/**
 * Minimum highlight.js relevance before a guess is trusted.
 *
 * Relevance counts matched constructs, so short or non-code text scores low —
 * English prose still "matches" CSS at around 4. Anything below this is left
 * uncoloured, because plain code reads fine whereas miscoloured code misleads.
 */
const AUTO_DETECT_MIN_RELEVANCE = 5;

/**
 * Highlight `code`, returning flat spans in document order.
 *
 * The concatenated span texts always equal `code` exactly — callers rely on
 * that to compute API ranges, so nothing may be added or dropped here.
 *
 * A fence with no language is detected against a constrained candidate list
 * and only trusted above a relevance floor; everything else falls back to
 * plain, uncoloured output.
 */
export function highlightCode(code: string, language?: string): CodeSpan[] {
  if (!code) return [];

  try {
    if (isSupportedLanguage(language)) {
      return parseHighlighted(hljs.highlight(code, { language: language!, ignoreIllegals: true }).value, code);
    }

    // A fence that names an unknown language has still told us what it is;
    // substituting a guess would be worse than leaving it plain.
    if (language) return [{ text: code }];

    const auto = hljs.highlightAuto(code, AUTO_DETECT_LANGUAGES);
    if (!auto.language || auto.relevance < AUTO_DETECT_MIN_RELEVANCE) {
      return [{ text: code }];
    }
    return parseHighlighted(auto.value, code);
  } catch {
    return [{ text: code }];
  }
}

/**
 * Turn highlight.js HTML back into flat spans.
 *
 * Returns a single plain span if the result would not reproduce `code`
 * exactly — callers derive API ranges from these lengths, so a lossy parse
 * would corrupt the document rather than merely look wrong.
 */
function parseHighlighted(html: string, code: string): CodeSpan[] {
  const spans: CodeSpan[] = [];
  const stack: (RgbColor | undefined)[] = [];
  const pattern = /<span class="([^"]*)">|<\/span>|[^<]+/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const [token, classes] = match;

    if (classes !== undefined) {
      stack.push(colorForClasses(classes));
    } else if (token === '</span>') {
      stack.pop();
    } else {
      const text = decodeEntities(token);
      if (!text) continue;
      // Innermost enclosing colour wins.
      const color = [...stack].reverse().find((c) => c !== undefined);
      const previous = spans[spans.length - 1];
      if (previous && sameColor(previous.color, color)) {
        previous.text += text;
      } else {
        spans.push(color ? { text, color } : { text });
      }
    }
  }

  if (spans.map((s) => s.text).join('') !== code) return [{ text: code }];
  return spans;
}

function sameColor(a: RgbColor | undefined, b: RgbColor | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.red === b.red && a.green === b.green && a.blue === b.blue;
}
