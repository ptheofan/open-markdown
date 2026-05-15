/**
 * FloatingFormatToolbar - A small toolbar that floats above the segment being
 * edited and exposes the inline formatting actions as buttons.
 *
 * It is purely presentational: it renders buttons, positions itself, and
 * reflects active-mark state. All behaviour is delegated through `onAction`.
 * Visibility (global, default hidden) is owned by `EditModeController`.
 */

/** Actions a toolbar button can request. */
export type ToolbarAction =
  | 'bold' | 'italic' | 'strikethrough' | 'code' | 'link' | 'clear';

export interface FloatingFormatToolbarCallbacks {
  onAction: (action: ToolbarAction) => void;
}

interface ButtonSpec {
  action: ToolbarAction;
  label: string;
  title: string;
}

const BUTTONS: ButtonSpec[] = [
  { action: 'bold', label: 'B', title: 'Bold (Cmd+B)' },
  { action: 'italic', label: 'I', title: 'Italic (Cmd+I)' },
  { action: 'strikethrough', label: 'S', title: 'Strikethrough (Cmd+Shift+X)' },
  { action: 'code', label: '<>', title: 'Inline code (Cmd+E)' },
  { action: 'link', label: 'Link', title: 'Link (Cmd+K)' },
  { action: 'clear', label: 'Tx', title: 'Clear formatting' },
];

export class FloatingFormatToolbar {
  private el: HTMLElement;
  private callbacks: FloatingFormatToolbarCallbacks;

  constructor(callbacks: FloatingFormatToolbarCallbacks) {
    this.callbacks = callbacks;
    this.el = document.createElement('div');
    this.el.className = 'inline-format-toolbar';
    this.el.hidden = true;
    for (const spec of BUTTONS) {
      const btn = document.createElement('button');
      btn.dataset.action = spec.action;
      btn.textContent = spec.label;
      btn.title = spec.title;
      btn.addEventListener('mousedown', (e) => {
        // Prevent the contenteditable from losing selection on button press.
        e.preventDefault();
      });
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.callbacks.onAction(spec.action);
      });
      this.el.appendChild(btn);
    }
  }

  /** The toolbar's root element — caller appends it to the DOM once. */
  getElement(): HTMLElement {
    return this.el;
  }

  /** Show the toolbar positioned just above `segment`. */
  show(segment: HTMLElement): void {
    this.el.hidden = false;
    const rect = segment.getBoundingClientRect();
    this.el.style.position = 'absolute';
    this.el.style.left = `${rect.left + window.scrollX}px`;
    this.el.style.top = `${rect.top + window.scrollY - this.el.offsetHeight - 6}px`;
  }

  hide(): void {
    this.el.hidden = true;
  }

  /** Light up the buttons whose marks are active for the current selection. */
  setActiveMarks(active: ToolbarAction[]): void {
    for (const btn of Array.from(this.el.querySelectorAll<HTMLButtonElement>('button'))) {
      const action = btn.dataset.action as ToolbarAction;
      btn.classList.toggle('is-active', active.includes(action));
    }
  }
}
