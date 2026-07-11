<script setup lang="ts">
// The classic menu row: ملف / تحرير / عرض / أدوات / تقارير / مساعدة.
//
// Two rules keep it honest. Every entry does something real - there are no
// greyed-out placeholders for features we don't have - and every shortcut hint
// names a key that is actually bound (see AppLayout's key handlers). Entries the
// signed-in role cannot use are removed, not disabled, so the menu never teaches
// a permission the user doesn't have.
//
// Behaviour is the Windows one: click to open, then *hovering* another top-level
// item switches to it without a second click.
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { t } from '@/i18n';
import { useUiStore } from '@/stores/ui.store';
import { useAuthStore } from '@/stores/auth.store';
import { useAccess, type AccessSpec } from '@/composables/useAccess';
import { RoleName } from '@/types/enums';

const router = useRouter();
const ui = useUiStore();
const auth = useAuthStore();
const { canAccess } = useAccess();

const OA: RoleName[] = [RoleName.OWNER, RoleName.ADMIN];
const FINANCE: RoleName[] = [...OA, RoleName.ACCOUNTANT];
const FINANCE_ENG: RoleName[] = [...FINANCE, RoleName.ENGINEER];

// Reports are finance-scoped, exactly as the sidebar gates them.
const REPORTS = { permissions: ['reports.read'], roles: FINANCE_ENG };

interface MenuEntry {
  id: string;
  label: string;
  shortcut?: string;
  access?: AccessSpec;
  run: () => void;
}
/** Entries are grouped; each group is drawn between 1px separators. */
type MenuGroup = MenuEntry[];
interface TopMenu {
  id: string;
  label: string;
  groups: MenuGroup[];
}

function go(to: string) {
  return () => void router.push(to);
}

async function logout() {
  await auth.logout();
  void router.push({ name: 'login' });
}

const MENUS = computed<TopMenu[]>(() => [
  {
    id: 'file',
    label: t('menu.file.title'),
    groups: [
      [
        { id: 'new-project', label: t('menu.file.newProject'), access: { permissions: ['projects.create'], roles: [...OA, RoleName.ENGINEER] }, run: go('/projects/new') },
        { id: 'new-contract', label: t('menu.file.newContract'), access: { permissions: ['contracts.create'], roles: FINANCE }, run: go('/contracts/new') },
        { id: 'new-customer', label: t('menu.file.newCustomer'), access: { permissions: ['customers.create'], roles: FINANCE }, run: go('/customers/new') },
        { id: 'new-cost', label: t('menu.file.newCost'), access: { permissions: ['costs.create'], roles: FINANCE_ENG }, run: go('/costs/new') },
        { id: 'new-payment', label: t('menu.file.newPayment'), access: { permissions: ['payments.create'], roles: FINANCE }, run: go('/payments/new') },
      ],
      [{ id: 'logout', label: t('common.logout'), run: () => void logout() }],
    ],
  },
  {
    id: 'edit',
    label: t('menu.edit.title'),
    groups: [
      [{ id: 'find', label: t('menu.edit.find'), shortcut: 'Ctrl+K', run: () => ui.openPalette() }],
      [
        { id: 'settings', label: t('nav.settings'), access: { permissions: ['settings.read'], roles: OA }, run: go('/settings') },
        { id: 'profile', label: t('profile.title'), run: go('/profile') },
      ],
    ],
  },
  {
    id: 'view',
    label: t('menu.view.title'),
    groups: [
      [
        { id: 'sidebar', label: t('menu.view.sidebar'), shortcut: 'Ctrl+B', run: () => ui.toggleSidebar() },
        { id: 'details', label: t('menu.view.detailsPane'), shortcut: 'F4', run: () => ui.toggleDetails() },
      ],
      [{ id: 'refresh', label: t('menu.view.refresh'), shortcut: 'F5', run: () => location.reload() }],
    ],
  },
  {
    id: 'tools',
    label: t('menu.tools.title'),
    groups: [
      [
        { id: 'users', label: t('nav.users'), access: { permissions: ['users.read'], roles: OA }, run: go('/users') },
        { id: 'rbac', label: t('nav.rbac'), access: { permissions: ['rbac.manage'], roles: [RoleName.OWNER] }, run: go('/rbac') },
        { id: 'audit', label: t('nav.audit'), access: { permissions: ['audit.read'], roles: OA }, run: go('/audit') },
      ],
      [{ id: 'tunnel', label: t('nav.tunnel'), access: { permissions: ['tunnel.manage'], roles: OA }, run: go('/tunnel') }],
    ],
  },
  {
    id: 'reports',
    label: t('menu.reports.title'),
    groups: [
      [{ id: 'reports', label: t('menu.reports.overview'), access: REPORTS, run: go('/reports') }],
      [
        { id: 'profitability', label: t('menu.reports.profitability'), access: REPORTS, run: go('/reports/project-profitability') },
        { id: 'cashflow', label: t('menu.reports.cashFlow'), access: REPORTS, run: go('/reports/cash-flow') },
        { id: 'overdue', label: t('menu.reports.overdue'), access: REPORTS, run: go('/reports/overdue-payments') },
      ],
    ],
  },
  {
    id: 'help',
    label: t('menu.help.title'),
    groups: [
      [{ id: 'shortcuts', label: t('shortcuts.title'), shortcut: '?', run: () => ui.toggleHelp() }],
      [{ id: 'about', label: t('menu.help.about'), run: () => ui.toggleAbout() }],
    ],
  },
]);

