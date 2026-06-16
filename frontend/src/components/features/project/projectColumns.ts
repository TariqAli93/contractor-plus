export function buildProjectColumns(t: (key: string) => string) {
  return [
    { key: 'name', title: t('projects.fields.name'), sortable: true },
    { key: 'customer', title: t('projects.fields.customer'), sortable: false },
    { key: 'status', title: t('projects.fields.status'), sortable: false, width: 140 },
    {
      key: 'progressPercentage',
      title: t('projects.fields.progress'),
      sortable: false,
      width: 200,
    },
    {
      key: 'deliveryDate',
      title: t('projects.fields.deliveryDate'),
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
