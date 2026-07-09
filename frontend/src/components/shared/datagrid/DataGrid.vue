<script setup lang="ts">
// Reusable Excel-like data grid built on Vuetify primitives (no third-party
// grid, no license). It owns interaction — in-cell editing, keyboard
// navigation, clipboard copy/paste in Excel's TSV dialect, multi-row
// selection, client-side sort/filter, pinned columns, column resize — and
// emits semantic events. The PARENT owns the data and persistence: it reacts
// to `cell-commit` / `new-commit` / `paste` / `delete-rows` by calling its API
// and refreshing the `rows` prop.
//
// Deliberately deferred (see roadmap): row virtualization for >1k rows and the
// drag fill-handle. `Ctrl+D` fills down from the cell above as a light autofill.
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { t } from '@/i18n';
import { parseCsv, parseTsv, stringifyCsv, stringifyTsv } from '@/lib/tsv';
import type { GridCellCommit, GridColumn, GridPastePayload, GridRow, GridRowAction } from './types';

const props = withDefaults(
  defineProps<{
    rows: GridRow[];
    columns: GridColumn[];
    rowKey?: string;
    /** Master gate (e.g. an RBAC check). When false the grid is read-only. */
    editable?: boolean;
    /** Render a persistent entry row at the bottom for fast appends. */
    showNewRow?: boolean;
    /** Seeds the new row (and pasted create rows) with default values. */
    newRowFactory?: () => Record<string, unknown>;
    /** Show the checkbox column + multi-row delete affordance. */
    selectable?: boolean;
    /** Per-row CSS class — used for status colouring. The grid ships reusable
     *  `cp-row-success|error|warning|muted` classes for this. */
    rowClass?: (row: GridRow) => string | undefined;
    /** Right-click menu actions for a row (parent-supplied; e.g. delete/open).
     *  A built-in "copy row" action is always prepended. */
    rowActions?: (row: GridRow) => GridRowAction[];
    /** Show the CSV export (and, when showNewRow is set, import) toolbar. */
    enableCsv?: boolean;
    /** Base filename for CSV export (no extension). */
    exportName?: string;
    /** Scroll viewport height; the header stays pinned within it. */
    height?: string;
    loading?: boolean;
  }>(),
  {
    rowKey: 'id',
    editable: true,
    showNewRow: false,
    selectable: false,
    enableCsv: false,
    exportName: 'data',
    height: '520px',
    loading: false,
  },
);

const emit = defineEmits<{
  (e: 'cell-commit', payload: GridCellCommit): void;
  (e: 'new-commit', values: Record<string, unknown>): void;
  (e: 'paste', payload: GridPastePayload): void;
  (e: 'delete-rows', ids: string[]): void;
}>();

const NEW_ROW_ID = '__cp_new__';

// ---------------------------------------------------------------------------
// Identity / column helpers
// ---------------------------------------------------------------------------
const rk = computed(() => props.rowKey);
const idOf = (row: GridRow): string => String(row[rk.value]);

const editableCols = computed(() =>
  props.columns.filter((c) => c.type != null && c.editable !== false),
);
const colByField = (field: string) => props.columns.find((c) => c.field === field);

function isCellEditable(col: GridColumn, row: GridRow): boolean {
  if (col.type == null) return false;
  // Existing rows are gated by `editable`; the entry row by `showNewRow` — so a
  // create-only user still gets the new row without being able to edit others.
  if (idOf(row) === NEW_ROW_ID) {
    if (!props.showNewRow) return false;
  } else if (!props.editable) return false;
  const e = col.editable;
  if (e === false) return false;
  if (typeof e === 'function') return e(row);
  return true;
}

// ---------------------------------------------------------------------------
// Display / parse
// ---------------------------------------------------------------------------
function displayValue(col: GridColumn, row: GridRow): string {
  const v = row[col.field];
  if (col.format) return col.format(v, row);
  if (v == null) return '';
  if (col.type === 'select' && col.options) {
    const o = col.options.find((opt) => String(opt.value) === String(v));
    return o ? o.title : String(v);
  }
  if (col.type === 'date') return String(v).slice(0, 10);
  return String(v);
}

function parseColValue(col: GridColumn, raw: unknown, row: GridRow): unknown {
  const s = raw == null ? '' : String(raw);
  if (col.parse) return col.parse(s, row);
  if (col.type === 'number' || col.type === 'money') {
    if (s.trim() === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : s; // keep raw so validate can flag it
  }
  if (col.type === 'date') return s.trim() === '' ? null : s;
  if (col.type === 'select') return raw;
  return s;
}

const valuesEqual = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '');

// ---------------------------------------------------------------------------
// Sort + filter (client-side)
// ---------------------------------------------------------------------------
const sortState = ref<{ field: string; dir: 'asc' | 'desc' } | null>(null);
const filters = reactive<Record<string, string>>({});

function toggleSort(field: string) {
  const col = colByField(field);
  if (!col || col.sortable === false) return;
  if (sortState.value?.field !== field) sortState.value = { field, dir: 'asc' };
  else if (sortState.value.dir === 'asc') sortState.value = { field, dir: 'desc' };
  else sortState.value = null;
}

