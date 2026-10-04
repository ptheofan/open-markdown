/**
 * TableEditor - edits a pipe table in place, one cell at a time
 *
 * The rendered table keeps its layout; the cell the user clicks becomes a
 * small WYSIWYG editor (the same InlineEditor paragraphs use, so bold,
 * italic, code and links work), and Tab, Enter and the arrow keys move
 * between cells. Row and column handles open menus for the shape changes:
 * insert, delete, duplicate, move and column alignment. Every change goes
 * through the table model, and the owner writes the model back to markdown
 * and re-renders; the editor then re-attaches to the fresh DOM.
 */
import {
  deleteColumn,
  deleteRow,
  duplicateColumn,
  duplicateRow,
  getCell,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  setCell,
  setColumnAlign,
  toCellMarkdown,
  type ColumnAlign,
  type TableModel,
} from '@shared/markdown/pipeTable';

import { InlineEditor } from './InlineEditor';
import { canSerialize } from '../services/inlineMarkdownSerializer';

/** A cell address; row -1 is the header */
export interface CellAddress {
  row: number;
  col: number;
}

export interface TableEditorCallbacks {
  /**
   * The model changed. The owner serializes it, re-renders the table into the
   * same content element and calls `rebind()`; the editor then reopens the
   * cell it was on.
   */
  onModelChange: (model: TableModel) => void;
  /** ArrowUp out of the header or ArrowDown out of the last row */
  onLeave?: (direction: 'up' | 'down') => void;
  /** Cmd+K inside a cell */
  onRequestLink?: (editor: InlineEditor) => void;
  /** The last column or the header went: the table is gone */
  onRemoveTable?: () => void;
}

const HANDLES_CLASS = 'table-editor-handles';
const ACTIVE_CELL_CLASS = 'table-cell-editing';

export const ALIGN_LABELS: Record<string, string> = {
  left: 'Align left',
  center: 'Align centre',
  right: 'Align right',
  none: 'No alignment',
};

/** Whether every cell of the rendered table can be edited in place */
export function tableIsEditable(table: HTMLTableElement): boolean {
  for (const cell of table.querySelectorAll<HTMLElement>('th, td')) {
    if (!canSerialize(cell)) return false;
  }
  return true;
}

export class TableEditor {
  private readonly container: HTMLElement;
  private readonly callbacks: TableEditorCallbacks;
  private model: TableModel;
  private table: HTMLTableElement | null = null;
  private handles: HTMLElement | null = null;
  private menu: HTMLElement | null = null;
  private active: CellAddress | null = null;
  private cellEditor: InlineEditor | null = null;
  private cellElement: HTMLElement | null = null;
  /** Set while a commit should be read but not announced */
  private pendingCellMarkdown: string | null = null;
  private suppressEmit = false;
  private ended = false;

  private readonly handleKeydown: (e: KeyboardEvent) => void;
  private readonly handlePaste: (e: ClipboardEvent) => void;
  private readonly handleClick: (e: MouseEvent) => void;
  private readonly handleDocumentClick: (e: MouseEvent) => void;

  constructor(container: HTMLElement, model: TableModel, callbacks: TableEditorCallbacks) {
    this.container = container;
    this.model = model;
    this.callbacks = callbacks;
    this.handleKeydown = (e) => this.onKeydown(e);
    this.handlePaste = (e) => this.onPaste(e);
    this.handleClick = (e) => this.onClick(e);
    this.handleDocumentClick = (e) => {
      if (this.menu && !this.menu.contains(e.target as Node)) this.closeMenu();
    };
  }

  /** Begin on a cell; the first cell when none is given */
  start(cell: CellAddress | null = null): void {
    this.container.classList.add('table-editing');
    document.addEventListener('click', this.handleDocumentClick, true);
    this.bind();
    this.active = cell ?? { row: -1, col: 0 };
    this.openActive();
  }

  /**
   * The owner re-rendered the table from the model: find it again, rebuild
   * the handles and reopen the active cell.
   */
  rebind(model: TableModel): void {
    if (this.ended) return;
    this.model = model;
    this.bind();
    this.openActive();
  }

  getModel(): TableModel {
    return this.model;
  }

  getActiveCell(): CellAddress | null {
    return this.active;
  }

  /** The inline editor of the open cell, for the formatting toolbar */
  getCellEditor(): InlineEditor | null {
    return this.cellEditor;
  }

