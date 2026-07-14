<script setup lang="ts">
// The command bar: the strip of small, tightly-packed commands that sits under
// the menu row in every Windows business application. Commands are grouped by
// thin vertical rules like a native ribbon, not spaced out like a web toolbar.
//
// It replaces the old top bar wholesale. The pill-shaped "search" button, the
// roomy avatar chip and the large primary CTA all read as SaaS; here the search
// is a real field, the account is a compact menu, and the only accented control
// is the one that creates records.
import { computed, ref } from 'vue';
import { t } from '@/i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { useAccess } from '@/composables/useAccess';
import { RoleName } from '@/types/enums';
import TunnelStatusChip from './TunnelStatusChip.vue';
import NotificationsBell from './NotificationsBell.vue';

const auth = useAuthStore();
const ui = useUiStore();
const router = useRouter();
const { canAccess, hasPermission } = useAccess();

// The AI assistant button — shown to anyone who may use AI; the drawer itself
// handles the "feature disabled" state gracefully.
const canUseAi = computed(() => hasPermission('ai.use'));

async function handleLogout() {
  await auth.logout();
  void router.push({ name: 'login' });
}

const userInitial = computed(() => (auth.user?.fullName ?? '?').charAt(0).toUpperCase());

const OA: RoleName[] = [RoleName.OWNER, RoleName.ADMIN];
const WRITE_PROJECTS: RoleName[] = [...OA, RoleName.ENGINEER];
const WRITE_FINANCE: RoleName[] = [...OA, RoleName.ACCOUNTANT];
const COSTS_ROLES: RoleName[] = [...OA, RoleName.ACCOUNTANT, RoleName.ENGINEER];

interface CreateItem {
  key: string;
  icon: string;
  label: string;
  to: string;
  perm: string;
  roles: RoleName[];
}

const CREATE_ITEMS = computed<CreateItem[]>(() => [
  { key: 'project', icon: 'mdi-folder-plus-outline', label: t('palette.actions.newProject'), to: '/projects/new', perm: 'projects.create', roles: WRITE_PROJECTS },
  { key: 'contract', icon: 'mdi-file-plus-outline', label: t('palette.actions.newContract'), to: '/contracts/new', perm: 'contracts.create', roles: WRITE_FINANCE },
  { key: 'cost', icon: 'mdi-cash-minus', label: t('costs.new'), to: '/costs/new', perm: 'costs.create', roles: COSTS_ROLES },
  { key: 'payment', icon: 'mdi-cash-plus', label: t('payments.new'), to: '/payments/new', perm: 'payments.create', roles: WRITE_FINANCE },
  { key: 'customer', icon: 'mdi-account-plus-outline', label: t('palette.actions.newCustomer'), to: '/customers/new', perm: 'customers.create', roles: WRITE_FINANCE },
  { key: 'material', icon: 'mdi-plus-box-outline', label: t('palette.actions.newMaterial'), to: '/materials/new', perm: 'materials.create', roles: WRITE_FINANCE },
]);

const createItems = computed(() =>
  CREATE_ITEMS.value.filter((i) => canAccess({ permissions: [i.perm], roles: i.roles })),
);

const createOpen = ref(false);
const accountOpen = ref(false);

function create(to: string) {
  createOpen.value = false;
  void router.push(to);
}

// The field is a lens onto the command palette, not a second search engine -
// focusing it opens the palette, which is where search actually lives.
function openSearch() {
  ui.openPalette();
}
</script>

<template>
  <div class="cp-cmdbar">
    <!-- Group: navigation chrome -->
    <button
      type="button"
      class="cp-cmd cp-cmd--icon"
      :title="t('common.menu')"
      :aria-label="t('common.menu')"
      @click="ui.toggleSidebar()"
    >
      <v-icon icon="mdi-menu" size="16" />
    </button>

    <span class="cp-cmd-sep" />

    <!-- Group: create -->
    <v-menu v-if="createItems.length" v-model="createOpen" location="bottom start" offset="2">
      <template #activator="{ props }">
        <button v-bind="props" type="button" class="cp-cmd cp-cmd--accent">
          <v-icon icon="mdi-plus" size="15" />
          <span>{{ t('common.new') }}</span>
          <v-icon icon="mdi-menu-down" size="14" class="cp-cmd__caret" />
        </button>
      </template>
      <div class="cp-menu">
        <button
          v-for="item in createItems"
          :key="item.key"
          type="button"
          class="cp-menu__item"
          @click="create(item.to)"
        >
          <v-icon :icon="item.icon" size="15" class="cp-menu__icon" />
          <span class="cp-menu__label">{{ item.label }}</span>
        </button>
      </div>
    </v-menu>

    <span v-if="createItems.length" class="cp-cmd-sep" />

    <!-- Group: search. A real field, sized like a desktop search box. -->
    <div class="cp-cmd-search" @click="openSearch">
      <v-icon icon="mdi-magnify" size="15" class="cp-cmd-search__icon" />
      <input
        class="cp-cmd-search__input"
        type="text"
        readonly
        :placeholder="t('palette.openLabel')"
        :aria-label="t('palette.openLabel')"
        @focus="openSearch"
      />
      <kbd class="cp-cmd-search__kbd">Ctrl+K</kbd>
    </div>

    <span class="cp-cmd-spacer" />

    <!-- Group: status + account -->
    <button
      v-if="canUseAi"
      type="button"
      class="cp-cmd cp-cmd--icon"
      :title="t('chat.title')"
      :aria-label="t('chat.title')"
      @click="ui.toggleChat()"
    >
      <v-icon icon="mdi-robot-happy-outline" size="16" />
    </button>
    <TunnelStatusChip />
    <NotificationsBell />

    <span class="cp-cmd-sep" />

    <button
      type="button"
      class="cp-cmd cp-cmd--icon"
      :title="t('shortcuts.title')"
      :aria-label="t('shortcuts.title')"
      @click="ui.toggleHelp()"
    >
      <v-icon icon="mdi-help-circle-outline" size="16" />
    </button>
    <v-menu v-model="accountOpen" location="bottom end" offset="2">
      <template #activator="{ props }">
        <button v-bind="props" type="button" class="cp-cmd cp-cmd--account">
          <span class="cp-cmd__initial">{{ userInitial }}</span>
          <span class="cp-cmd__user">{{ auth.user?.fullName }}</span>
          <v-icon icon="mdi-menu-down" size="14" class="cp-cmd__caret" />
        </button>
      </template>
      <div class="cp-menu cp-menu--account">
        <div class="cp-account">
          <div class="cp-account__name">{{ auth.user?.fullName }}</div>
          <div class="cp-account__mail">{{ auth.user?.email }}</div>
        </div>
        <div class="cp-menu__sep" role="separator" />
        <button type="button" class="cp-menu__item" @click="accountOpen = false; router.push('/profile')">
          <v-icon icon="mdi-account-circle-outline" size="15" class="cp-menu__icon" />
          <span class="cp-menu__label">{{ t('profile.title') }}</span>
        </button>
        <button type="button" class="cp-menu__item" @click="handleLogout">
          <v-icon icon="mdi-logout" size="15" class="cp-menu__icon" />
          <span class="cp-menu__label">{{ t('common.logout') }}</span>
        </button>
      </div>
    </v-menu>
  </div>
