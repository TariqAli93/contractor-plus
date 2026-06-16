// Vuetify v-data-table-server headers for the users list. Built lazily so
// titles resolve via the active i18n locale at render time.
export function buildUserColumns(t: (key: string) => string) {
  return [
    { key: 'username', title: t('users.fields.username'), sortable: true },
    { key: 'fullName', title: t('users.fields.fullName'), sortable: true },
    { key: 'role', title: t('users.fields.role'), sortable: false },
    { key: 'isActive', title: t('users.fields.status'), sortable: false },
    { key: 'lastLoginAt', title: t('users.fields.lastLoginAt'), sortable: true, width: 160 },
    { key: 'actions', title: '', sortable: false, align: 'end' as const, width: 180 },
  ];
}