  /** The element of the open cell, for the formatting toolbar */
  getCellElement(): HTMLElement | null {
    return this.cellElement;
  }

  /** Commit the open cell and end the session */
  commit(): void {
    if (this.ended) return;
    this.closeMenu();
    // Ended first: the owner's re-render after the commit must not reopen a cell
    this.ended = true;
    this.commitCellEditor();
    this.unbind();
    this.container.classList.remove('table-editing');
    document.removeEventListener('click', this.handleDocumentClick, true);
  }

  /** Open a cell for editing, committing the one open before */
  focusCell(cell: CellAddress): void {
    const row = Math.max(-1, Math.min(cell.row, this.model.rows.length - 1));
    const col = Math.max(0, Math.min(cell.col, this.model.header.length - 1));
    this.active = { row, col };
    if (!this.commitCellEditor()) this.openActive();
  }

  // ---------------------------------------------------------------------------
  // Shape changes

  insertRowAt(index: number): void {
    const at = Math.max(0, Math.min(index, this.model.rows.length));
    this.mutate((m) => insertRow(m, at), { row: at, col: this.active?.col ?? 0 });
  }

  deleteRowAt(index: number): void {
    if (index < 0 || index >= this.model.rows.length) return;
    const nextRow = Math.min(index, this.model.rows.length - 2);
    this.mutate((m) => deleteRow(m, index), { row: nextRow, col: this.active?.col ?? 0 });
  }

  duplicateRowAt(index: number): void {
    if (index < 0 || index >= this.model.rows.length) return;
    this.mutate((m) => duplicateRow(m, index), { row: index + 1, col: this.active?.col ?? 0 });
  }

  moveRowBy(index: number, delta: number): void {
    const to = index + delta;
    if (index < 0 || to < 0 || to >= this.model.rows.length) return;
    this.mutate((m) => moveRow(m, index, to), { row: to, col: this.active?.col ?? 0 });
  }

  /** Insert a column and land on its header, where its name goes */
  insertColumnAt(index: number): void {
    const at = Math.max(0, Math.min(index, this.model.header.length));
    this.mutate((m) => insertColumn(m, at), { row: -1, col: at });
  }

  deleteColumnAt(index: number): void {
    if (index < 0 || index >= this.model.header.length) return;
    if (this.model.header.length === 1) {
      this.removeTable();
      return;
    }
    const nextCol = Math.min(index, this.model.header.length - 2);
    this.mutate((m) => deleteColumn(m, index), { row: this.active?.row ?? -1, col: nextCol });
  }

  duplicateColumnAt(index: number): void {
    if (index < 0 || index >= this.model.header.length) return;
    this.mutate((m) => duplicateColumn(m, index), { row: this.active?.row ?? -1, col: index + 1 });
  }

  moveColumnBy(index: number, delta: number): void {
    const to = index + delta;
    if (index < 0 || to < 0 || to >= this.model.header.length) return;
    this.mutate((m) => moveColumn(m, index, to), { row: this.active?.row ?? -1, col: to });
  }

  setAlign(index: number, align: ColumnAlign): void {
    this.mutate((m) => setColumnAlign(m, index, align), this.active ?? { row: -1, col: index });
  }

  /** Drop the whole table; the owner turns the slice into an empty paragraph */
  removeTable(): void {
    this.closeMenu();
    this.teardownCellEditor();
    this.ended = true;
    this.unbind();
    this.container.classList.remove('table-editing');
    document.removeEventListener('click', this.handleDocumentClick, true);
    this.callbacks.onRemoveTable?.();
  }

  // ---------------------------------------------------------------------------
  // Binding to the rendered table

  private bind(): void {
    this.unbind();
    this.table = this.container.querySelector('table');
    if (!this.table) return;
    this.table.addEventListener('keydown', this.handleKeydown, true);
    this.table.addEventListener('paste', this.handlePaste, true);
    this.table.addEventListener('click', this.handleClick);
    this.buildHandles();
  }

  private unbind(): void {
    if (this.table) {
      this.table.removeEventListener('keydown', this.handleKeydown, true);
      this.table.removeEventListener('paste', this.handlePaste, true);
      this.table.removeEventListener('click', this.handleClick);
    }
    this.table = null;
    this.handles?.remove();
    this.handles = null;
    this.closeMenu();
  }

  private rowElements(): HTMLTableRowElement[] {
    if (!this.table) return [];
    const header = this.table.querySelector<HTMLTableRowElement>('thead tr');
    const body = Array.from(this.table.querySelectorAll<HTMLTableRowElement>('tbody tr'));
    return header ? [header, ...body] : body;
  }

