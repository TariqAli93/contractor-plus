import { PaymentMethod, PaymentStatus } from '@/types/enums';
import type { GridColumn, GridRow, GridSelectOption } from '@/components/shared/datagrid/types';
import { numOrNull } from '@/lib/number';

/** Row colour by payment status (consumes the grid's reusable status classes). */
export function paymentRowClass(row: GridRow): string | undefined {
  switch (row.status) {
    case PaymentStatus.PAID:
      return 'cp-row-success';
    case PaymentStatus.LATE:
      return 'cp-row-error';
    case PaymentStatus.CANCELLED:
      return 'cp-row-muted';
    default:
      return undefined;
  }
}

export interface PaymentColumnsCtx {
  t: (key: string) => string;
  money: (value: number | string | null | undefined) => string;
}

/** Column model for the project-payments grid. `status` and `paymentDate` are
 *  display-only - they're driven by the mark-paid / cancel actions, not by a
 *  direct field update - so only dueDate / amount / method / reference edit. */
export function buildPaymentColumns({ t, money }: PaymentColumnsCtx): GridColumn[] {
  const methodOptions: GridSelectOption[] = [
    { value: PaymentMethod.CASH, title: t('payments.method.CASH') },
    { value: PaymentMethod.BANK_TRANSFER, title: t('payments.method.BANK_TRANSFER') },
    { value: PaymentMethod.CHECK, title: t('payments.method.CHECK') },
    { value: PaymentMethod.OTHER, title: t('payments.method.OTHER') },
  ];
  return [
    { field: 'dueDate', title: t('payments.fields.dueDate'), type: 'date', width: 150 },
    {
      field: 'amount',
      title: t('payments.fields.amount'),
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
      field: 'status',
      title: t('payments.fields.status'),
      width: 120,
      format: (v) => t('payments.status.' + String(v)),
    },
    {
      field: 'paymentDate',
      title: t('payments.fields.paymentDate'),
      width: 150,
      format: (v) => (v ? String(v).slice(0, 10) : '-'),
    },
    {
      field: 'method',
      title: t('payments.fields.method'),
      type: 'select',
      options: methodOptions,
      width: 150,
      format: (v) => (v ? t('payments.method.' + String(v)) : t('payments.method.unset')),
    },
    { field: 'reference', title: t('payments.fields.reference'), type: 'text', minWidth: 160 },
  ];
}
