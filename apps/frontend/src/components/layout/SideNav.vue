<script setup lang="ts">
import { computed } from 'vue';
import { t, te } from '@/i18n';
import { useUiStore } from '@/stores/ui.store';
import { useCan } from '@/composables/useCan';
import { RoleName } from '@/types/enums';
import CompanyLogo from '@/components/shared/CompanyLogo.vue';

interface NavItem {
  to: string;
  i18nKey: string;
  icon: string;
  roles: RoleName[];
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

// Grouping is presentation-only — the route list and role gating are
// identical to the previous flat array. New translations land in
// `nav.groups.*`; missing keys fall back gracefully to a blank label.
const NAV_GROUPS: NavGroup[] = [
  {
    items: [{ to: '/', i18nKey: 'nav.dashboard', icon: 'mdi-view-dashboard-outline', roles: ALL }],
  },
  {
    labelKey: 'nav.groups.operations',
    items: [
      { to: '/projects', i18nKey: 'nav.projects', icon: 'mdi-office-building-outline', roles: ALL },
      { to: '/contracts', i18nKey: 'nav.contracts', icon: 'mdi-file-sign', roles: ALL },
      { to: '/templates', i18nKey: 'nav.templates', icon: 'mdi-file-document-multiple-outline', roles: ALL },
    ],
  },
  {
    labelKey: 'nav.groups.directory',
    items: [
      { to: '/customers', i18nKey: 'nav.customers', icon: 'mdi-account-multiple-outline', roles: ALL },
      { to: '/materials', i18nKey: 'nav.materials', icon: 'mdi-cube-outline', roles: ALL },
    ],
  },
  {
    labelKey: 'nav.groups.finance',
    items: [
      { to: '/costs', i18nKey: 'nav.costs', icon: 'mdi-cash-minus', roles: ALL },
      { to: '/payments', i18nKey: 'nav.payments', icon: 'mdi-cash-plus', roles: ALL },
      {
        to: '/reports',
        i18nKey: 'nav.reports',
        icon: 'mdi-chart-box-outline',
        roles: [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT, RoleName.ENGINEER],
      },
    ],
  },
  {
    labelKey: 'nav.groups.system',
    items: [
      {
        to: '/audit',
        i18nKey: 'nav.audit',
        icon: 'mdi-history',
        roles: [RoleName.OWNER, RoleName.ADMIN],
      },
      {
        to: '/tunnel',
        i18nKey: 'nav.tunnel',
        icon: 'mdi-tunnel',
        roles: [RoleName.OWNER, RoleName.ADMIN],
      },
      {
        to: '/settings',
        i18nKey: 'nav.settings',
        icon: 'mdi-cog-outline',
        roles: [RoleName.OWNER, RoleName.ADMIN],
      },
    ],
  },
];

const ui = useUiStore();
const { can } = useCan();

const visibleGroups = computed(() =>
  NAV_GROUPS.map((g) => ({
    labelKey: g.labelKey,
    items: g.items.filter((i) => can(i.roles)),
  })).filter((g) => g.items.length > 0),
);

function groupLabel(key?: string): string {
  if (!key) return '';
  return te(key) ? t(key) : '';
}
</script>

<template>
  <v-navigation-drawer
    :rail="ui.sidebarCollapsed"
    permanent
    width="248"
    rail-width="72"
    color="surface"
  >
    <div class="cp-brand">
      <CompanyLogo
        variant="sidebar"
        :label="t('app.name')"
        :icon-only="ui.sidebarCollapsed"
      />
    </div>

    <v-divider />

    <div class="cp-nav py-1">
      <template v-for="(group, idx) in visibleGroups" :key="idx">
        <div v-if="groupLabel(group.labelKey)" class="cp-nav-group-label">
          {{ groupLabel(group.labelKey) }}
        </div>
        <v-list density="comfortable" nav class="!pa-0">
          <v-list-item
            v-for="item in group.items"
            :key="item.to"
            :to="item.to"
            :prepend-icon="item.icon"
            :title="t(item.i18nKey)"
          />
        </v-list>
      </template>
    </div>
  </v-navigation-drawer>
</template>
