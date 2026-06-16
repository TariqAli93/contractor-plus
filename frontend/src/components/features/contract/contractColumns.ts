export function buildContractColumns(t: (key: string) => string) {
  return [
    { key: 'contractNumber', title: t('contracts.fields.contractNumber'), sortable: true },
    { key: 'customer', title: t('contracts.fields.customer'), sortable: false },
    {
      key: 'totalPrice',
      title: t('contracts.fields.totalPrice'),
      sortable: true,
      align: 'end' as const,
      width: 160,
    },
    { key: 'status', title: t('contracts.fields.status'), sortable: false, width: 130 },
    {
      key: 'createdAt',
      title: t('contracts.fields.createdAt'),
      sortable: true,
      width: 160,
    },
    {
      key: 'actions',
      title: '',
      sortable: false,
      align: 'end' as const,
      width: 80,
    },
  ];
}