  private cellElementAt(cell: CellAddress): HTMLElement | null {
    const rows = this.rowElements();
    const rowEl = rows[cell.row + 1];
    if (!rowEl) return null;
    return rowEl.cells[cell.col] ?? null;
  }

  private addressOf(target: EventTarget | null): CellAddress | null {
    if (!(target instanceof Element) || !this.table) return null;
    const cellEl = target.closest<HTMLTableCellElement>('th, td');
    const rowEl = cellEl?.parentElement;
    if (!cellEl || !(rowEl instanceof HTMLTableRowElement) || !this.table.contains(cellEl)) return null;
    const rows = this.rowElements();
    const rowIndex = rows.indexOf(rowEl);
    if (rowIndex === -1) return null;
    return { row: rowIndex - 1, col: cellEl.cellIndex };
  }

  // ---------------------------------------------------------------------------
  // Cell editing

  private openActive(): void {
    if (!this.active) return;
    const cellEl = this.cellElementAt(this.active);
    if (!cellEl) return;
    this.teardownCellEditor();
    this.cellElement = cellEl;
    cellEl.classList.add(ACTIVE_CELL_CLASS);
    this.cellEditor = new InlineEditor(cellEl, {
      onCommit: (markdown) => this.onCellCommit(markdown),
      onRequestLink: () => {
        if (this.cellEditor) this.callbacks.onRequestLink?.(this.cellEditor);
      },
      onNavigate: (direction) => this.moveVertical(direction),
    });
    this.cellEditor.start();
    this.placeCaret(cellEl, 'end');
    this.markActiveHandles();
  }

  /** The InlineEditor finished: record or announce the cell's markdown */
  private onCellCommit(markdown: string): void {
    const cellMarkdown = toCellMarkdown(markdown);
    (this.committingElement ?? this.cellElement)?.classList.remove(ACTIVE_CELL_CLASS);
    if (this.suppressEmit) {
      this.pendingCellMarkdown = cellMarkdown;
      return;
    }
    const { row, col } = this.committingCell ?? this.active ?? { row: -1, col: 0 };
    if (cellMarkdown !== getCell(this.model, row, col)) {
      this.model = setCell(this.model, row, col, cellMarkdown);
      this.emitted = true;
      this.callbacks.onModelChange(this.model);
    }
  }

  private committingCell: CellAddress | null = null;
  private committingElement: HTMLElement | null = null;
  private emitted = false;

  /**
   * Commit the open cell. Returns true when a change was announced (and the
   * owner has re-rendered and rebound), false when nothing changed. The
   * editor's references are cleared before the commit, because the owner's
   * re-render reopens the next cell from inside it.
   */
  private commitCellEditor(): boolean {
    const editor = this.cellEditor;
    if (!editor) return false;
    const cellEl = this.cellElement;
    this.committingCell = cellEl ? this.addressOf(cellEl) : null;
    this.committingElement = cellEl;
    this.emitted = false;
    this.cellEditor = null;
    this.cellElement = null;
    editor.commit();
    this.committingCell = null;
    this.committingElement = null;
    return this.emitted;
  }

  /** The address of the cell the open editor sits in */
  private openCell(): CellAddress | null {
    return this.cellElement ? this.addressOf(this.cellElement) : null;
  }

  /** Read the open cell's markdown without announcing it, and close the editor */
  private readAndCloseCell(): { cell: CellAddress | null; markdown: string | null } {
    const editor = this.cellEditor;
    const cell = this.openCell();
    if (!editor) return { cell, markdown: null };
    this.suppressEmit = true;
    this.pendingCellMarkdown = null;
    this.cellEditor = null;
    editor.commit();
    this.suppressEmit = false;
    this.cellElement = null;
    return { cell, markdown: this.pendingCellMarkdown };
  }

  private teardownCellEditor(): void {
    const editor = this.cellEditor;
    this.cellEditor = null;
    if (editor) {
      this.suppressEmit = true;
      editor.commit();
      this.suppressEmit = false;
    }
    this.cellElement?.classList.remove(ACTIVE_CELL_CLASS);
    this.cellElement = null;
  }