function compareVals(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && String(a).trim() !== '' && String(b).trim() !== '')
    return na - nb;
  return String(a).localeCompare(String(b), 'ar');
}

const displayRows = computed<GridRow[]>(() => {
  let out = props.rows;
  const active = Object.entries(filters).filter(([, v]) => v && v.trim() !== '');
  if (active.length) {
    out = out.filter((row) =>
      active.every(([field, needle]) => {
        const col = colByField(field);
        if (!col) return true;
        return displayValue(col, row).toLowerCase().includes(needle.toLowerCase());
      }),
    );
  }
  if (sortState.value) {
    const { field, dir } = sortState.value;
    out = [...out].sort((ra, rb) => {
      const r = compareVals(ra[field], rb[field]);
      return dir === 'asc' ? r : -r;
    });
  }
  return out;
});

// The new row is appended as a real row (id === NEW_ROW_ID) so one template
// loop renders both data rows and the entry row.
const newRow = reactive<Record<string, unknown>>({});
let newRowDefaults: Record<string, unknown> = {};
function resetNewRow() {
  const defaults = props.newRowFactory ? props.newRowFactory() : {};
  newRowDefaults = { ...defaults };
  for (const key of Object.keys(newRow)) delete newRow[key];
  Object.assign(newRow, defaults);
  newRow[rk.value] = NEW_ROW_ID;
}
resetNewRow();

const showEntryRow = computed(() => props.showNewRow);
const renderRows = computed<GridRow[]>(() =>
  showEntryRow.value ? [...displayRows.value, newRow] : displayRows.value,
);
const isNewRow = (row: GridRow) => idOf(row) === NEW_ROW_ID;

function getRowById(id: string): GridRow | null {
  if (id === NEW_ROW_ID) return newRow;
  return displayRows.value.find((r) => idOf(r) === id) ?? null;
}

const navRowIds = computed<string[]>(() => {
  const ids = displayRows.value.map(idOf);
  if (showEntryRow.value) ids.push(NEW_ROW_ID);
  return ids;
});

// ---------------------------------------------------------------------------
// Row virtualization (fixed 30px rows)
// Only rows overlapping the viewport (+ overscan) are painted; top/bottom
// spacer <tr>s hold the full scroll height so the scrollbar stays honest. The
// fixed row height keeps the window math exact, so a >1k-row grid (the
// materials catalogue, a big project's costs) stays light. Every data
// operation — sort, filter, select, copy, paste — runs on the full row model
// above; virtualization only trims what the DOM renders.
// ---------------------------------------------------------------------------
const ROW_H = 30;
const OVERSCAN = 8;
const scrollTop = ref(0);
const viewportH = ref(600);
const theadEl = ref<HTMLElement | null>(null);

const vTotal = computed(() => renderRows.value.length);
// Small grids (project tabs, short lists) render in full — the original, safe
// path. Windowing only engages past this many rows, where it actually pays off
// (the materials catalogue, a big project's costs), so a subtle windowing bug
// can never regress the common small-grid cases.
const VIRTUAL_MIN = 100;
const virtualize = computed(() => vTotal.value > VIRTUAL_MIN);
const vStart = computed(() =>
  virtualize.value ? Math.max(0, Math.floor(scrollTop.value / ROW_H) - OVERSCAN) : 0,
);
const vEnd = computed(() =>
  virtualize.value
    ? Math.min(vTotal.value, Math.ceil((scrollTop.value + viewportH.value) / ROW_H) + OVERSCAN)
    : vTotal.value,
);
const windowRows = computed<GridRow[]>(() => renderRows.value.slice(vStart.value, vEnd.value));
const padTop = computed(() => vStart.value * ROW_H);
const padBottom = computed(() => Math.max(0, (vTotal.value - vEnd.value) * ROW_H));
const colSpan = computed(() => props.columns.length + (props.selectable ? 1 : 0));

function onGridScroll() {
  if (gridEl.value) scrollTop.value = gridEl.value.scrollTop;
}
function measureViewport() {
  if (gridEl.value) viewportH.value = gridEl.value.clientHeight || viewportH.value;
}

// Keep the active/target row painted during keyboard nav: if it sits outside
// the window, nudge scrollTop so it lands just below the sticky header (or at
// the bottom edge), then the window recomputes to include it before we focus.
function scrollRowIntoView(index: number) {
  const el = gridEl.value;
  if (!el) return;
  const headH = theadEl.value?.offsetHeight ?? 56;
  const rowTop = index * ROW_H;
  const contentTop = headH + rowTop;
  const curr = el.scrollTop;
  let next = curr;
  if (contentTop < curr + headH) next = rowTop;
  else if (contentTop + ROW_H > curr + el.clientHeight) next = contentTop + ROW_H - el.clientHeight;
  next = Math.max(0, next);
  if (next !== curr) {
    el.scrollTop = next;
    scrollTop.value = next;
  }
}

