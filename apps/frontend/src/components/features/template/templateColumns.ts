export function buildTemplateColumns(t: (key: string) => string) {
  return [
    { key: 'name', title: t('templates.fields.name'), sortable: true },
    {
      key: 'estimatedDurationDays',
      title: t('templates.fields.estimatedDurationDays'),
      sortable: false,
      align: 'end' as const,
      width: 140,
    },
    {
      key: 'suggestedProfitMargin',
      title: t('templates.fields.suggestedProfitMargin'),
      sortable: false,
      align: 'end' as const,
      width: 140,
    },
    { key: 'isActive', title: t('templates.fields.isActive'), sortable: false, width: 110 },
    {
      key: 'createdAt',
      title: t('templates.fields.createdAt'),
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
