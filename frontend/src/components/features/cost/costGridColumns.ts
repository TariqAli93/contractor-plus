import { CostCategory } from '@/types/enums';
import type { GridColumn, GridRow, GridSelectOption } from '@/components/shared/datagrid/types';
import { numOrNull } from '@/lib/number';

// Re-exported for the costs tab, which imports it from here.
export { numOrNull };

export interface CostColumnsCtx {
  t: (key: string) => string;
  money: (value: number | string | null | undefined) => string;
  categories: GridSelectOption[];
}

/** Column model for the project-costs grid. Money columns render via the
 *  currency formatter; `totalAmount` is computed from qty × unitPrice (so the
 *  user sees a live total) and is only typeable when one of those is blank. */
export function buildCostColumns({ t, money, categories }: CostColumnsCtx): GridColumn[] {
  return [
    {
      field: 'date',
      title: t('projects.costs.fields.date'),
      type: 'date',
      width: 140,
    },
    {
      field: 'category',
      title: t('projects.costs.fields.category'),
      type: 'select',
      options: categories,
      width: 130,
    },
    {
      field: 'description',
      title: t('projects.costs.fields.description'),
      type: 'text',
      minWidth: 220,
    },
    {
      field: 'quantity',
      title: t('projects.costs.fields.quantity'),
      type: 'number',
      align: 'end',
      width: 110,
      step: 0.001,
      min: 0,
    },
    {
      field: 'unitPrice',
      title: t('projects.costs.fields.unitPrice'),
      type: 'money',
      align: 'end',
      width: 130,
      step: 0.01,
      min: 0,
      format: (v) => {
        const n = numOrNull(v);
        return n == null ? '' : money(n);
      },
    },
    {
      field: 'totalAmount',
      title: t('projects.costs.fields.totalAmount'),
      type: 'money',
      align: 'end',
      width: 150,
      step: 0.01,
      min: 0,
      // Only editable when the backend can't derive it from qty × unitPrice.
      editable: (row: GridRow) =>
        numOrNull(row.quantity) == null || numOrNull(row.unitPrice) == null,
      format: (v, row) => {
        const q = numOrNull(row.quantity);
        const p = numOrNull(row.unitPrice);
        const val = q != null && p != null ? q * p : numOrNull(v);
        return val == null ? '' : money(val);
      },
    },
  ];
}