let ro: ResizeObserver | null = null;
onMounted(() => {
  measureViewport();
  if (typeof ResizeObserver !== 'undefined' && gridEl.value) {
    ro = new ResizeObserver(measureViewport);
    ro.observe(gridEl.value);
  }
});
onBeforeUnmount(() => {
  ro?.disconnect();
  ro = null;
});

// After the row set changes (filter/sort/refetch) the browser may clamp the
// scroll position — resync so the window math matches the real scrollTop.
watch(vTotal, () => {
  void nextTick(() => {
    if (gridEl.value) scrollTop.value = gridEl.value.scrollTop;
  });
});

// ---------------------------------------------------------------------------
// Active cell + editing
// ---------------------------------------------------------------------------
const active = ref<{ rowId: string; field: string } | null>(null);
const editing = ref(false);
const editValue = ref<unknown>('');
const cellError = ref<{ rowId: string; field: string; msg: string } | null>(null);
const editorRef = ref<{ focus?: () => void } | null>(null);
const gridEl = ref<HTMLElement | null>(null);

const isActiveCell = (rowId: string, field: string) =>
  active.value?.rowId === rowId && active.value?.field === field;
const isEditingCell = (rowId: string, field: string) => editing.value && isActiveCell(rowId, field);
const cellErrorMsg = (rowId: string, field: string) =>
  cellError.value && cellError.value.rowId === rowId && cellError.value.field === field
    ? cellError.value.msg
    : null;

function focusGrid() {
  void nextTick(() => gridEl.value?.focus());
}

function setActive(rowId: string, field: string) {
  active.value = { rowId, field };
  editing.value = false;
}

function startEditAt(rowId: string, field: string, seed?: string) {
  const col = colByField(field);
  const row = getRowById(rowId);
  if (!col || !row) return;
  active.value = { rowId, field };
  if (!isCellEditable(col, row)) {
    editing.value = false;
    return;
  }
  editValue.value = seed !== undefined ? seed : initialEditValue(col, row);
  editing.value = true;
  cellError.value = null;
  void nextTick(() => editorRef.value?.focus?.());
}

function initialEditValue(col: GridColumn, row: GridRow): unknown {
  const v = row[col.field];
  if (col.type === 'select') return v ?? null;
  if (col.type === 'date') return v ? String(v).slice(0, 10) : '';
  return v == null ? '' : String(v);
}

/** Validate + apply the in-progress edit. Returns false (and keeps editing)
 *  when validation fails. */
