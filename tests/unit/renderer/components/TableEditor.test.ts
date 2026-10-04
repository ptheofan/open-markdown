/**
 * @vitest-environment jsdom
 *
 * The table editor: one editable cell at a time, keys that move between
 * cells, and the handle menus that change the table's shape.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import MarkdownIt from 'markdown-it';

import { TableEditor, tableIsEditable } from '@renderer/components/TableEditor';
import { parsePipeTable, serializePipeTable, type TableModel } from '@shared/markdown/pipeTable';

const md = new MarkdownIt({ html: true });
const RAW = ['| Name | Qty |', '| --- | ---: |', '| Apple | 3 |', '| Pear | 10 |'].join('\n');

interface Harness {
  container: HTMLElement;
  editor: TableEditor;
  changes: TableModel[];
  raw: () => string;
  cell: (row: number, col: number) => HTMLElement;
  key: (key: string, init?: KeyboardEventInit) => void;
  onLeave: ReturnType<typeof vi.fn>;
  onRemoveTable: ReturnType<typeof vi.fn>;
}

function render(container: HTMLElement, model: TableModel): void {
  container.innerHTML = md.render(serializePipeTable(model));
}

function harness(raw = RAW): Harness {
  document.body.innerHTML = '<div class="slice-content"></div>';
  const container = document.querySelector<HTMLElement>('.slice-content')!;
  let model = parsePipeTable(raw)!;
  render(container, model);
  const changes: TableModel[] = [];
  const onLeave = vi.fn();
  const onRemoveTable = vi.fn();
  const editor: TableEditor = new TableEditor(container, model, {
    onModelChange: (next) => {
      model = next;
      changes.push(next);
      render(container, next);
      editor.rebind(next);
    },
    onLeave,
    onRemoveTable,
  });
  const cell = (row: number, col: number): HTMLElement => {
    const rows = [
      container.querySelector('thead tr')!,
      ...Array.from(container.querySelectorAll('tbody tr')),
    ] as HTMLTableRowElement[];
    return rows[row + 1]!.cells[col]!;
  };
  const key = (k: string, init: KeyboardEventInit = {}): void => {
    const target = container.querySelector('[contenteditable="true"]') ?? container.querySelector('table')!;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  };
  return { container, editor, changes, raw: () => serializePipeTable(model), cell, key, onLeave, onRemoveTable };
}

const editable = (h: Harness): HTMLElement | null => h.container.querySelector<HTMLElement>('[contenteditable="true"]');

describe('tableIsEditable', () => {
  it('accepts inline marks and refuses content the serializer cannot write', () => {
    document.body.innerHTML = md.render(RAW.replace('Apple', '**Apple** `x`'));
    expect(tableIsEditable(document.querySelector('table')!)).toBe(true);
    document.body.innerHTML = md.render(RAW.replace('Apple', '<img src="x.png">'));
    expect(tableIsEditable(document.querySelector('table')!)).toBe(false);
  });
});

describe('TableEditor', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('opens the clicked cell, and only that cell, for editing', () => {
    const h = harness();
    h.editor.start({ row: 0, col: 1 });
    expect(editable(h)).toBe(h.cell(0, 1));
    expect(h.container.querySelectorAll('[contenteditable="true"]')).toHaveLength(1);
    expect(h.cell(0, 1).classList.contains('table-cell-editing')).toBe(true);
    expect(h.container.querySelectorAll('.table-row-handle')).toHaveLength(3);
    expect(h.container.querySelectorAll('.table-column-handle')).toHaveLength(2);
  });

  it('writes a typed cell back through the model with pipes escaped', () => {
    const h = harness();
    h.editor.start({ row: 0, col: 0 });
    h.cell(0, 0).textContent = 'Fig | Date';
    h.editor.commit();
    expect(h.changes).toHaveLength(1);
    expect(h.raw()).toContain('| Fig \\| Date |');
    expect(editable(h)).toBeNull();
  });

  it('keeps inline marks and turns a line break into <br>', () => {
    const h = harness();
    h.editor.start({ row: 1, col: 0 });
    h.cell(1, 0).innerHTML = '<strong>Pear</strong><br>ripe';
    h.editor.commit();
    expect(h.raw()).toContain('| **Pear**<br>ripe |');
  });

  it('Tab moves across cells and down rows, and appends a row past the last cell', () => {
    const h = harness();
    h.editor.start({ row: 0, col: 0 });
    h.key('Tab');
    expect(editable(h)).toBe(h.cell(0, 1));
    h.key('Tab');
    expect(editable(h)).toBe(h.cell(1, 0));
    h.key('Tab', { shiftKey: true });
    expect(editable(h)).toBe(h.cell(0, 1));

    h.editor.focusCell({ row: 1, col: 1 });
    h.key('Tab');
    expect(h.raw().split('\n')).toHaveLength(5);
    expect(editable(h)).toBe(h.cell(2, 0));
  });

  it('Enter commits and moves down; on the last row it adds one', () => {
    const h = harness();
    h.editor.start({ row: 0, col: 1 });
    h.cell(0, 1).textContent = '4';
    h.key('Enter');
    expect(h.raw()).toContain('| Apple |   4 |');
    expect(editable(h)).toBe(h.cell(1, 1));
    h.key('Enter');
    expect(h.raw().split('\n')).toHaveLength(5);
    expect(editable(h)).toBe(h.cell(2, 1));
  });

  it('Cmd+Enter inserts rows and Cmd+Backspace on an empty row deletes it', () => {
    const h = harness();
    h.editor.start({ row: 0, col: 0 });
    h.key('Enter', { metaKey: true });
    expect(h.raw().split('\n')[3]).toBe('|       |     |');
    expect(editable(h)).toBe(h.cell(1, 0));
    h.key('Backspace', { metaKey: true });
    expect(h.raw().split('\n')).toHaveLength(4);
    expect(h.raw()).not.toContain('|       |');
    // The cursor is on the row that took the deleted one's place (Pear)
    expect(editable(h)).toBe(h.cell(1, 0));
    h.key('Enter', { metaKey: true, shiftKey: true });
    expect(h.raw().split('\n')[3]).toBe('|       |     |');
    expect(h.raw().split('\n')[4]).toBe('| Pear  |  10 |');
  });

  it('leaves the table upward from the header and downward from the last row', () => {
    const h = harness();
    h.editor.start({ row: -1, col: 0 });
    h.key('ArrowUp');
    expect(h.onLeave).toHaveBeenCalledWith('up');
    h.editor.focusCell({ row: 1, col: 0 });
    h.key('ArrowDown');
    expect(h.onLeave).toHaveBeenCalledWith('down');
  });

  it('Alt+Shift+Arrow moves the row or column', () => {
    const h = harness();
    h.editor.start({ row: 1, col: 1 });
    h.key('ArrowUp', { altKey: true, shiftKey: true });
    expect(h.raw().split('\n')[2]).toBe('| Pear  |  10 |');
    expect(editable(h)).toBe(h.cell(0, 1));
    h.key('ArrowLeft', { altKey: true, shiftKey: true });
    expect(h.raw().split('\n')[0]).toBe('| Qty | Name  |');
    expect(editable(h)).toBe(h.cell(0, 0));
  });

  it('column menu sets alignment and inserts, moves and deletes columns', () => {
    const h = harness();
    h.editor.start({ row: 0, col: 0 });
    const columnHandle = (col: number): HTMLElement => h.container.querySelector<HTMLElement>(`.table-column-handle[data-col="${col}"]`)!;
    const pick = (action: string): void => {
      h.container.querySelector<HTMLElement>(`.table-menu [data-action="${action}"]`)!.click();
    };

    columnHandle(0).click();
    expect(h.container.querySelector('.table-menu')).not.toBeNull();
    expect(h.container.querySelector('[data-action="align-none"]')?.classList.contains('slice-menu-item-active')).toBe(true);
    pick('align-center');
    expect(h.raw().split('\n')[1]).toBe('| :---: | --: |');
    expect(h.container.querySelector('.table-menu')).toBeNull();

    columnHandle(1).click();
    pick('col-insert-right');
    expect(h.raw().split('\n')[0]).toBe('| Name  | Qty |     |');
    // The new column's header is where its name goes
    expect(editable(h)).toBe(h.cell(-1, 2));

    columnHandle(2).click();
    pick('col-move-left');
    expect(h.raw().split('\n')[0]).toBe('| Name  |     | Qty |');

    columnHandle(1).click();
    pick('col-delete');
    expect(h.raw().split('\n')[0]).toBe('| Name  | Qty |');
  });

  it('row menu inserts, duplicates, moves and deletes rows', () => {
    const h = harness();
    h.editor.start({ row: 0, col: 0 });
    const rowHandle = (row: number): HTMLElement => h.container.querySelector<HTMLElement>(`.table-row-handle[data-row="${row}"]`)!;
    const pick = (action: string): void => {
      h.container.querySelector<HTMLElement>(`.table-menu [data-action="${action}"]`)!.click();
    };

    rowHandle(0).click();
    pick('row-duplicate');
    expect(h.raw().split('\n')[3]).toBe('| Apple |   3 |');
    rowHandle(1).click();
    pick('row-move-down');
    expect(h.raw().split('\n')[4]).toBe('| Apple |   3 |');
    rowHandle(2).click();
    pick('row-delete');
    expect(h.raw().split('\n')).toHaveLength(4);
    rowHandle(-1).click();
    expect(h.container.querySelector('[data-action="row-delete"]')).toBeNull();
    pick('row-insert-below');
    expect(h.raw().split('\n')[2]).toBe('|       |     |');
  });

  it('deleting the last column hands the table over for removal', () => {
    const h = harness(['| Only |', '| --- |', '| x |'].join('\n'));
    h.editor.start({ row: 0, col: 0 });
    h.editor.deleteColumnAt(0);
    expect(h.onRemoveTable).toHaveBeenCalled();
    expect(editable(h)).toBeNull();
  });

  it('fills neighbouring cells from a tab-separated paste', () => {
    const h = harness();
    h.editor.start({ row: 0, col: 0 });
    const data = { getData: (type: string) => (type === 'text/plain' ? 'Kiwi\t7\nLime\t8\nPlum\t9' : '') };
    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', { value: data });
    h.cell(0, 0).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    const lines = h.raw().split('\n');
    expect(lines.slice(2)).toEqual(['| Kiwi |   7 |', '| Lime |   8 |', '| Plum |   9 |']);
  });

  it('a click on another cell moves the editor there', () => {
    const h = harness();
    h.editor.start({ row: 0, col: 0 });
    h.cell(1, 1).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(editable(h)).toBe(h.cell(1, 1));
  });
});
