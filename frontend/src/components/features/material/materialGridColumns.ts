import type { GridColumn, GridSelectOption } from '@/components/shared/datagrid/types';
import { numOrNull } from '@/lib/number';

export interface MaterialColumnsCtx {
  t: (key: string) => string;
  money: (value: number | string | null | undefined) => string;
}

/** Column model for the central materials grid — name/unit/price/active/notes,
 *  all inline-editable. `isActive` is a boolean select. */
export function buildMaterialColumns({ t, money }: MaterialColumnsCtx): GridColumn[] {
  const activeOptions: GridSelectOption[] = [
    { value: true, title: t('materials.status.active') },
    { value: false, title: t('materials.status.inactive') },
  ];
  return [
    { field: 'name', title: t('materials.fields.name'), type: 'text', minWidth: 220 },
    { field: 'unit', title: t('materials.fields.unit'), type: 'text', width: 120 },
    {
      field: 'defaultPrice',
      title: t('materials.fields.defaultPrice'),
      type: 'money',
      align: 'end',
      width: 150,
      step: 0.01,
      min: 0,
      format: (v) => {
        const n = numOrNull(v);
        return n == null ? '' : money(n);
      },
    },
    {
      field: 'isActive',
      title: t('materials.fields.isActive'),
      type: 'select',
      options: activeOptions,
      width: 120,
    },
    { field: 'notes', title: t('materials.fields.notes'), type: 'text', minWidth: 200 },
  ];
}