function commitActive(): boolean {
  if (!active.value) return true;
  const { rowId, field } = active.value;
  const col = colByField(field);
  const row = getRowById(rowId);
  if (!col || !row) return true;
  const value = parseColValue(col, editValue.value, row);
  const err = col.validate ? col.validate(value, row) : null;
  if (err) {
    cellError.value = { rowId, field, msg: err };
    return false;
  }
  cellError.value = null;
  if (rowId === NEW_ROW_ID) {
    newRow[field] = value;
  } else if (!valuesEqual(value, row[field])) {
    emit('cell-commit', { id: rowId, field, value, oldValue: row[field], row });
  }
  return true;
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------
function moveTo(rowIdx: number, colIdx: number, edit: boolean) {
  const rows = navRowIds.value;
  const cols = editableCols.value;
  if (!rows.length || !cols.length) return;
  const r = Math.max(0, Math.min(rowIdx, rows.length - 1));
  const c = Math.max(0, Math.min(colIdx, cols.length - 1));
  const rowId = rows[r];
  const col = cols[c];
  if (rowId === undefined || col === undefined) return;
  // Paint the target row first when it's outside the virtual window.
  scrollRowIntoView(r);
  if (edit) startEditAt(rowId, col.field);
  else {
    setActive(rowId, col.field);
    focusGrid();
  }
}

function currentIndices(): { r: number; c: number } | null {
  if (!active.value) return null;
  const r = navRowIds.value.indexOf(active.value.rowId);
  const c = editableCols.value.findIndex((col) => col.field === active.value!.field);
  if (r < 0 || c < 0) return null;
  return { r, c };
}

/** Tab / Shift+Tab: commit, then move horizontally with edit; wrap to the
 *  next/previous row. On the entry row, Tab off the last column submits it. */
function moveNext(forward: boolean) {
  if (!commitActive()) return;
  const idx = currentIndices();
  if (!idx) return;
  const lastCol = editableCols.value.length - 1;
  if (forward && idx.c >= lastCol) {
    if (active.value?.rowId === NEW_ROW_ID) return submitNewRow();
    moveTo(idx.r + 1, 0, true);
  } else if (!forward && idx.c <= 0) {
    moveTo(idx.r - 1, lastCol, true);
  } else {
    moveTo(idx.r, idx.c + (forward ? 1 : -1), true);
  }
}

/** Enter on a data cell: commit and drop to the same column one row down. */
function moveDown() {
  if (!commitActive()) return;
  const idx = currentIndices();
  if (!idx) return;
  moveTo(idx.r + 1, idx.c, false);
}

function isNewRowDirty(): boolean {
  return editableCols.value.some(
    (c) => String(newRow[c.field] ?? '') !== String(newRowDefaults[c.field] ?? ''),
  );
}

function submitNewRow() {
  if (isNewRowDirty()) {
    const { [rk.value]: _omit, ...values } = newRow;
    emit('new-commit', values);
    resetNewRow();
  }
  const first = editableCols.value[0];
  if (first) startEditAt(NEW_ROW_ID, first.field);
}

// ---------------------------------------------------------------------------
// Editor event handlers
// ---------------------------------------------------------------------------
function onEditorEnter() {
  if (!commitActive()) return;
  if (active.value?.rowId === NEW_ROW_ID) submitNewRow();
  else moveDown();
}
function onEditorTab(ev: KeyboardEvent) {
  moveNext(!ev.shiftKey);
}
function onEditorEsc() {
  editing.value = false;
  cellError.value = null;
  focusGrid();
}
function onEditorBlur() {
  if (editing.value && commitActive()) editing.value = false;
}
function onSelectPick(v: unknown) {
  editValue.value = v;
  if (!commitActive()) return;
  if (active.value?.rowId === NEW_ROW_ID) moveNext(true);
  else moveDown();
}

// ---------------------------------------------------------------------------
// Cell mouse interaction
// ---------------------------------------------------------------------------
function onCellMouseDown(rowId: string, field: string) {
  if (isEditingCell(rowId, field)) return;
  if (editing.value) commitActive();
  setActive(rowId, field);
  focusGrid();
}
function onCellDblClick(rowId: string, field: string) {
  startEditAt(rowId, field);
}

// ---------------------------------------------------------------------------
// Container keyboard (when NOT editing an input)
// ---------------------------------------------------------------------------
function onContainerKeydown(ev: KeyboardEvent) {
  if (editing.value || !active.value) return;
  const idx = currentIndices();
  if (!idx) return;
  const key = ev.key;
  if (key === 'ArrowDown') {
    ev.preventDefault();
    moveTo(idx.r + 1, idx.c, false);
  } else if (key === 'ArrowUp') {
    ev.preventDefault();
    moveTo(idx.r - 1, idx.c, false);
  } else if (key === 'ArrowRight') {
    ev.preventDefault();
    moveTo(idx.r, idx.c + 1, false);
  } else if (key === 'ArrowLeft') {
    ev.preventDefault();
    moveTo(idx.r, idx.c - 1, false);
  } else if (key === 'Tab') {
    ev.preventDefault();
    moveNext(!ev.shiftKey);
  } else if (key === 'Enter' || key === 'F2') {
    ev.preventDefault();
    startEditAt(active.value.rowId, active.value.field);
  } else if (key === 'Delete' || key === 'Backspace') {
    ev.preventDefault();
    clearActiveCell();
  } else if ((ev.ctrlKey || ev.metaKey) && (key === 'd' || key === 'D')) {
    ev.preventDefault();
    fillDown();
  } else if (key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
    startEditAt(active.value.rowId, active.value.field, key);
  }
}

function clearActiveCell() {
  if (!active.value) return;
  const { rowId, field } = active.value;
  const col = colByField(field);
  const row = getRowById(rowId);
  if (!col || !row || !isCellEditable(col, row)) return;
  if (rowId === NEW_ROW_ID) newRow[field] = null;
  else if (row[field] != null && row[field] !== '')
    emit('cell-commit', { id: rowId, field, value: null, oldValue: row[field], row });
}

function fillDown() {
  const idx = currentIndices();
  if (!idx || idx.r <= 0) return;
  const aboveId = navRowIds.value[idx.r - 1];
  if (aboveId === undefined) return;
  const aboveRow = getRowById(aboveId);
  const col = editableCols.value[idx.c];
  const row = active.value ? getRowById(active.value.rowId) : null;
  if (!aboveRow || !col || !row || !isCellEditable(col, row)) return;
  const value = aboveRow[col.field] ?? null;
  if (active.value!.rowId === NEW_ROW_ID) newRow[col.field] = value;
  else if (!valuesEqual(value, row[col.field]))
    emit('cell-commit', {
      id: active.value!.rowId,
      field: col.field,
      value,
      oldValue: row[col.field],
      row,
    });
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------
function onCopy(ev: ClipboardEvent) {
  if (editing.value) return; // let the input copy its own text
  if (!ev.clipboardData) return;
  let matrix: string[][];
  if (selectedIds.value.size > 0) {
    matrix = displayRows.value
      .filter((r) => selectedIds.value.has(idOf(r)))
      .map((r) => props.columns.map((c) => displayValue(c, r)));
  } else if (active.value) {
    const col = colByField(active.value.field);
    const row = getRowById(active.value.rowId);
    if (!col || !row) return;
    matrix = [[displayValue(col, row)]];
  } else return;
  ev.clipboardData.setData('text/plain', stringifyTsv(matrix));
  ev.preventDefault();
}

function onPaste(ev: ClipboardEvent) {
  if (editing.value || !active.value) return; // let the input paste normally
  const text = ev.clipboardData?.getData('text/plain');
  if (!text) return;
  const matrix = parseTsv(text);
  if (!matrix.length) return;
  ev.preventDefault();

  const cols = editableCols.value;
  const startC = cols.findIndex((c) => c.field === active.value!.field);
  const startR =
    active.value.rowId === NEW_ROW_ID
      ? displayRows.value.length
      : displayRows.value.findIndex((r) => idOf(r) === active.value!.rowId);
  if (startC < 0 || startR < 0) return;

  const updateMap = new Map<string, Record<string, unknown>>();
  const createMap = new Map<number, Record<string, unknown>>();

  matrix.forEach((line, i) => {
    line.forEach((raw, j) => {
      const col = cols[startC + j];
      if (!col) return; // overflow past the last column
      const targetR = startR + i;
      if (targetR < displayRows.value.length) {
        const target = displayRows.value[targetR];
        if (!target || !isCellEditable(col, target)) return;
        const id = idOf(target);
        const bucket = updateMap.get(id) ?? {};
        bucket[col.field] = parseColValue(col, raw, target);
        updateMap.set(id, bucket);
      } else {
        const createIdx = targetR - displayRows.value.length;
        const bucket =
          createMap.get(createIdx) ?? (props.newRowFactory ? props.newRowFactory() : {});
        bucket[col.field] = parseColValue(col, raw, bucket);
        createMap.set(createIdx, bucket);
      }
    });
  });

  emit('paste', {
    updates: [...updateMap.entries()].map(([id, values]) => ({ id, values })),
    creates: [...createMap.keys()].sort((a, b) => a - b).map((k) => createMap.get(k)!),
  });
}

// ---------------------------------------------------------------------------
// CSV export / import (file, comma-delimited, Excel-compatible)
// ---------------------------------------------------------------------------
const fileInput = ref<HTMLInputElement | null>(null);

function exportCsv() {
  const header = props.columns.map((c) => c.title);
  const body = displayRows.value.map((r) => props.columns.map((c) => displayValue(c, r)));
  const csv = stringifyCsv([header, ...body]);
  // Prepend a BOM so Excel reads the UTF-8 Arabic text correctly.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${props.exportName}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function triggerImport() {
  fileInput.value?.click();
}

function onImportFile(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    input.value = ''; // allow re-importing the same file
    const text = String(reader.result ?? '').replace(/^﻿/, '');
    const matrix = parseCsv(text);
    if (!matrix.length) return;
    // Map by header title when the first row matches column titles; otherwise
    // fall back to positional mapping over the editable columns.
    const byTitle = new Map(props.columns.filter((c) => c.type).map((c) => [c.title.trim(), c]));
    const headerCols = (matrix[0] ?? []).map((h) => byTitle.get(h.trim()) ?? null);
    const useHeader = headerCols.some(Boolean);
    const cols: (GridColumn | null)[] = useHeader ? headerCols : editableCols.value;
    const startRow = useHeader ? 1 : 0;
    const creates: Record<string, unknown>[] = [];
    for (let i = startRow; i < matrix.length; i++) {
      const line = matrix[i] ?? [];
      if (line.every((c) => c.trim() === '')) continue;
      const bucket: Record<string, unknown> = props.newRowFactory ? props.newRowFactory() : {};
      line.forEach((raw, j) => {
        const col = cols[j];
        if (col) bucket[col.field] = parseColValue(col, raw, bucket);
      });
      creates.push(bucket);
    }
    if (creates.length) emit('paste', { updates: [], creates });
  };
  reader.readAsText(file, 'utf-8');
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------
const selectedIds = ref<Set<string>>(new Set());
let lastClickedIdx: number | null = null;

const isSelected = (id: string) => selectedIds.value.has(id);
const allSelected = computed(
  () => displayRows.value.length > 0 && displayRows.value.every((r) => isSelected(idOf(r))),
);
const someSelected = computed(() => selectedIds.value.size > 0);

function onSelectClick(ri: number, ev: MouseEvent) {
  const next = new Set(selectedIds.value);
  const clicked = displayRows.value[ri];
  if (!clicked) return;
  const id = idOf(clicked);
  if (ev.shiftKey && lastClickedIdx != null) {
    const [lo, hi] = [Math.min(lastClickedIdx, ri), Math.max(lastClickedIdx, ri)];
    for (let i = lo; i <= hi; i++) {
      const r = displayRows.value[i];
      if (r) next.add(idOf(r));
    }
  } else {
    if (next.has(id)) next.delete(id);
    else next.add(id);
    lastClickedIdx = ri;
  }
  selectedIds.value = next;
}

function toggleAll() {
  if (allSelected.value) selectedIds.value = new Set();
  else selectedIds.value = new Set(displayRows.value.map(idOf));
}
function clearSelection() {
  selectedIds.value = new Set();
  lastClickedIdx = null;
}
function deleteSelected() {
  if (!selectedIds.value.size) return;
  emit('delete-rows', [...selectedIds.value]);
  clearSelection();
}

// Drop selections that point at rows no longer present (after a refetch).
watch(displayRows, (rows) => {
  if (!selectedIds.value.size) return;
  const present = new Set(rows.map(idOf));
  const next = new Set([...selectedIds.value].filter((id) => present.has(id)));
  if (next.size !== selectedIds.value.size) selectedIds.value = next;
});

// ---------------------------------------------------------------------------
// Column width / pinning
// ---------------------------------------------------------------------------
const colWidths = reactive<Record<string, number>>({});
const DEFAULT_W = 150;
const CHECK_W = 44;

const widthPx = (col: GridColumn) => colWidths[col.field] ?? col.width ?? DEFAULT_W;
const colWidthStyle = (col: GridColumn) => `${widthPx(col)}px`;

function pinnedOffset(colIndex: number): number {
  let offset = props.selectable ? CHECK_W : 0;
  for (let i = 0; i < colIndex; i++) {
    const c = props.columns[i];
    if (c?.pinned) offset += widthPx(c);
  }
  return offset;
}
function pinStyle(colIndex: number) {
  return colIndex < 0
    ? { insetInlineStart: '0px' }
    : { insetInlineStart: `${pinnedOffset(colIndex)}px` };
}

const isRtl = () => typeof document !== 'undefined' && document.dir === 'rtl';
let resizing: { field: string; startX: number; startW: number } | null = null;
function startResize(col: GridColumn, ev: MouseEvent) {
  resizing = { field: col.field, startX: ev.clientX, startW: widthPx(col) };
  window.addEventListener('mousemove', onResizeMove);
  window.addEventListener('mouseup', stopResize);
}
function onResizeMove(ev: MouseEvent) {
  if (!resizing) return;
  const dx = (ev.clientX - resizing.startX) * (isRtl() ? -1 : 1);
  colWidths[resizing.field] = Math.max(60, resizing.startW + dx);
}
function stopResize() {
  resizing = null;
  window.removeEventListener('mousemove', onResizeMove);
  window.removeEventListener('mouseup', stopResize);
}

function cellClasses(col: GridColumn, row: GridRow) {
  return {
    'cp-pin': col.pinned,
    'cp-active': isActiveCell(idOf(row), col.field),
    'cp-error': cellErrorMsg(idOf(row), col.field) != null,
    'cp-editable': isCellEditable(col, row),
    [`text-${col.align ?? 'start'}`]: true,
  };
}

// ---------------------------------------------------------------------------
// Right-click context menu
// ---------------------------------------------------------------------------
const rowMenu = reactive<{ open: boolean; x: number; y: number; items: GridRowAction[] }>({
  open: false,
  x: 0,
  y: 0,
  items: [],
});

async function copyRow(row: GridRow) {
  const tsv = stringifyTsv([props.columns.map((c) => displayValue(c, row))]);
  try {
    await navigator.clipboard.writeText(tsv);
  } catch {
    /* clipboard blocked — silently ignore */
  }
}

function onRowContextMenu(row: GridRow, ev: MouseEvent) {
  if (isNewRow(row)) return; // entry row has no context actions
  ev.preventDefault();
  const builtIn: GridRowAction = {
    label: t('datagrid.copyRow'),
    icon: 'mdi-content-copy',
    perform: () => void copyRow(row),
  };
  rowMenu.items = [builtIn, ...(props.rowActions ? props.rowActions(row) : [])];
  rowMenu.x = ev.clientX;
  rowMenu.y = ev.clientY;
  rowMenu.open = true;
}

function runRowAction(a: GridRowAction) {
  rowMenu.open = false;
  a.perform();
}
</script>

<template>
  <div class="cp-grid">
    <div v-if="enableCsv || (selectable && someSelected)" class="cp-grid-bar">
      <template v-if="enableCsv">
        <v-btn
          size="small"
          variant="tonal"
          prepend-icon="mdi-file-export-outline"
          @click="exportCsv"
        >
          {{ t('datagrid.exportCsv') }}
        </v-btn>
        <v-btn
          v-if="showNewRow"
          size="small"
          variant="tonal"
          prepend-icon="mdi-file-import-outline"
          @click="triggerImport"
        >
          {{ t('datagrid.importCsv') }}
        </v-btn>
        <input
          ref="fileInput"
          type="file"
          accept=".csv,text/csv"
          class="cp-hidden-file"
          @change="onImportFile"
        />
      </template>
      <v-spacer />
      <template v-if="selectable && someSelected">
        <span class="text-body-2">{{ selectedIds.size }} {{ t('datagrid.selected') }}</span>
        <v-btn
          size="small"
          color="error"
          variant="tonal"
          prepend-icon="mdi-delete"
          @click="deleteSelected"
        >
          {{ t('datagrid.deleteSelected') }}
        </v-btn>
        <v-btn size="small" variant="text" @click="clearSelection">
          {{ t('common.cancel') }}
        </v-btn>
      </template>
    </div>

    <div
      ref="gridEl"
      class="cp-grid-scroll"
      :style="{ maxHeight: height }"
      tabindex="0"
      @scroll.passive="onGridScroll"
      @keydown="onContainerKeydown"
      @copy="onCopy"
      @paste="onPaste"
    >
      <table class="cp-grid-table">
        <colgroup>
          <col v-if="selectable" :style="{ width: `${CHECK_W}px` }" />
          <col
            v-for="col in columns"
            :key="col.field"
            :style="{ width: colWidthStyle(col), minWidth: `${col.minWidth ?? 60}px` }"
          />
        </colgroup>

        <thead ref="theadEl">
          <tr>
            <th
              v-if="selectable"
              class="cp-th cp-pin cp-check"
              :style="pinStyle(-1)"
              @click="toggleAll"
            >
              <v-checkbox-btn
                :model-value="allSelected"
                :indeterminate="someSelected && !allSelected"
                density="compact"
                tabindex="-1"
                class="cp-cb"
              />
            </th>
            <th
              v-for="(col, ci) in columns"
              :key="col.field"
              class="cp-th"
              :class="[
                { 'cp-pin': col.pinned, 'cp-sortable': col.sortable !== false },
                `text-${col.align ?? 'start'}`,
              ]"
              :style="col.pinned ? pinStyle(ci) : undefined"
              @click="toggleSort(col.field)"
            >
              <span class="cp-th-label">{{ col.title }}</span>
              <v-icon v-if="sortState?.field === col.field" size="14" class="cp-sort-ic">
                {{ sortState.dir === 'asc' ? 'mdi-menu-up' : 'mdi-menu-down' }}
              </v-icon>
              <span
                class="cp-resize"
                @mousedown.stop.prevent="startResize(col, $event)"
                @click.stop
              />
            </th>
          </tr>
          <tr class="cp-filter-row">
            <th v-if="selectable" class="cp-th cp-pin cp-check" :style="pinStyle(-1)" />
            <th
              v-for="(col, ci) in columns"
              :key="col.field"
              class="cp-th cp-filter-th"
              :class="{ 'cp-pin': col.pinned }"
              :style="col.pinned ? pinStyle(ci) : undefined"
            >
              <input
                v-if="col.filterable !== false"
                v-model="filters[col.field]"
                class="cp-filter-input"
                :placeholder="t('datagrid.filter')"
              />
            </th>
          </tr>
        </thead>

        <tbody>
          <tr v-if="padTop > 0" class="cp-spacer-row" aria-hidden="true">
            <td :colspan="colSpan" class="cp-spacer" :style="{ height: `${padTop}px` }" />
          </tr>
          <tr
            v-for="(row, wi) in windowRows"
            :key="idOf(row)"
            class="cp-tr"
            :class="[
              isNewRow(row) ? 'cp-newrow' : rowClass?.(row),
              { 'cp-tr-sel': !isNewRow(row) && isSelected(idOf(row)) },
            ]"
          >
            <td
              v-if="selectable"
              class="cp-td cp-pin cp-check"
              :style="pinStyle(-1)"
              @click="!isNewRow(row) && onSelectClick(vStart + wi, $event)"
            >
              <v-icon v-if="isNewRow(row)" size="16" class="text-medium-emphasis">
                mdi-plus
              </v-icon>
              <v-checkbox-btn
                v-else
                :model-value="isSelected(idOf(row))"
                density="compact"
                tabindex="-1"
                class="cp-cb"
              />
            </td>

            <td
              v-for="col in columns"
              :key="col.field"
              class="cp-td"
              :class="cellClasses(col, row)"
              :style="col.pinned ? pinStyle(columns.indexOf(col)) : undefined"
              :title="cellErrorMsg(idOf(row), col.field) ?? undefined"
              :data-field="col.field"
              :data-row="idOf(row)"
              @mousedown="onCellMouseDown(idOf(row), col.field)"
              @dblclick="onCellDblClick(idOf(row), col.field)"
              @contextmenu="onRowContextMenu(row, $event)"
            >
              <!-- Editor (only the single active+editing cell renders one) -->
              <template v-if="isEditingCell(idOf(row), col.field)">
                <v-select
                  v-if="col.type === 'select'"
                  :ref="(el: any) => (editorRef = el)"
                  :model-value="editValue"
                  :items="col.options"
                  item-title="title"
                  item-value="value"
                  density="compact"
                  variant="plain"
                  hide-details
                  class="cp-editor"
                  @update:model-value="onSelectPick"
                  @keydown.esc.prevent.stop="onEditorEsc"
                  @keydown.tab.prevent.stop="onEditorTab"
                  @blur="onEditorBlur"
                />
                <v-text-field
                  v-else
                  :ref="(el: any) => (editorRef = el)"
                  v-model="editValue"
                  :type="
                    col.type === 'number' || col.type === 'money'
                      ? 'number'
                      : col.type === 'date'
                        ? 'date'
                        : 'text'
                  "
                  :step="col.step"
                  :min="col.min"
                  density="compact"
                  variant="plain"
                  hide-details
                  class="cp-editor"
                  @keydown.enter.prevent.stop="onEditorEnter"
                  @keydown.tab.prevent.stop="onEditorTab"
                  @keydown.esc.prevent.stop="onEditorEsc"
                  @blur="onEditorBlur"
                />
              </template>
              <template v-else>
                <span v-if="isNewRow(row) && displayValue(col, row) === ''" class="cp-ph">{{
                  col.type ? col.title : ''
                }}</span>
                <span v-else class="cp-val">{{ displayValue(col, row) }}</span>
              </template>
            </td>
          </tr>
          <tr v-if="padBottom > 0" class="cp-spacer-row" aria-hidden="true">
            <td :colspan="colSpan" class="cp-spacer" :style="{ height: `${padBottom}px` }" />
          </tr>
        </tbody>
      </table>

      <div v-if="loading" class="cp-grid-loading">
        <v-progress-circular indeterminate size="28" />
      </div>
    </div>

    <!-- Right-click row menu, positioned at the cursor. -->
    <v-menu v-model="rowMenu.open" :target="[rowMenu.x, rowMenu.y]" location="end">
      <v-list density="compact" min-width="184">
        <v-list-item
          v-for="(a, i) in rowMenu.items"
          :key="i"
          :title="a.label"
          :class="{ 'text-error': a.danger }"
          @click="runRowAction(a)"
        >
          <template v-if="a.icon" #prepend>
            <v-icon size="18" :color="a.danger ? 'error' : undefined">{{ a.icon }}</v-icon>
          </template>
        </v-list-item>
      </v-list>
    </v-menu>
  </div>
