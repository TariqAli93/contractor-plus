<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@/i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { useThemeStore } from '@/stores/theme.store';
import TunnelStatusChip from './TunnelStatusChip.vue';

const auth = useAuthStore();
const ui = useUiStore();
const theme = useThemeStore();
const router = useRouter();

async function handleLogout() {
  await auth.logout();
  router.push({ name: 'login' });
}

const userInitial = computed(() => (auth.user?.fullName ?? '?').charAt(0).toUpperCase());
</script>

<template>
  <v-app-bar flat color="surface" :height="64" class="cp-topbar">
    <v-btn
      icon
      variant="text"
      class="ms-1"
      :aria-label="t('common.language')"
      @click="ui.toggleSidebar"
    >
      <v-icon>{{ ui.sidebarCollapsed ? 'mdi-menu' : 'mdi-menu-open' }}</v-icon>
    </v-btn>

    <v-btn
      variant="tonal"
      class="ms-2 cp-search-btn"
      prepend-icon="mdi-magnify"
      :aria-label="t('palette.openLabel')"
      @click="ui.openPalette()"
    >
      <span class="cp-search-label">{{ t('palette.openLabel') }}</span>
      <kbd class="cp-search-kbd">Ctrl K</kbd>
    </v-btn>

    <v-spacer />

    <TunnelStatusChip class="me-2" />

    <v-btn
      icon
      variant="text"
      class="me-1"
      :aria-label="t('appearance.toggle')"
      @click="theme.toggleTheme"
    >
      <v-icon>{{ theme.isDark ? 'mdi-weather-sunny' : 'mdi-weather-night' }}</v-icon>
    </v-btn>

    <v-menu offset="10" location="bottom end">
      <template #activator="{ props }">
        <v-btn
          v-bind="props"
          variant="text"
          class="me-2 px-2"
          :aria-label="auth.user?.fullName ?? ''"
        >
          <v-avatar size="34" class="cp-avatar">
            <span class="text-sm font-semibold">{{ userInitial }}</span>
          </v-avatar>
        </v-btn>
      </template>
      <v-list density="comfortable" min-width="240" class="rounded-lg">
        <v-list-item class="py-3">
          <template #prepend>
            <v-avatar size="40" color="primary" class="me-3">
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
  background: linear-gradient(135deg, #1e5f8c 0%, #2a7ab5 100%);
  color: #fff;
  box-shadow: 0 4px 10px -3px rgba(30, 95, 140, 0.4);
}
.cp-search-btn {
  text-transform: none;
  font-weight: 400;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.cp-search-kbd {
  margin-inline-start: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.2);
  background: rgba(var(--v-theme-on-surface), 0.06);
  font-size: 0.7rem;
}
@media (max-width: 600px) {
  .cp-search-label,
  .cp-search-kbd {
    display: none;
  }
}
</style>