  /**
   * Apply a shape change: fold in whatever was typed in the open cell, change
   * the model, announce it, and land on `next`.
   */
  private mutate(change: (model: TableModel) => TableModel, next: CellAddress): void {
    this.closeMenu();
    const { cell, markdown } = this.readAndCloseCell();
    let model = this.model;
    if (cell && markdown !== null && markdown !== getCell(model, cell.row, cell.col)) {
      model = setCell(model, cell.row, cell.col, markdown);
    }
    model = change(model);
    this.model = model;
    this.active = {
      row: Math.max(-1, Math.min(next.row, model.rows.length - 1)),
      col: Math.max(0, Math.min(next.col, model.header.length - 1)),
    };
    this.callbacks.onModelChange(model);
  }

  // ---------------------------------------------------------------------------
  // Movement

  private moveVertical(direction: 'up' | 'down'): void {
    if (!this.active) return;
    const { row, col } = this.active;
    if (direction === 'up') {
      if (row === -1) {
        this.commitCellEditor();
        this.callbacks.onLeave?.('up');
        return;
      }
      this.focusCell({ row: row - 1, col });
    } else {
      if (row >= this.model.rows.length - 1) {
        this.commitCellEditor();
        this.callbacks.onLeave?.('down');
        return;
      }
      this.focusCell({ row: row + 1, col });
    }
  }

  /** Tab order: left to right, then the next row; past the last cell, a new row */
  private moveNext(): void {
    if (!this.active) return;
    const { row, col } = this.active;
    const columns = this.model.header.length;
    if (col < columns - 1) {
      this.focusCell({ row, col: col + 1 });
    } else if (row < this.model.rows.length - 1) {
      this.focusCell({ row: row + 1, col: 0 });
    } else {
      this.mutate((m) => insertRow(m, m.rows.length), { row: this.model.rows.length, col: 0 });
    }
  }

  private movePrevious(): void {
    if (!this.active) return;
    const { row, col } = this.active;
    if (col > 0) {
      this.focusCell({ row, col: col - 1 });
    } else if (row > -1) {
      this.focusCell({ row: row - 1, col: this.model.header.length - 1 });
    }
  }

  /** Enter: commit and go down a row; on the last row, add one */
  private moveDownOrAppend(): void {
    if (!this.active) return;
    const { row, col } = this.active;
    if (row < this.model.rows.length - 1) {
      this.focusCell({ row: row + 1, col });
    } else {
      this.mutate((m) => insertRow(m, m.rows.length), { row: this.model.rows.length, col });
    }
  }

  private placeCaret(cellEl: HTMLElement, at: 'start' | 'end'): void {
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(cellEl);
    range.collapse(at === 'start');
    sel.removeAllRanges();
    sel.addRange(range);
  }