</template>

<style scoped>
.cp-grid {
  position: relative;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: var(--cp-radius-md);
  overflow: hidden;
}
.cp-grid-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: var(--cp-surface-2);
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.cp-grid-scroll {
  overflow: auto;
  outline: none;
}
.cp-grid-table {
  border-collapse: separate;
  border-spacing: 0;
  width: 100%;
  font-size: 0.8125rem;
  background: rgb(var(--v-theme-surface));
}
.cp-th,
.cp-td {
  border-inline-end: 1px solid rgba(var(--v-border-color), 0.5);
  border-bottom: 1px solid rgba(var(--v-border-color), 0.5);
  padding: 0 7px;
  height: 30px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cp-th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: rgb(var(--v-theme-surface));
  font-weight: 600;
  user-select: none;
  text-align: start;
}
.cp-sortable {
  cursor: pointer;
}
.cp-th-label {
  vertical-align: middle;
}
.cp-sort-ic {
  vertical-align: middle;
}
/* Filter row sits below the header row; offset so it also stays pinned. */
.cp-filter-row .cp-th {
  top: 30px;
  z-index: 2;
  height: 26px;
  font-weight: 400;
}
.cp-filter-input {
  width: 100%;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: var(--cp-radius-sm);
  padding: 1px 6px;
  font-size: 0.8rem;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  outline: none;
}
.cp-pin {
  position: sticky;
  z-index: 3;
  background: rgb(var(--v-theme-surface));
}
.cp-th.cp-pin {
  z-index: 4;
}
.cp-check {
  text-align: center;
  padding: 0;
}
.cp-cb {
  display: inline-flex;
  justify-content: center;
}
.cp-tr:hover .cp-td {
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.cp-tr-sel .cp-td {
  background: rgba(var(--v-theme-primary), 0.1);
}
.cp-newrow .cp-td {
  background: rgba(var(--v-theme-accent), 0.06);
}
/* Reusable status row colours (pass via the rowClass prop). */
.cp-row-success .cp-td {
  background: rgba(var(--v-theme-success), 0.1);
}
.cp-row-error .cp-td {
  background: rgba(var(--v-theme-error), 0.1);
}
.cp-row-warning .cp-td {
  background: rgba(var(--v-theme-warning), 0.12);
}
.cp-row-muted {
  opacity: 0.6;
}
.cp-hidden-file {
  display: none;
}
.cp-editable {
  cursor: cell;
}
.cp-active {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
}
.cp-error {
  background: rgba(var(--v-theme-error), 0.12) !important;
  outline: 2px solid rgb(var(--v-theme-error));
  outline-offset: -2px;
}
.cp-ph {
  color: rgba(var(--v-theme-on-surface), 0.38);
}
.cp-resize {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 0;
  width: 6px;
  cursor: col-resize;
}
.cp-grid-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--v-theme-surface), 0.6);
}
/* Tighten the Vuetify editors so they sit flush inside a 30px cell. */
.cp-editor :deep(.v-field__input) {
  padding: 0;
  min-height: 28px;
  font-size: 0.8125rem;
}
.cp-editor :deep(.v-field) {
  padding-inline: 4px;
}
/* Virtualization spacers: invisible fillers that hold the scroll height for the
   rows not currently painted. No border/padding so they never show as a line. */
.cp-spacer-row,
.cp-spacer {
  padding: 0;
  border: 0;
  background: transparent;
}
</style>
