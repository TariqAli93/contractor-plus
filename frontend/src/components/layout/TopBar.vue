<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@/i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { useThemeStore } from '@/stores/theme.store';
import { useAccess } from '@/composables/useAccess';
import { RoleName } from '@/types/enums';
import TunnelStatusChip from './TunnelStatusChip.vue';
import NotificationsBell from './NotificationsBell.vue';

const auth = useAuthStore();
const ui = useUiStore();
const theme = useThemeStore();
const router = useRouter();
const { canAccess } = useAccess();

async function handleLogout() {
  await auth.logout();
  router.push({ name: 'login' });
}

const userInitial = computed(() => (auth.user?.fullName ?? '?').charAt(0).toUpperCase());

// ---- Quick-create toolbar menu (permission-gated) ----
const OA: RoleName[] = [RoleName.OWNER, RoleName.ADMIN];
const WRITE_PROJECTS: RoleName[] = [...OA, RoleName.ENGINEER];
const WRITE_CONTRACTS: RoleName[] = [...OA, RoleName.ACCOUNTANT];
const WRITE_CUSTOMERS: RoleName[] = [...OA, RoleName.ACCOUNTANT];
const WRITE_MATERIALS: RoleName[] = [...OA, RoleName.ACCOUNTANT];
const COSTS_ROLES: RoleName[] = [...OA, RoleName.ACCOUNTANT, RoleName.ENGINEER];
const PAYMENTS_ROLES: RoleName[] = [...OA, RoleName.ACCOUNTANT];

interface CreateItem {
  key: string;
  icon: string;
  labelKey: string;
  to: string;
  perm: string;
  roles: RoleName[];
}

const CREATE_ITEMS: CreateItem[] = [
  { key: 'project', icon: 'mdi-folder-plus-outline', labelKey: 'palette.actions.newProject', to: '/projects/new', perm: 'projects.create', roles: WRITE_PROJECTS },
  { key: 'contract', icon: 'mdi-file-plus-outline', labelKey: 'palette.actions.newContract', to: '/contracts/new', perm: 'contracts.create', roles: WRITE_CONTRACTS },
  { key: 'cost', icon: 'mdi-cash-minus', labelKey: 'costs.new', to: '/costs/new', perm: 'costs.create', roles: COSTS_ROLES },
  { key: 'payment', icon: 'mdi-cash-plus', labelKey: 'payments.new', to: '/payments/new', perm: 'payments.create', roles: PAYMENTS_ROLES },
  { key: 'customer', icon: 'mdi-account-plus-outline', labelKey: 'palette.actions.newCustomer', to: '/customers/new', perm: 'customers.create', roles: WRITE_CUSTOMERS },
  { key: 'material', icon: 'mdi-plus-box-outline', labelKey: 'palette.actions.newMaterial', to: '/materials/new', perm: 'materials.create', roles: WRITE_MATERIALS },
];

const createItems = computed(() =>
  CREATE_ITEMS.filter((i) => canAccess({ permissions: [i.perm], roles: i.roles })),
);
</script>

<template>
  <v-app-bar flat color="surface" :height="42" class="cp-topbar" :elevation="0">
    <div class="cp-toolbar-group ms-1">
      <v-btn
        icon="mdi-menu"
        variant="text"
        size="small"
        :aria-label="t('common.menu')"
        @click="ui.toggleSidebar"
      />
    </div>

    <span class="cp-toolbar-sep" />

    <!-- Primary quick-create action -->
    <v-menu v-if="createItems.length" location="bottom start" offset="4">
      <template #activator="{ props }">
        <v-btn
          v-bind="props"
          color="primary"
          variant="flat"
          size="small"
          prepend-icon="mdi-plus"
          append-icon="mdi-menu-down"
          class="cp-new-btn"
        >
          {{ t('common.new') }}
        </v-btn>
      </template>
      <v-list min-width="200">
        <v-list-item
          v-for="item in createItems"
          :key="item.key"
          :prepend-icon="item.icon"
          :title="t(item.labelKey)"
          @click="router.push(item.to)"
        />
      </v-list>
    </v-menu>

    <span v-if="createItems.length" class="cp-toolbar-sep" />

    <!-- Command palette / global search -->
    <v-btn
      variant="text"
      size="small"
      prepend-icon="mdi-magnify"
      class="cp-search-btn"
      :aria-label="t('palette.openLabel')"
      @click="ui.openPalette()"
    >
      <span class="cp-search-label">{{ t('palette.openLabel') }}</span>
      <kbd class="cp-search-kbd">Ctrl K</kbd>
    </v-btn>

    <v-spacer />

    <TunnelStatusChip class="me-1" />
    <NotificationsBell />

    <v-btn
      icon="mdi-help-circle-outline"
      variant="text"
      size="small"
      :aria-label="t('shortcuts.title')"
      @click="ui.toggleHelp"
    />
    <v-btn
      :icon="theme.isDark ? 'mdi-weather-sunny' : 'mdi-weather-night'"
      variant="text"
      size="small"
      :aria-label="t('appearance.toggle')"
      @click="theme.toggleTheme"
    />

    <v-menu offset="8" location="bottom end">
      <template #activator="{ props }">
        <v-btn
          v-bind="props"
          variant="text"
          size="small"
          class="me-2 px-1"
          :aria-label="auth.user?.fullName ?? ''"
        >
          <v-avatar size="28" class="cp-avatar">
            <span class="text-xs font-semibold">{{ userInitial }}</span>
          </v-avatar>
        </v-btn>
      </template>
      <v-list min-width="240">
        <v-list-item class="py-2">
          <template #prepend>
            <v-avatar size="36" color="primary" class="me-3">
              <span class="text-sm font-semibold">{{ userInitial }}</span>
            </v-avatar>
          </template>
          <v-list-item-title class="font-medium">{{ auth.user?.fullName }}</v-list-item-title>
          <v-list-item-subtitle class="text-medium-emphasis">
            {{ auth.user?.email }}
          </v-list-item-subtitle>
        </v-list-item>
        <v-divider class="my-1" />
        <v-list-item
          prepend-icon="mdi-account-circle-outline"
          :title="t('profile.title')"
          to="/profile"
        />
        <v-list-item
          prepend-icon="mdi-logout"
          :title="t('common.logout')"
          @click="handleLogout"
        />
      </v-list>
    </v-menu>
  </v-app-bar>
</template>

<style scoped>
.cp-avatar {
  background: var(--cp-primary);
  color: #fff;
}
.cp-new-btn {
  text-transform: none;
  font-weight: 600;
}
.cp-search-btn {
  text-transform: none;
  font-weight: 400;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.cp-search-kbd {
  margin-inline-start: 8px;
  padding: 1px 5px;
  border-radius: var(--cp-radius-sm);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.2);
  background: rgba(var(--v-theme-on-surface), 0.06);
  font-size: 0.68rem;
}
@media (max-width: 720px) {
  .cp-search-label,
  .cp-search-kbd {
    display: none;
  }
}
</style>
