// Column/row contract for the reusable Excel-like DataGrid. The grid owns
// interaction (editing, keyboard nav, clipboard, selection, sort/filter); the
// parent owns the data and persistence — it reacts to the emitted events.

/** Editor kind for a cell. Omit `type` (or set editable:false) for a
 *  display-only column. */
export type GridCellType = 'text' | 'number' | 'money' | 'select' | 'date';

export interface GridSelectOption {
  value: string | number | boolean;
  title: string;
}

/** A row must carry a stable identity under `rowKey` (default "id"). */
export type GridRow = Record<string, unknown>;

export interface GridColumn {
  /** Property read/written on the row object. */
  field: string;
  /** Header label (already translated). */
  title: string;
  /** Editor kind; omit for a display-only column. */
  type?: GridCellType;
  /** Editable flag. May be a predicate to gate editing per-row (e.g. a total
   *  that is only typeable when qty/price are blank). Defaults to true when a
   *  `type` is set. */
  editable?: boolean | ((row: GridRow) => boolean);
  /** Initial width in px (user-resizable). */
  width?: number;
  minWidth?: number;
  align?: 'start' | 'center' | 'end';
  /** Pin (freeze) the column against the inline-start edge while scrolling. */
  pinned?: boolean;
  /** Header click sorts (default true). */
  sortable?: boolean;
  /** Show a quick-filter input for this column (default true). */
  filterable?: boolean;
  /** Options for a `select` editor. */
  options?: GridSelectOption[];
  step?: number;
  min?: number;
  /** Display formatter (e.g. money). Falls back to String(value). */
  format?: (value: unknown, row: GridRow) => string;
  /** Coerce a pasted/typed string into the stored value. Defaults to a numeric
   *  parse for number/money columns, identity otherwise. */
  parse?: (raw: string, row: GridRow) => unknown;
  /** Per-cell validation; return an error message to block the commit, or null
   *  when valid. */
  validate?: (value: unknown, row: GridRow) => string | null;
}

/** A single edited cell on an existing row, ready for the parent to persist. */
export interface GridCellCommit {
  id: string;
  field: string;
  value: unknown;
  oldValue: unknown;
  row: GridRow;
}

/** Result of mapping a clipboard paste onto the grid: in-place edits to
 *  existing rows plus brand-new rows appended past the last row. */
export interface GridPastePayload {
  updates: { id: string; values: Record<string, unknown> }[];
  creates: Record<string, unknown>[];
}
