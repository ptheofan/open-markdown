/**
 * Fence info strings and line-level decoration of highlighted code.
 *
 * Generated markdown writes fences like ```ts title="src/app.ts" {3-5} or
 * ```bash filename=setup.sh. The language is the first word; the rest names
 * a title and lines to call out. Highlighted output is a flat string of
 * nested spans, so to colour a whole line the string is split at newlines
 * with every open span closed and reopened across the break.
 */

export interface CodeBlockInfo {
  /** The language as the author wrote it, stripped of `{…}`; '' when none */
  lang: string;
  /** From title=, filename= or file=, quoted or bare; null when absent */
  title: string | null;
  /** 1-based lines to call out, from `{1,3-5}`, highlight= or hl_lines= */
  highlightLines: Set<number>;
}

const TITLE_RE = /(?:^|\s)(?:title|filename|file)=(?:"([^"]*)"|'([^']*)'|(\S+))/i;
const BRACES_RE = /\{([\d\s,-]*)\}/;
const HL_ATTR_RE = /(?:^|\s)(?:highlight|hl_lines)=(?:"([^"]*)"|'([^']*)'|(\S+))/i;

/** Parse `1, 3-5, 8` into the set {1, 3, 4, 5, 8}. */
export function parseLineRanges(spec: string): Set<number> {
  const lines = new Set<number>();
  for (const part of spec.split(/[,\s]+/)) {
    if (!part) continue;
    const range = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!range) continue;
    const start = Number(range[1]);
    const end = range[2] ? Number(range[2]) : start;
    if (end < start || end - start > 10_000) continue;
    for (let line = start; line <= end; line++) lines.add(line);
  }
  return lines;
}

/**
 * Split the info string markdown-it hands to a highlighter into language,
 * title and highlighted lines. `lang` is markdown-it's first word, `attrs`
 * the rest, but the first word may itself carry braces (`ts{3}`) or be an
 * attribute when no language was written (`title="x"`).
 */
export function parseCodeBlockInfo(lang: string, attrs: string): CodeBlockInfo {
  const full = `${lang} ${attrs}`.trim();
  let firstWord = lang.trim();
  let rest = attrs;

  // No language, just attributes: treat the whole string as attributes
  if (/^[\w-]+=/.test(firstWord) || firstWord.startsWith('{')) {
    rest = full;
    firstWord = '';
  }

  const language = firstWord.replace(/\{.*$/, '');

  const titleMatch = TITLE_RE.exec(` ${rest}`);
  const title = titleMatch ? (titleMatch[1] ?? titleMatch[2] ?? titleMatch[3] ?? null) : null;

  let highlightLines = new Set<number>();
  const braces = BRACES_RE.exec(full);
  if (braces?.[1] !== undefined) {
    highlightLines = parseLineRanges(braces[1]);
  } else {
    const attr = HL_ATTR_RE.exec(` ${rest}`);
    const spec = attr ? (attr[1] ?? attr[2] ?? attr[3]) : undefined;
    if (spec) highlightLines = parseLineRanges(spec);
  }

  return { lang: language, title: title || null, highlightLines };
}

const TAG_RE = /<\/?span\b[^>]*>/g;

/**
 * Split highlighted HTML into lines. Spans open across a newline are closed
 * before it and reopened after it, so each line is well-formed on its own.
 * The newlines themselves are dropped.
 */
export function splitHighlightedLines(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let current = '';
  let last = 0;

  const emitText = (text: string): void => {
    const parts = text.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        lines.push(current + '</span>'.repeat(open.length));
        current = open.join('');
      }
      current += parts[i];
    }
  };

  for (const match of html.matchAll(TAG_RE)) {
    emitText(html.slice(last, match.index));
    const tag = match[0];
    if (tag.startsWith('</')) {
      open.pop();
    } else {
      open.push(tag);
    }
    current += tag;
    last = match.index + tag.length;
  }
  emitText(html.slice(last));
  lines.push(current);

  return lines;
}

export interface WrapCodeLinesOptions {
  /** 1-based lines to mark highlighted */
  highlightLines?: Set<number>;
  /** Mark lines that are diff additions or deletions */
  diff?: boolean;
}

const ADDITION_RE = /^<span class="hljs-addition">/;
const DELETION_RE = /^<span class="hljs-deletion">/;

/**
 * Wrap each line of highlighted HTML in `<span class="code-line">`, with
 * extra classes for called-out lines and, in diffs, for added and removed
 * lines. Lines keep their newlines between the wrappers, so the text content
 * is exactly what it was.
 */
export function wrapCodeLines(html: string, options: WrapCodeLinesOptions = {}): string {
  const lines = splitHighlightedLines(html);
  const trailingNewline = html.endsWith('\n');
  if (trailingNewline) lines.pop();

  const highlight = options.highlightLines ?? new Set<number>();

  const wrapped = lines.map((line, i) => {
    const classes = ['code-line'];
    if (highlight.has(i + 1)) classes.push('code-line-highlighted');
    if (options.diff) {
      if (ADDITION_RE.test(line)) classes.push('code-line-addition');
      else if (DELETION_RE.test(line)) classes.push('code-line-deletion');
    }
    return `<span class="${classes.join(' ')}">${line}</span>`;
  });

  return wrapped.join('\n') + (trailingNewline ? '\n' : '');
}
