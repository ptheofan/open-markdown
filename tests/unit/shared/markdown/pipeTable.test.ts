/**
 * The pipe-table model: text to cells and back, and the shape changes the
 * table editor performs on it
 */
import { describe, it, expect } from 'vitest';

import {
  deleteColumn,
  deleteRow,
  duplicateColumn,
  duplicateRow,
  emptyTable,
  escapeCell,
  getCell,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  parseDelimited,
  parsePipeTable,
  parsePipeTableDetailed,
  serializePipeTable,
  setCell,
  setColumnAlign,
  splitTableRow,
  toCellMarkdown,
} from '@shared/markdown/pipeTable';

const BASIC = ['| Name | Qty | Note |', '| :--- | ---: | :---: |', '| Apple | 3 | crisp |', '| Pear | 10 |  |'].join('\n');

describe('splitTableRow', () => {
  it('handles optional outer pipes and escaped pipes', () => {
    expect(splitTableRow('| a | b |')).toEqual(['a', 'b']);
    expect(splitTableRow('a | b')).toEqual(['a', 'b']);
    expect(splitTableRow('| a \\| b | `c` |')).toEqual(['a | b', '`c`']);
    expect(splitTableRow('| x | |')).toEqual(['x', '']);
  });
});

describe('parsePipeTable', () => {
  it('reads header, alignment and rows', () => {
    const model = parsePipeTable(BASIC)!;
    expect(model.header).toEqual(['Name', 'Qty', 'Note']);
    expect(model.align).toEqual(['left', 'right', 'center']);
    expect(model.rows).toEqual([
      ['Apple', '3', 'crisp'],
      ['Pear', '10', ''],
    ]);
    expect(model.indent).toBe('');
  });

  it('keeps leading indentation and reads bare delimiter rows', () => {
    const model = parsePipeTable('  a | b\n  --|--\n  1 | 2')!;
    expect(model.indent).toBe('  ');
    expect(model.align).toEqual([null, null]);
    expect(model.rows).toEqual([['1', '2']]);
  });

  it('says why a table cannot be modelled', () => {
    expect(parsePipeTableDetailed('| a |').failure).toBe('too-short');
    expect(parsePipeTableDetailed('| a | b |\n| 1 | 2 |').failure).toBe('no-delimiter-row');
    expect(parsePipeTableDetailed('| a | b |\n|---|---|\n| 1 |').failure).toBe('ragged');
    expect(parsePipeTable('| a | b |\n|---|---|\n| 1 |')).toBeNull();
  });
});

describe('serializePipeTable', () => {
  it('pads columns to equal width and writes the alignment row', () => {
    const out = serializePipeTable(parsePipeTable(BASIC)!);
    expect(out).toBe(
      ['| Name  | Qty | Note  |', '| :---- | --: | :---: |', '| Apple |   3 | crisp |', '| Pear  |  10 |       |'].join('\n')
    );
  });

  it('writes the minimal form without padding', () => {
    const out = serializePipeTable(parsePipeTable(BASIC)!, { pad: false });
    expect(out).toBe(['| Name | Qty | Note |', '| :-- | --: | :-: |', '| Apple | 3 | crisp |', '| Pear | 10 |  |'].join('\n'));
  });

  it('round-trips escaped pipes, inline HTML and indentation', () => {
    const raw = ['  | Code | Means |', '  | ---- | ----- |', '  | `a \\| b` | pipe<br>break |', '  | <b>x</b> | y |'].join('\n');
    const model = parsePipeTable(raw)!;
    expect(model.rows[0]).toEqual(['`a | b`', 'pipe<br>break']);
    const out = serializePipeTable(model);
    expect(parsePipeTable(out)).toEqual(model);
    expect(out.split('\n').every((line) => line.startsWith('  | '))).toBe(true);
    expect(out).toContain('`a \\| b`');
  });

  it('keeps at least three dashes so the row stays a delimiter', () => {
    const out = serializePipeTable(emptyTable(2, 1), { pad: false });
    expect(out.split('\n')[1]).toBe('| --- | --- |');
    expect(parsePipeTable(out)).not.toBeNull();
  });

  it('escapes pipes typed into a cell', () => {
    const model = setCell(emptyTable(1, 1), 0, 0, 'a | b');
    expect(serializePipeTable(model, { pad: false })).toContain('| a \\| b |');
    expect(escapeCell('x \\| y | z')).toBe('x \\| y \\| z');
  });
});