/** Drop entries the role can't use, then drop groups that emptied out. */
const menus = computed(() =>
  MENUS.value
    .map((m) => ({
      ...m,
      groups: m.groups
        .map((g) => g.filter((e) => !e.access || canAccess(e.access)))
        .filter((g) => g.length > 0),
    }))
    .filter((m) => m.groups.length > 0),
);

// Which top-level menu is open. Hovering a sibling while one is open switches to
// it - the behaviour every Windows menu bar has.
const openId = ref<string | null>(null);

function setOpen(id: string, value: boolean) {
  if (value) openId.value = id;
  else if (openId.value === id) openId.value = null;
}
function onHover(id: string) {
  if (openId.value !== null) openId.value = id;
}
function invoke(entry: MenuEntry) {
  openId.value = null;
  entry.run();
}
</script>

<template>
  <div class="cp-menubar" role="menubar">
    <v-menu
      v-for="m in menus"
      :key="m.id"
      :model-value="openId === m.id"
      location="bottom start"
      offset="0"
      :open-on-hover="false"
      @update:model-value="(v: boolean) => setOpen(m.id, v)"
    >
      <template #activator="{ props }">
        <button
          v-bind="props"
          type="button"
          class="cp-menubar__top"
          :class="{ 'cp-menubar__top--open': openId === m.id }"
          role="menuitem"
          :aria-expanded="openId === m.id"
          @mouseenter="onHover(m.id)"
        >
          {{ m.label }}
        </button>
      </template>

      <div class="cp-menu">
        <template v-for="(group, gi) in m.groups" :key="gi">
          <div v-if="gi > 0" class="cp-menu__sep" role="separator" />
          <button
            v-for="entry in group"
            :key="entry.id"
            type="button"
            class="cp-menu__item"
            role="menuitem"
            @click="invoke(entry)"
          >
            <span class="cp-menu__label">{{ entry.label }}</span>
            <kbd v-if="entry.shortcut" class="cp-menu__kbd">{{ entry.shortcut }}</kbd>
          </button>
        </template>
      </div>
    </v-menu>
  </div>
</template>

<style scoped>
.cp-menubar {
  display: flex;
  align-items: stretch;
  height: var(--cp-menubar-h);
  flex: none;
  background: var(--cp-surface);
  border-block-end: 1px solid var(--cp-border);
  padding-inline-start: 4px;
  user-select: none;
}

.cp-menubar__top {
  padding: 0 10px;
  font-size: 0.78rem;
  line-height: 1;
  color: var(--cp-text);
  background: transparent;
  border: 0;
  cursor: default;
}
.cp-menubar__top:hover,
.cp-menubar__top--open {
  background: var(--cp-primary-soft);
  color: var(--cp-primary);
}
.cp-menubar__top:focus-visible {
  outline: 2px solid var(--cp-primary);
  outline-offset: -2px;
}

/* The dropped panel. A menu genuinely floats, so it is one of the few places the
   system allows a shadow. */
.cp-menu {
  min-width: 208px;
  padding: 3px 0;
  background: var(--cp-surface);
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-sm);
  box-shadow: var(--cp-shadow-lg);
}
.cp-menu__sep {
  height: 1px;
  margin: 3px 0;
  background: var(--cp-border);
}
.cp-menu__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  width: 100%;
  height: 26px;
  padding: 0 12px;
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
.cp-menu__label {
  white-space: nowrap;
}
/* Shortcut hints read as data, not as chrome: muted, tabular, never boxed. */
.cp-menu__kbd {
  font-family: inherit;
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
  color: var(--cp-text-muted);
  background: none;
  border: 0;
  white-space: nowrap;
}
.cp-menu__item:hover .cp-menu__kbd {
  color: inherit;
}
</style>
