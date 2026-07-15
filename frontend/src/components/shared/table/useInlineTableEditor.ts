import { computed, nextTick, ref } from 'vue';

// Small state holder for inline table editing: one row edited (or one draft
// created) at a time, with explicit save. Deliberately NOT a generic grid
// engine - it owns only the editing/creating/saving state and the transitions.
// Each page supplies its own fields, validation, API calls, and rendering.

export type EditingId = string | number | null;

export interface InlineTableEditorOptions<T> {
  /** Row identity (defaults to `row.id`). */
  rowKey?: (row: T) => string | number;
  /** A fresh draft for the create row. */
  newDraft: () => Record<string, unknown>;
  /** Snapshot an existing row into an editable draft. */
  toDraft: (row: T) => Record<string, unknown>;
}

export function useInlineTableEditor<T>(options: InlineTableEditorOptions<T>) {
  const keyOf = options.rowKey ?? ((row: T) => (row as { id: string | number }).id);

  const editingId = ref<EditingId>(null);
  const editingDraft = ref<Record<string, unknown> | null>(null);
  const editingOriginal = ref<T | null>(null);
  const creatingDraft = ref<Record<string, unknown> | null>(null);
  const saving = ref(false);
  const errors = ref<Record<string, string>>({});

  const isCreating = computed(() => creatingDraft.value !== null);
  const isEditing = (row: T) => editingId.value !== null && editingId.value === keyOf(row);
  /** One thing at a time: block a second edit/create while one is open. */
  const busy = computed(() => isCreating.value || editingId.value !== null);

  function startCreate() {
    if (busy.value) return;
    creatingDraft.value = options.newDraft();
    errors.value = {};
  }
  function cancelCreate() {
    creatingDraft.value = null;
    errors.value = {};
  }

  function startEdit(row: T) {
    if (busy.value) return;
    editingOriginal.value = row;
    editingDraft.value = options.toDraft(row);
    editingId.value = keyOf(row);
    errors.value = {};
  }
  function cancelEdit() {
    editingId.value = null;
    editingDraft.value = null;
    editingOriginal.value = null;
    errors.value = {};
  }

  // Null-safe accessors so templates never touch a possibly-null draft.
  const createValue = (field: string) => creatingDraft.value?.[field] ?? null;
  const setCreateValue = (field: string, v: unknown) => {
    if (creatingDraft.value) {
      creatingDraft.value[field] = v;
      if (errors.value[field]) delete errors.value[field];
    }
  };
  const editValue = (field: string) => editingDraft.value?.[field] ?? null;
  const setEditValue = (field: string, v: unknown) => {
    if (editingDraft.value) {
      editingDraft.value[field] = v;
      if (errors.value[field]) delete errors.value[field];
    }
  };

  const errorFor = (field: string) => errors.value[field] ?? null;
  function setErrors(next: Record<string, string>) {
    errors.value = next;
    if (Object.keys(next).length) focusFirstError();
  }
  function focusFirstError() {
    const field = Object.keys(errors.value)[0];
    if (!field) return;
    void nextTick(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-field="${field}"] input, [data-field="${field}"] textarea`,
      );
      el?.focus();
    });
  }

  /** Run an async write with the saving-guard (blocks duplicate submits) and
   *  keep-on-error (the caller's fn should surface the API error and rethrow;
   *  this returns false so the page keeps the draft open). */
  async function runSave(fn: () => Promise<void>): Promise<boolean> {
    if (saving.value) return false;
    saving.value = true;
    try {
      await fn();
      return true;
    } catch {
      return false;
    } finally {
      saving.value = false;
    }
  }

  return {
    editingId,
    editingDraft,
    editingOriginal,
    creatingDraft,
    saving,
    errors,
    isCreating,
    isEditing,
    busy,
    startCreate,
    cancelCreate,
    startEdit,
    cancelEdit,
    createValue,
    setCreateValue,
    editValue,
    setEditValue,
    errorFor,
    setErrors,
    runSave,
  };
}
