export function buildCostColumns(t: (key: string) => string) {
  return [
    { key: 'date', title: t('costs.fields.date'), sortable: true, width: 130 },
    { key: 'category', title: t('costs.fields.category'), sortable: false, width: 140 },
    { key: 'description', title: t('costs.fields.description'), sortable: false },
    { key: 'material', title: t('costs.fields.material'), sortable: false, width: 180 },
    {
      key: 'totalAmount',
      title: t('costs.fields.totalAmount'),
      sortable: true,
      align: 'end' as const,
      width: 140,
    },
    {
      key: 'actions',
      title: '',
      sortable: false,
      align: 'end' as const,
      width: 100,
    },
  ];
}
