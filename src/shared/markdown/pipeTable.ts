/**
 * Pipe tables as data: parse a GFM table into rows of cell markdown, change
 * its shape, and write it back out aligned.
 *
 * The edit-mode table editor works on this model rather than on text, so
 * every operation (a typed cell, an inserted column, a new alignment) is a
 * small change to arrays and the file always comes out as a well-formed,
 * readable table. Cells hold inline markdown with pipes unescaped; the
 * serializer escapes them again.
 */

export type ColumnAlign = 'left' | 'center' | 'right' | null;

export interface TableModel {
  /** Leading whitespace shared by every line, for tables nested in lists */
  indent: string;
  header: string[];
  align: ColumnAlign[];
  rows: string[][];
}

export interface SerializeOptions {
  /** Pad every column to the same width so the raw file reads as a grid */
  pad?: boolean;
}

/** Why a table could not be turned into a model */
export type TableParseFailure = 'too-short' | 'no-delimiter-row' | 'ragged';

export interface TableParseResult {
  model: TableModel | null;
  failure?: TableParseFailure;
}

const DELIMITER_CELL_RE = /^:?-+:?$/;

/**
 * Split one table line into its cells. Leading and trailing pipes are
 * optional; a `\|` stays with its cell and is unescaped. Pipes inside code
 * spans split cells, as in GFM.
 */
export function splitTableRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);

  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '\\' && text[i + 1] === '|') {
      current += '|';
      i++;
    } else if (ch === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseAlign(cell: string): ColumnAlign {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (left) return 'left';
  if (right) return 'right';
  return null;
}

function isDelimiterRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => DELIMITER_CELL_RE.test(cell));
}

/**
 * Parse a pipe table. Returns no model for anything the editor could not
 * write back faithfully: fewer than two lines, a second line that is not a
 * delimiter row, or rows with a different number of cells than the header.
 */
export function parsePipeTableDetailed(raw: string): TableParseResult {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n').filter((line) => line.trim() !== '');
  if (lines.length < 2) return { model: null, failure: 'too-short' };

  const indentMatch = /^[ \t]*/.exec(lines[0]!);
  const indent = indentMatch ? indentMatch[0] : '';

  const header = splitTableRow(lines[0]!);
  const delimiter = splitTableRow(lines[1]!);
  if (!isDelimiterRow(delimiter) || delimiter.length !== header.length) {
    return { model: null, failure: 'no-delimiter-row' };
  }

  const rows: string[][] = [];
  for (const line of lines.slice(2)) {
    const cells = splitTableRow(line);
    if (cells.length !== header.length) return { model: null, failure: 'ragged' };
    rows.push(cells);
  }

  return {
    model: {
      indent,
      header,
      align: delimiter.map(parseAlign),
      rows,
    },
  };
}

export function parsePipeTable(raw: string): TableModel | null {
  return parsePipeTableDetailed(raw).model;
}

/** Escape pipes so a cell stays one cell */
export function escapeCell(cell: string): string {
  return cell.replace(/\\\|/g, '|').replace(/\|/g, '\\|');
}

/** A cell's width as it will be written, for padding */
function cellWidth(cell: string): number {
  return [...escapeCell(cell)].length;
}

function padCell(cell: string, width: number, align: ColumnAlign): string {
  const text = escapeCell(cell);
  const gap = Math.max(0, width - [...text].length);
  if (align === 'right') return ' '.repeat(gap) + text;
  if (align === 'center') {
    const left = Math.floor(gap / 2);
    return ' '.repeat(left) + text + ' '.repeat(gap - left);
  }
  return text + ' '.repeat(gap);
}

function delimiterCell(align: ColumnAlign, width: number): string {
  const dashes = Math.max(1, width - (align === 'center' ? 2 : align ? 1 : 0));
  switch (align) {
    case 'left':
      return `:${'-'.repeat(dashes)}`;
    case 'right':
      return `${'-'.repeat(dashes)}:`;
    case 'center':
      return `:${'-'.repeat(dashes)}:`;
    default:
      return '-'.repeat(dashes);
  }
}

/**
 * Write the model as a GFM pipe table with leading and trailing pipes. With
 * padding (the default) every column is as wide as its widest cell, three at
 * least, so the raw file stays readable; without it the minimal form is used.
 */
export function serializePipeTable(model: TableModel, options: SerializeOptions = {}): string {
  const pad = options.pad ?? true;
  const columns = model.header.length;
  const widths: number[] = [];
  for (let c = 0; c < columns; c++) {
    let width = 3;
    if (pad) {
      width = Math.max(width, cellWidth(model.header[c] ?? ''));
      for (const row of model.rows) width = Math.max(width, cellWidth(row[c] ?? ''));
    }
    widths.push(width);
  }

  const line = (cells: string[]): string =>
    `${model.indent}| ${cells.map((cell, c) => (pad ? padCell(cell, widths[c]!, model.align[c] ?? null) : escapeCell(cell))).join(' | ')} |`;

  const delimiter = `${model.indent}| ${model.align
    .map((align, c) => delimiterCell(align, pad ? widths[c]! : 3))
    .join(' | ')} |`;

  return [line(model.header), delimiter, ...model.rows.map((row) => line(row))].join('\n');
}

// ---------------------------------------------------------------------------
// Shape changes. Every function returns a new model; the input is untouched.

