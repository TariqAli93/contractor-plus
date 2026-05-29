export function buildMaterialColumns(t: (key: string) => string) {
  return [
    { key: 'name', title: t('materials.fields.name'), sortable: true },
    { key: 'unit', title: t('materials.fields.unit'), sortable: false, width: 100 },
    {
      key: 'defaultPrice',
      title: t('materials.fields.defaultPrice'),
      sortable: true,
      align: 'end' as const,
      width: 160,
    },
    { key: 'isActive', title: t('materials.fields.isActive'), sortable: false, width: 110 },
    {
      key: 'createdAt',
      title: t('materials.fields.createdAt'),
      sortable: true,
      width: 160,
    },
    {
      key: 'actions',
      title: '',
      sortable: false,
      align: 'end' as const,
      width: 120,
    },
  ];
}