  private caretAtEdge(cellEl: HTMLElement, side: 'start' | 'end'): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
    const range = sel.getRangeAt(0);
    if (!cellEl.contains(range.startContainer)) return false;
    const probe = document.createRange();
    probe.selectNodeContents(cellEl);
    if (side === 'start') probe.setEnd(range.startContainer, range.startOffset);
    else probe.setStart(range.endContainer, range.endOffset);
    return probe.toString().length === 0;
  }

  // ---------------------------------------------------------------------------
  // Events

  private onClick(e: MouseEvent): void {
    const target = e.target as Element | null;
    if (target?.closest('a')) return;
    const cell = this.addressOf(e.target);
    if (!cell) return;
    if (this.active && cell.row === this.active.row && cell.col === this.active.col && this.cellEditor) return;
    this.focusCell(cell);
  }

  private onKeydown(e: KeyboardEvent): void {
    if (!this.active || !this.cellElement) return;
    const mod = e.metaKey || e.ctrlKey;
    const { row, col } = this.active;

    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) this.movePrevious();
      else this.moveNext();
      return;
    }

    if (e.key === 'Enter') {
      if (e.shiftKey && !mod) return; // InlineEditor inserts the <br>
      e.preventDefault();
      e.stopPropagation();
      if (mod && e.shiftKey) this.insertRowAt(Math.max(0, row));
      else if (mod) this.insertRowAt(row + 1);
      else this.moveDownOrAppend();
      return;
    }

    if (e.key === 'Backspace' && mod && row >= 0) {
      const current = this.readOpenCellText();
      const rowEmpty = this.model.rows[row]!.every((cell, c) => (c === col ? current : cell).trim() === '');
      if (rowEmpty) {
        e.preventDefault();
        e.stopPropagation();
        this.deleteRowAt(row);
      }
      return;
    }

    if (e.altKey && e.shiftKey && e.key.startsWith('Arrow')) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'ArrowUp' && row > 0) this.moveRowBy(row, -1);
      else if (e.key === 'ArrowDown' && row >= 0) this.moveRowBy(row, 1);
      else if (e.key === 'ArrowLeft') this.moveColumnBy(col, -1);
      else if (e.key === 'ArrowRight') this.moveColumnBy(col, 1);
      return;
    }

    if (e.key === 'ArrowLeft' && !mod && !e.shiftKey && this.caretAtEdge(this.cellElement, 'start')) {
      if (col > 0 || row > -1) {
        e.preventDefault();
        e.stopPropagation();
        this.movePrevious();
      }
      return;
    }
    if (e.key === 'ArrowRight' && !mod && !e.shiftKey && this.caretAtEdge(this.cellElement, 'end')) {
      const last = col === this.model.header.length - 1 && row === this.model.rows.length - 1;
      if (!last) {
        e.preventDefault();
        e.stopPropagation();
        this.moveNext();
      }
    }
  }

  /** What the open cell says right now, as plain text */
  private readOpenCellText(): string {
    return this.cellElement?.textContent ?? '';
  }

  /**
   * Pasting tab- or newline-separated text fills the cells from the open
   * one, adding rows as needed. Anything else is left to the browser.
   */
  private onPaste(e: ClipboardEvent): void {
    if (!this.active) return;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!text.includes('\t') && !/\r?\n./.test(text.trim())) return;
    e.preventDefault();
    e.stopPropagation();

    const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
    const grid = lines.map((line) => line.split('\t'));
    const start = this.active;
    this.mutate((m) => {
      let model = m;
      grid.forEach((cells, r) => {
        const row = start.row + r;
        while (row >= 0 && row >= model.rows.length) model = insertRow(model, model.rows.length);
        cells.forEach((value, c) => {
          const col = start.col + c;
          if (col < model.header.length) model = setCell(model, row, col, value.trim());
        });
      });
      return model;
    }, start);
  }

  // ---------------------------------------------------------------------------
  // Handles and menus

  private buildHandles(): void {
    if (!this.table) return;
    this.handles?.remove();
    const handles = document.createElement('div');
    handles.className = HANDLES_CLASS;

    const rows = this.rowElements();
    rows.forEach((rowEl, i) => {
      const row = i - 1;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'table-handle table-row-handle';
      button.dataset.row = String(row);
      button.title = row === -1 ? 'Header row' : `Row ${row + 1}`;
      button.setAttribute('aria-label', button.title);
      button.innerHTML = '<span></span><span></span>';
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openRowMenu(row, button);
      });
      this.positionRowHandle(button, rowEl);
      handles.appendChild(button);
    });

    const headerCells = rows[0]?.cells;
    if (headerCells) {
      Array.from(headerCells).forEach((cellEl, col) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'table-handle table-column-handle';
        button.dataset.col = String(col);
        button.title = `Column ${col + 1}`;
        button.setAttribute('aria-label', button.title);
        button.innerHTML = '<span></span><span></span>';
        button.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openColumnMenu(col, button);
        });
        this.positionColumnHandle(button, cellEl);
        handles.appendChild(button);
      });
    }

    this.container.appendChild(handles);
    this.handles = handles;
    this.markActiveHandles();
  }

  private positionRowHandle(button: HTMLElement, rowEl: HTMLElement): void {
    const base = this.container.getBoundingClientRect();
    const rect = rowEl.getBoundingClientRect();
    button.style.top = `${rect.top - base.top + Math.max(0, (rect.height - 16) / 2)}px`;
  }

  private positionColumnHandle(button: HTMLElement, cellEl: HTMLElement): void {
    const base = this.container.getBoundingClientRect();
    const rect = cellEl.getBoundingClientRect();
    button.style.left = `${rect.left - base.left + Math.max(0, (rect.width - 16) / 2)}px`;
  }

  private markActiveHandles(): void {
    if (!this.handles) return;
    for (const handle of this.handles.querySelectorAll<HTMLElement>('.table-handle')) {
      const isRow = handle.dataset.row !== undefined;
      const match = isRow
        ? Number(handle.dataset.row) === this.active?.row
        : Number(handle.dataset.col) === this.active?.col;
      handle.classList.toggle('table-handle-active', match);
    }
  }

  private openRowMenu(row: number, anchor: HTMLElement): void {
    this.closeMenu();
    const items: Array<{ id: string; label: string; enabled?: boolean; danger?: boolean }> = [];
    if (row >= 0) items.push({ id: 'row-insert-above', label: 'Insert row above' });
    items.push({ id: 'row-insert-below', label: 'Insert row below' });
    if (row >= 0) {
      items.push({ id: 'row-duplicate', label: 'Duplicate row' });
      items.push({ id: 'row-move-up', label: 'Move up', enabled: row > 0 });
      items.push({ id: 'row-move-down', label: 'Move down', enabled: row < this.model.rows.length - 1 });
      items.push({ id: 'row-delete', label: 'Delete row', danger: true });
    } else {
      items.push({ id: 'table-delete', label: 'Delete table', danger: true });
    }
    this.showMenu(anchor, items, (id) => {
      switch (id) {
        case 'row-insert-above':
          this.insertRowAt(row);
          break;
        case 'row-insert-below':
          this.insertRowAt(row + 1);
          break;
        case 'row-duplicate':
          this.duplicateRowAt(row);
          break;
        case 'row-move-up':
          this.moveRowBy(row, -1);
          break;
        case 'row-move-down':
          this.moveRowBy(row, 1);
          break;
        case 'row-delete':
          this.deleteRowAt(row);
          break;
        case 'table-delete':
          this.removeTable();
          break;
        default:
          break;
      }
    });
  }

  private openColumnMenu(col: number, anchor: HTMLElement): void {
    this.closeMenu();
    const current = this.model.align[col] ?? null;
    const alignItems = (['left', 'center', 'right', 'none'] as const).map((key) => ({
      id: `align-${key}`,
      label: ALIGN_LABELS[key]!,
      active: (current ?? 'none') === key,
    }));
    const columns = this.model.header.length;
    const items = [
      ...alignItems,
      { id: 'divider' },
      { id: 'col-insert-left', label: 'Insert column left' },
      { id: 'col-insert-right', label: 'Insert column right' },
      { id: 'col-duplicate', label: 'Duplicate column' },
      { id: 'col-move-left', label: 'Move left', enabled: col > 0 },
      { id: 'col-move-right', label: 'Move right', enabled: col < columns - 1 },
      { id: 'col-delete', label: columns === 1 ? 'Delete table' : 'Delete column', danger: true },
    ];
    this.showMenu(anchor, items, (id) => {
      switch (id) {
        case 'align-left':
          this.setAlign(col, 'left');
          break;
        case 'align-center':
          this.setAlign(col, 'center');
          break;
        case 'align-right':
          this.setAlign(col, 'right');
          break;
        case 'align-none':
          this.setAlign(col, null);
          break;
        case 'col-insert-left':
          this.insertColumnAt(col);
          break;
        case 'col-insert-right':
          this.insertColumnAt(col + 1);
          break;
        case 'col-duplicate':
          this.duplicateColumnAt(col);
          break;
        case 'col-move-left':
          this.moveColumnBy(col, -1);
          break;
        case 'col-move-right':
          this.moveColumnBy(col, 1);
          break;
        case 'col-delete':
          this.deleteColumnAt(col);
          break;
        default:
          break;
      }
    });
  }

  private showMenu(
    anchor: HTMLElement,
    items: Array<{ id: string; label?: string; enabled?: boolean; danger?: boolean; active?: boolean }>,
    onPick: (id: string) => void
  ): void {
    const menu = document.createElement('div');
    menu.className = 'slice-menu table-menu';
    for (const item of items) {
      if (item.id === 'divider') {
        const divider = document.createElement('div');
        divider.className = 'slice-menu-divider';
        menu.appendChild(divider);
        continue;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'slice-menu-item';
      button.dataset.action = item.id;
      if (item.danger) button.classList.add('slice-menu-item-danger');
      if (item.active) button.classList.add('slice-menu-item-active');
      button.disabled = item.enabled === false;
      button.textContent = item.label ?? '';
      button.addEventListener('mousedown', (e) => e.preventDefault());
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeMenu();
        onPick(item.id);
      });
      menu.appendChild(button);
    }
    menu.style.top = `${anchor.offsetTop + anchor.offsetHeight + 2}px`;
    menu.style.left = `${anchor.offsetLeft}px`;
    this.handles?.appendChild(menu);
    this.menu = menu;
  }

  private closeMenu(): void {
    this.menu?.remove();
    this.menu = null;
  }
}