function clone(model: TableModel): TableModel {
  return {
    indent: model.indent,
    header: [...model.header],
    align: [...model.align],
    rows: model.rows.map((row) => [...row]),
  };
}

function emptyRow(model: TableModel): string[] {
  return model.header.map(() => '');
}

/** A table with `columns` columns and `rows` body rows, all empty */
export function emptyTable(columns: number, rows: number): TableModel {
  const cols = Math.max(1, columns);
  return {
    indent: '',
    header: Array.from({ length: cols }, (_, i) => `Column ${i + 1}`),
    align: Array.from({ length: cols }, () => null),
    rows: Array.from({ length: Math.max(0, rows) }, () => Array.from({ length: cols }, () => '')),
  };
}

/** Insert a body row at `index` (0 = first body row; the header is not a body row) */
export function insertRow(model: TableModel, index: number, cells?: string[]): TableModel {
  const next = clone(model);
  const at = Math.max(0, Math.min(index, next.rows.length));
  const row = emptyRow(next).map((_, c) => cells?.[c] ?? '');
  next.rows.splice(at, 0, row);
  return next;
}

export function deleteRow(model: TableModel, index: number): TableModel {
  const next = clone(model);
  if (index >= 0 && index < next.rows.length) next.rows.splice(index, 1);
  return next;
}

export function duplicateRow(model: TableModel, index: number): TableModel {
  const row = model.rows[index];
  if (!row) return clone(model);
  return insertRow(model, index + 1, row);
}

export function moveRow(model: TableModel, from: number, to: number): TableModel {
  const next = clone(model);
  if (from < 0 || from >= next.rows.length || to < 0 || to >= next.rows.length) return next;
  const [row] = next.rows.splice(from, 1);
  next.rows.splice(to, 0, row!);
  return next;
}

export function insertColumn(model: TableModel, index: number, header = ''): TableModel {
  const next = clone(model);
  const at = Math.max(0, Math.min(index, next.header.length));
  next.header.splice(at, 0, header);
  next.align.splice(at, 0, null);
  for (const row of next.rows) row.splice(at, 0, '');
  return next;
}

export function deleteColumn(model: TableModel, index: number): TableModel {
  const next = clone(model);
  if (index < 0 || index >= next.header.length) return next;
  next.header.splice(index, 1);
  next.align.splice(index, 1);
  for (const row of next.rows) row.splice(index, 1);
  return next;
}

export function duplicateColumn(model: TableModel, index: number): TableModel {
  if (index < 0 || index >= model.header.length) return clone(model);
  const next = clone(model);
  next.header.splice(index + 1, 0, model.header[index]!);
  next.align.splice(index + 1, 0, model.align[index] ?? null);
  next.rows.forEach((row, r) => row.splice(index + 1, 0, model.rows[r]![index] ?? ''));
  return next;
}

export function moveColumn(model: TableModel, from: number, to: number): TableModel {
  const next = clone(model);
  const columns = next.header.length;
  if (from < 0 || from >= columns || to < 0 || to >= columns) return next;
  const move = <T>(arr: T[]): void => {
    const [item] = arr.splice(from, 1);
    arr.splice(to, 0, item!);
  };
  move(next.header);
  move(next.align);
  for (const row of next.rows) move(row);
  return next;
}

export function setColumnAlign(model: TableModel, index: number, align: ColumnAlign): TableModel {
  const next = clone(model);
  if (index >= 0 && index < next.align.length) next.align[index] = align;
  return next;
}

/** Set one cell; row -1 is the header */
export function setCell(model: TableModel, row: number, col: number, value: string): TableModel {
  const next = clone(model);
  if (col < 0 || col >= next.header.length) return next;
  if (row === -1) next.header[col] = value;
  else if (row >= 0 && row < next.rows.length) next.rows[row]![col] = value;
  return next;
}

/** Read one cell; row -1 is the header */
export function getCell(model: TableModel, row: number, col: number): string {
  if (row === -1) return model.header[col] ?? '';
  return model.rows[row]?.[col] ?? '';
}

// ---------------------------------------------------------------------------
// Other shapes of tabular text

/**
 * Tab- or comma-separated text (a paste from a spreadsheet) as a table, the
 * first line being the header. Needs at least two lines and two columns,
 * and every line must have the same number of fields. Quoted CSV fields
 * are understood.
 */
export function parseDelimited(text: string): TableModel | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((line) => line.trim() !== '');
  if (lines.length < 2) return null;

  const tabbed = lines.every((line) => line.includes('\t'));
  const rows = lines.map((line) => (tabbed ? line.split('\t').map((c) => c.trim()) : splitCsvLine(line)));
  const columns = rows[0]!.length;
  if (columns < 2) return null;
  if (!rows.every((row) => row.length === columns)) return null;

  return {
    indent: '',
    header: rows[0]!,
    align: Array.from({ length: columns }, () => null),
    rows: rows.slice(1),
  };
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

/**
 * Inline markdown from the editor as it has to appear in one cell: a pipe
 * table has no multi-line cells, so a hard break becomes `<br>` and any
 * other newline a space.
 */
export function toCellMarkdown(inlineMarkdown: string): string {
  return inlineMarkdown
    .replace(/ {2}\n/g, '<br>')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}
