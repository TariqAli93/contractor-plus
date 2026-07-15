import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { useInlineTableEditor } from '@/components/shared/table/useInlineTableEditor';

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  qty: number;
}
const rowA: Row = { id: '1', name: 'أ', qty: 2 };
const rowB: Row = { id: '2', name: 'ب', qty: 5 };

function make() {
  return useInlineTableEditor<Row>({
    newDraft: () => ({ name: '', qty: null }),
    toDraft: (r) => ({ name: r.name, qty: r.qty }),
  });
}

describe('useInlineTableEditor', () => {
  it('opens and cancels a create draft', () => {
    const ed = make();
    expect(ed.isCreating.value).toBe(false);
    ed.startCreate();
    expect(ed.isCreating.value).toBe(true);
    expect(ed.creatingDraft.value).toEqual({ name: '', qty: null });
    ed.cancelCreate();
    expect(ed.isCreating.value).toBe(false);
    expect(ed.creatingDraft.value).toBeNull();
  });

  it('enters edit with a draft copy and restores on cancel (no row mutation)', () => {
    const ed = make();
    ed.startEdit(rowA);
    expect(ed.isEditing(rowA)).toBe(true);
    ed.setEditValue('name', 'محرر');
    expect(ed.editValue('name')).toBe('محرر');
    // The source row is untouched - the draft is a separate copy.
    expect(rowA.name).toBe('أ');
    ed.cancelEdit();
    expect(ed.isEditing(rowA)).toBe(false);
    expect(ed.editingDraft.value).toBeNull();
  });

  it('prevents a second edit or a create while one row is open', () => {
    const ed = make();
    ed.startEdit(rowA);
    ed.startEdit(rowB); // ignored - busy
    expect(ed.editingId.value).toBe('1');
    ed.startCreate(); // ignored - busy
    expect(ed.isCreating.value).toBe(false);
  });

  it('runSave guards against duplicate submits and reports success', async () => {
    const ed = make();
    let calls = 0;
    const slow = () =>
      ed.runSave(async () => {
        calls++;
        await Promise.resolve();
      });
    const [a, b] = await Promise.all([slow(), slow()]);
    // The second overlapping call is rejected by the saving guard.
    expect(calls).toBe(1);
    expect([a, b].filter(Boolean).length).toBe(1);
    expect(ed.saving.value).toBe(false);
  });

  it('runSave keeps state (returns false) when the write throws', async () => {
    const ed = make();
    ed.startEdit(rowA);
    const ok = await ed.runSave(async () => {
      throw new Error('api');
    });
    expect(ok).toBe(false);
    // Still editing, draft intact - the page keeps the row open.
    expect(ed.isEditing(rowA)).toBe(true);
    expect(ed.saving.value).toBe(false);
  });

  it('setErrors exposes messages and clears a field when the user edits it', () => {
    const ed = make();
    ed.startEdit(rowA);
    ed.setErrors({ name: 'مطلوب' });
    expect(ed.errorFor('name')).toBe('مطلوب');
    ed.setEditValue('name', 'قيمة');
    expect(ed.errorFor('name')).toBeNull();
  });

  it('uses a custom rowKey when provided', () => {
    const ed = useInlineTableEditor<Row>({
      rowKey: (r) => r.name,
      newDraft: () => ({}),
      toDraft: () => ({}),
    });
    ed.startEdit(rowA);
    expect(ed.editingId.value).toBe('أ');
  });
});

// Guard against the removed spreadsheet surface ever coming back.
describe('DataGrid removal', () => {
  const fromFrontend = (rel: string) => resolve(process.cwd(), rel);
  it('ships no DataGrid component, types, or spreadsheet helpers', () => {
    for (const gone of [
      'src/components/shared/datagrid/DataGrid.vue',
      'src/components/shared/datagrid/types.ts',
      'src/lib/tsv.ts',
      'src/components/features/cost/costGridColumns.ts',
      'src/components/features/material/materialGridColumns.ts',
      'src/components/features/payment/paymentGridColumns.ts',
      'src/components/features/contract/contractItemColumns.ts',
    ]) {
      expect(existsSync(fromFrontend(gone)), `${gone} should be deleted`).toBe(false);
    }
  });
});
