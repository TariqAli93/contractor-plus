// Vuetify v-data-table-server header config. Built lazily so titles are
// resolved via the active i18n locale at render time, not at module load.
export function buildCustomerColumns(t: (key: string) => string) {
  return [
    { key: 'name', title: t('customers.fields.name'), sortable: true },
    { key: 'phone', title: t('customers.fields.phone'), sortable: false },
    { key: 'email', title: t('customers.fields.email'), sortable: false },
    { key: 'createdAt', title: t('customers.fields.createdAt'), sortable: true, width: 160 },
    {
      key: 'actions',
      title: '',
      sortable: false,
      align: 'end' as const,
      width: 120,
    },
  ];
}
