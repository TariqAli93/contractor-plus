export function buildPaymentColumns(t: (key: string) => string) {
  return [
    { key: 'dueDate', title: t('payments.fields.dueDate'), sortable: true, width: 130 },
    { key: 'status', title: t('payments.fields.status'), sortable: false, width: 130 },
    { key: 'amount', title: t('payments.fields.amount'), sortable: true, align: 'end' as const, width: 140 },
    { key: 'paymentDate', title: t('payments.fields.paymentDate'), sortable: true, width: 130 },
    { key: 'method', title: t('payments.fields.method'), sortable: false, width: 140 },
    { key: 'reference', title: t('payments.fields.reference'), sortable: false },
    {
      key: 'actions',
      title: '',
      sortable: false,
      align: 'end' as const,
      width: 160,
    },
  ];
}
