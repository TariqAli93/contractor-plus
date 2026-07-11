import type { GridColumn, GridRow } from '@/components/shared/datagrid/types';
import { numOrNull } from '@/lib/number';

export interface ContractItemColumnsCtx {
  t: (key: string) => string;
  money: (value: number | string | null | undefined) => string;
}

/** Read-only column model for contract line-items. The backend has no per-item
 *  CRUD (items come from the template / estimate), so these columns carry no
 *  `type` - the grid renders them display-only but still sorts, filters,
 *  copies, and exports them. */
export function buildContractItemColumns({ t, money }: ContractItemColumnsCtx): GridColumn[] {
  return [
    {
      field: 'material',
      title: t('contracts.items.fields.material'),
      minWidth: 220,
      format: (_v, row) => {
        const m = row.material as { name?: string } | null;
        return m?.name ?? '';
      },
    },
    { field: 'unit', title: t('contracts.items.fields.unit'), width: 100 },
    {
      field: 'quantity',
      title: t('contracts.items.fields.quantity'),
      align: 'end',
      width: 130,
      format: (v) => {
        const n = numOrNull(v);
        return n == null ? '' : String(n);
      },
    },
    {
      field: 'estimatedPrice',
      title: t('contracts.items.fields.estimatedPrice'),
      align: 'end',
      width: 160,
      format: (v) => {
        const n = numOrNull(v);
        return n == null ? '' : money(n);
      },
    },
    { field: 'notes', title: t('contracts.items.fields.notes'), minWidth: 160 },
  ];
}