</template>

<style scoped>
.cp-cmdbar {
  display: flex;
  align-items: center;
  gap: 1px;
  height: var(--cp-commandbar-h);
  flex: none;
  padding-inline: 4px;
  background: var(--cp-surface);
  border-block-end: 1px solid var(--cp-border);
  user-select: none;
}

.cp-cmd {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  min-width: 0;
  padding: 0 7px;
  font-size: 0.76rem;
  color: var(--cp-text);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--cp-radius-sm);
  cursor: default;
  white-space: nowrap;
}
.cp-cmd:hover {
  background: var(--cp-surface-2);
  border-color: var(--cp-border);
}
.cp-cmd:active {
  background: var(--cp-bg-soft);
}
.cp-cmd:focus-visible {
  outline: 2px solid var(--cp-primary);
  outline-offset: -2px;
}
.cp-cmd--icon {
  padding: 0 5px;
}
/* The single accented control on the bar: the one that makes records. */
.cp-cmd--accent {
  color: #FFFFFF;
  background: var(--cp-primary);
  border-color: var(--cp-primary);
  font-weight: 600;
}
.cp-cmd--accent:hover {
  background: var(--cp-primary-hover);
  border-color: var(--cp-primary-hover);
}
.cp-cmd__caret {
  opacity: 0.75;
  margin-inline-start: -2px;
}

.cp-cmd-sep {
  width: 1px;
  height: 16px;
  margin-inline: 4px;
  background: var(--cp-border);
  flex: none;
}
.cp-cmd-spacer {
  flex: 1;
}

/* Search box - a field, not a pill button. */
.cp-cmd-search {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 260px;
  height: 24px;
  padding-inline: 6px;
  background: var(--cp-surface-2);
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-sm);
}
.cp-cmd-search:focus-within {
  border-color: var(--cp-primary);
}
.cp-cmd-search__icon,
.cp-cmd-search__kbd {
  color: var(--cp-text-muted);
  flex: none;
}
.cp-cmd-search__input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  font: inherit;
  font-size: 0.76rem;
  color: var(--cp-text);
  cursor: text;
}
.cp-cmd-search__input::placeholder {
  color: var(--cp-text-muted);
  opacity: 1;
}
.cp-cmd-search__kbd {
  font-family: inherit;
  font-size: 0.68rem;
  font-variant-numeric: tabular-nums;
}
@media (max-width: 900px) {
  .cp-cmd-search {
    width: 150px;
  }
  .cp-cmd-search__kbd {
    display: none;
  }
}

/* Account button */
.cp-cmd--account {
  gap: 6px;
  max-width: 200px;
}
.cp-cmd__initial {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: var(--cp-radius-sm);
  background: var(--cp-primary);
  color: #FFFFFF;
  font-size: 0.66rem;
  font-weight: 600;
  flex: none;
}
.cp-cmd__user {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 1100px) {
  .cp-cmd__user {
    display: none;
  }
}

/* Dropped panels reuse the menu-bar vocabulary. */
.cp-menu {
  min-width: 200px;
  padding: 3px 0;
  background: var(--cp-surface);
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-sm);
  box-shadow: var(--cp-shadow-lg);
}
.cp-menu--account {
  min-width: 224px;
}
.cp-menu__sep {
  height: 1px;
  margin: 3px 0;
  background: var(--cp-border);
}
.cp-menu__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 26px;
  padding: 0 10px;
  font-size: 0.78rem;
  color: var(--cp-text);
  background: transparent;
  border: 0;
  cursor: default;
  text-align: start;
}
.cp-menu__item:hover {
  background: var(--cp-primary-soft);
  color: var(--cp-primary);
}
.cp-menu__item:focus-visible {
  outline: 2px solid var(--cp-primary);
  outline-offset: -2px;
}
.cp-menu__icon {
  flex: none;
  opacity: 0.85;
}
.cp-menu__label {
  white-space: nowrap;
}

.cp-account {
  padding: 6px 10px 7px;
}
.cp-account__name {
  font-size: 0.8rem;
  font-weight: 600;
}
.cp-account__mail {
  font-size: 0.72rem;
  color: var(--cp-text-muted);
}
</style>
