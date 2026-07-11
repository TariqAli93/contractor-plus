<script setup lang="ts">
import { computed } from 'vue';
import { t, te } from '@/i18n';
import { useUiStore } from '@/stores/ui.store';
import { useAccess, type AccessSpec } from '@/composables/useAccess';
import { RoleName } from '@/types/enums';
import CompanyLogo from '@/components/shared/CompanyLogo.vue';

interface NavItem {
  to: string;
  i18nKey: string;
  icon: string;
  // Hybrid gate: permission-first with legacy role fallback.
  access: AccessSpec;
}

interface NavGroup {
  // i18n key for the group label; omit for an ungrouped block (e.g. dashboard).
  labelKey?: string;
  items: NavItem[];
}

const ALL: RoleName[] = [
  RoleName.OWNER,
  RoleName.ADMIN,
  RoleName.ACCOUNTANT,
  RoleName.ENGINEER,
  RoleName.VIEWER,
];

// Grouping is presentation-only - the route list and role gating are
// identical to the previous flat array. New translations land in
// `nav.groups.*`; missing keys fall back gracefully to a blank label.
const FINANCE_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT, RoleName.ENGINEER];
const OA: RoleName[] = [RoleName.OWNER, RoleName.ADMIN];

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { to: '/', i18nKey: 'nav.dashboard', icon: 'mdi-view-dashboard-outline', access: { permissions: ['dashboard.read'], roles: ALL } },
    ],
  },
  {
    labelKey: 'nav.groups.operations',
    items: [
      { to: '/projects', i18nKey: 'nav.projects', icon: 'mdi-office-building-outline', access: { permissions: ['projects.read'], roles: ALL } },
      { to: '/contracts', i18nKey: 'nav.contracts', icon: 'mdi-file-sign', access: { permissions: ['contracts.read'], roles: ALL } },
      { to: '/templates', i18nKey: 'nav.templates', icon: 'mdi-file-document-multiple-outline', access: { permissions: ['templates.read'], roles: ALL } },
    ],
  },
  {
    labelKey: 'nav.groups.directory',
    items: [
      { to: '/customers', i18nKey: 'nav.customers', icon: 'mdi-account-multiple-outline', access: { permissions: ['customers.read'], roles: ALL } },
      { to: '/materials', i18nKey: 'nav.materials', icon: 'mdi-cube-outline', access: { permissions: ['materials.read'], roles: ALL } },
    ],
  },
  {
    labelKey: 'nav.groups.finance',
    items: [
      { to: '/costs', i18nKey: 'nav.costs', icon: 'mdi-cash-minus', access: { permissions: ['costs.read'], roles: ALL } },
      { to: '/payments', i18nKey: 'nav.payments', icon: 'mdi-cash-plus', access: { permissions: ['payments.read'], roles: ALL } },
      { to: '/reports', i18nKey: 'nav.reports', icon: 'mdi-chart-box-outline', access: { permissions: ['reports.read'], roles: FINANCE_ROLES } },
    ],
  },
  {
    labelKey: 'nav.groups.system',
    items: [
      { to: '/users', i18nKey: 'nav.users', icon: 'mdi-account-cog-outline', access: { permissions: ['users.read'], roles: OA } },
      { to: '/rbac', i18nKey: 'nav.rbac', icon: 'mdi-shield-key-outline', access: { permissions: ['rbac.manage'], roles: [RoleName.OWNER] } },
      { to: '/audit', i18nKey: 'nav.audit', icon: 'mdi-history', access: { permissions: ['audit.read'], roles: OA } },
      { to: '/tunnel', i18nKey: 'nav.tunnel', icon: 'mdi-tunnel', access: { permissions: ['tunnel.manage'], roles: OA } },
      { to: '/settings', i18nKey: 'nav.settings', icon: 'mdi-cog-outline', access: { permissions: ['settings.read'], roles: OA } },
    ],
  },
];

const ui = useUiStore();
const { canAccess } = useAccess();

const visibleGroups = computed(() =>
  NAV_GROUPS.map((g) => ({
    labelKey: g.labelKey,
    items: g.items.filter((i) => canAccess(i.access)),
  })).filter((g) => g.items.length > 0),
);

function groupLabel(key?: string): string {
  if (!key) return '';
  return te(key) ? t(key) : '';
}
</script>

<template>
  <!-- A docked navigation pane, not a drawer. It never floats over the
       workspace and never overlays a scrim: it is a column of the window, the
       way an Explorer tree or an ERP module list is. -->
  <aside class="cp-sidenav" :class="{ 'cp-sidenav--rail': ui.sidebarCollapsed }">
    <div class="cp-brand">
      <CompanyLogo variant="sidebar" :label="t('app.name')" :icon-only="ui.sidebarCollapsed" />
    </div>

    <nav class="cp-nav">
      <template v-for="(group, idx) in visibleGroups" :key="idx">
        <div v-if="groupLabel(group.labelKey)" class="cp-nav-group-label">
          {{ groupLabel(group.labelKey) }}
        </div>
        <v-list density="compact" nav class="!pa-0">
          <v-list-item
            v-for="item in group.items"
            :key="item.to"
            :to="item.to"
            :prepend-icon="item.icon"
            :title="t(item.i18nKey)"
            :aria-label="ui.sidebarCollapsed ? t(item.i18nKey) : undefined"
          >
            <v-tooltip v-if="ui.sidebarCollapsed" activator="parent" location="end">
              {{ t(item.i18nKey) }}
            </v-tooltip>
          </v-list-item>
        </v-list>
      </template>
    </nav>
  </aside>
</template>

<style scoped>
.cp-sidenav {
  flex: none;
  width: 190px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--cp-surface);
  border-inline-end: 1px solid var(--cp-border);
  overflow: hidden;
}
.cp-sidenav--rail {
  width: 44px;
}

.cp-nav {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-block: 2px;
}

/* Rail: the labels go, the icons stay put. Tooltips carry the names. */
.cp-sidenav--rail :deep(.cp-nav-group-label),
.cp-sidenav--rail :deep(.v-list-item-title) {
  display: none;
}
.cp-sidenav--rail :deep(.v-list-item__prepend > .v-icon) {
  margin-inline-end: 0 !important;
}
.cp-sidenav--rail :deep(.v-list-item) {
  padding-inline: 0 !important;
  justify-content: center;
}
</style>