describe('shape changes', () => {
  const model = parsePipeTable(BASIC)!;

  it('inserts, duplicates, moves and deletes rows without touching the input', () => {
    const inserted = insertRow(model, 1);
    expect(inserted.rows).toHaveLength(3);
    expect(inserted.rows[1]).toEqual(['', '', '']);
    expect(model.rows).toHaveLength(2);

    expect(insertRow(model, 99).rows[2]).toEqual(['', '', '']);
    expect(duplicateRow(model, 0).rows.slice(0, 2)).toEqual([model.rows[0], model.rows[0]]);
    expect(moveRow(model, 0, 1).rows).toEqual([model.rows[1], model.rows[0]]);
    expect(moveRow(model, 0, 5).rows).toEqual(model.rows);
    expect(deleteRow(model, 1).rows).toEqual([model.rows[0]]);
    expect(deleteRow(deleteRow(model, 0), 0).rows).toEqual([]);
  });

  it('inserts, duplicates, moves and deletes columns across every row', () => {
    const inserted = insertColumn(model, 1, 'New');
    expect(inserted.header).toEqual(['Name', 'New', 'Qty', 'Note']);
    expect(inserted.align).toEqual(['left', null, 'right', 'center']);
    expect(inserted.rows[0]).toEqual(['Apple', '', '3', 'crisp']);

    const dup = duplicateColumn(model, 2);
    expect(dup.header).toEqual(['Name', 'Qty', 'Note', 'Note']);
    expect(dup.rows[0]).toEqual(['Apple', '3', 'crisp', 'crisp']);

    const moved = moveColumn(model, 2, 0);
    expect(moved.header).toEqual(['Note', 'Name', 'Qty']);
    expect(moved.align).toEqual(['center', 'left', 'right']);
    expect(moved.rows[1]).toEqual(['', 'Pear', '10']);

    const removed = deleteColumn(model, 0);
    expect(removed.header).toEqual(['Qty', 'Note']);
    expect(removed.rows[0]).toEqual(['3', 'crisp']);
  });

  it('sets alignment and cells, the header being row -1', () => {
    expect(setColumnAlign(model, 1, 'center').align[1]).toBe('center');
    expect(setColumnAlign(model, 1, null).align[1]).toBeNull();
    expect(getCell(setCell(model, -1, 0, 'Fruit'), -1, 0)).toBe('Fruit');
    expect(getCell(setCell(model, 1, 2, 'soft'), 1, 2)).toBe('soft');
    expect(getCell(model, 7, 7)).toBe('');
  });

  it('builds an empty table with named columns', () => {
    const t = emptyTable(2, 2);
    expect(t.header).toEqual(['Column 1', 'Column 2']);
    expect(t.rows).toEqual([['', ''], ['', '']]);
  });
});

describe('parseDelimited', () => {
  it('reads tab-separated text with the first line as header', () => {
    const model = parseDelimited('a\tb\n1\t2\n3\t4')!;
    expect(model.header).toEqual(['a', 'b']);
    expect(model.rows).toEqual([['1', '2'], ['3', '4']]);
  });

  it('reads CSV with quoted fields', () => {
    const model = parseDelimited('name,note\n"Smith, J","said ""hi"""\nLee,ok')!;
    expect(model.rows).toEqual([['Smith, J', 'said "hi"'], ['Lee', 'ok']]);
  });

  it('refuses one line, one column, or uneven rows', () => {
    expect(parseDelimited('a\tb')).toBeNull();
    expect(parseDelimited('a\nb')).toBeNull();
    expect(parseDelimited('a,b\n1')).toBeNull();
  });
});

describe('toCellMarkdown', () => {
  it('turns hard breaks into <br> and other newlines into spaces', () => {
    expect(toCellMarkdown('one  \ntwo')).toBe('one<br>two');
    expect(toCellMarkdown('one\n  two ')).toBe('one two');
  });
});
