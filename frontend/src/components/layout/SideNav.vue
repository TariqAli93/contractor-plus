<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
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
const FINANCE_ROLES: RoleName[] = [
  RoleName.OWNER,
  RoleName.ADMIN,
  RoleName.ACCOUNTANT,
  RoleName.ENGINEER,
];
const OA: RoleName[] = [RoleName.OWNER, RoleName.ADMIN];

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      {
        to: '/',
        i18nKey: 'nav.dashboard',
        icon: 'mdi-view-dashboard-outline',
        access: { permissions: ['dashboard.read'], roles: ALL },
      },
    ],
  },
  {
    labelKey: 'nav.groups.operations',
    items: [
      {
        to: '/projects',
        i18nKey: 'nav.projects',
        icon: 'mdi-office-building-outline',
        access: { permissions: ['projects.read'], roles: ALL },
      },
      {
        to: '/contracts',
        i18nKey: 'nav.contracts',
        icon: 'mdi-file-sign',
        access: { permissions: ['contracts.read'], roles: ALL },
      },
      {
        to: '/templates',
        i18nKey: 'nav.templates',
        icon: 'mdi-file-document-multiple-outline',
        access: { permissions: ['templates.read'], roles: ALL },
      },
    ],
  },
  {
    labelKey: 'nav.groups.directory',
    items: [
      {
        to: '/customers',
        i18nKey: 'nav.customers',
        icon: 'mdi-account-multiple-outline',
        access: { permissions: ['customers.read'], roles: ALL },
      },
      {
        to: '/materials',
        i18nKey: 'nav.materials',
        icon: 'mdi-cube-outline',
        access: { permissions: ['materials.read'], roles: ALL },
      },
    ],
  },
  {
    labelKey: 'nav.groups.finance',
    items: [
      {
        to: '/costs',
        i18nKey: 'nav.costs',
        icon: 'mdi-cash-minus',
        access: { permissions: ['costs.read'], roles: ALL },
      },
      {
        to: '/payments',
        i18nKey: 'nav.payments',
        icon: 'mdi-cash-plus',
        access: { permissions: ['payments.read'], roles: ALL },
      },
      {
        to: '/reports',
        i18nKey: 'nav.reports',
        icon: 'mdi-chart-box-outline',
        access: { permissions: ['reports.read'], roles: FINANCE_ROLES },
      },
    ],
  },
  {
    labelKey: 'nav.groups.system',
    items: [
      {
        to: '/users',
        i18nKey: 'nav.users',
        icon: 'mdi-account-cog-outline',
        access: { permissions: ['users.read'], roles: OA },
      },
      {
        to: '/rbac',
        i18nKey: 'nav.rbac',
        icon: 'mdi-shield-key-outline',
        access: { permissions: ['rbac.manage'], roles: [RoleName.OWNER] },
      },
      {
        to: '/audit',
        i18nKey: 'nav.audit',
        icon: 'mdi-history',
        access: { permissions: ['audit.read'], roles: OA },
      },
      {
        to: '/tunnel',
        i18nKey: 'nav.tunnel',
        icon: 'mdi-tunnel',
        access: { permissions: ['tunnel.manage'], roles: OA },
      },
      {
        to: '/settings',
        i18nKey: 'nav.settings',
        icon: 'mdi-cog-outline',
        access: { permissions: ['settings.read'], roles: OA },
      },
    ],
  },
];

const ui = useUiStore();
const route = useRoute();
const { canAccess } = useAccess();

const visibleGroups = computed(() =>
  NAV_GROUPS.map((g, idx) => ({
    // A resolved label, not a key: an unlabelled group renders no heading and
    // its list carries no `aria-labelledby`, so a missing translation can never
    // point the list at an empty name.
    label: g.labelKey && te(g.labelKey) ? t(g.labelKey) : '',
    labelId: `cp-nav-group-${idx}`,
    items: g.items.filter((i) => canAccess(i.access)),
  })).filter((g) => g.items.length > 0),
);

/**
 * Section-level "you are here", by path prefix.
 *
 * The routes are flat: `/customers`, `/customers/new` and `/customers/:id` are
 * three sibling records, so `router-link-active` would light the Customers item
 * on the index and go dark the moment you opened a customer - the nav losing
 * its place exactly when you are deepest in the section. Prefix matching keeps
 * the section lit for its whole subtree. Dashboard is exact: `/` prefixes
 * everything.
 */
function isActive(to: string): boolean {
  if (to === '/') return route.path === '/';
  return route.path === to || route.path.startsWith(`${to}/`);
}
</script>

<template>
  <!-- A docked navigation pane, not a drawer. It never floats over the
       workspace and never overlays a scrim: it is a column of the window, the
       way an Explorer tree or an ERP module list is.

       The pane is a `--cp-panel` band (DESIGN.md assigns Panel to side regions),
       and the active item lifts out of that band onto the white document
       surface - the same figure/ground move the active document tab makes in
       AppLayout. Nav item and tab say one thing: this is the open document.

       Built on plain anchors rather than v-list-item: that component is a CSS
       grid (`max-content 1fr auto`), and its 1fr content column cannot be
       centred or collapsed away, which is what crushed the icons out of the
       rail. Owning the box is simpler than fighting it. -->
  <aside class="cp-sidenav" :class="{ 'cp-sidenav--rail': ui.sidebarCollapsed }">
    <div class="cp-brand">
      <!-- 20px mark, not the sidebar variant's 36px default: the brand row is
           one command-bar strip tall, and a 36px tile gets sliced by its clip. -->
      <CompanyLogo
        variant="sidebar"
        :size="20"
        :label="t('app.name')"
        :icon-only="ui.sidebarCollapsed"
      />
    </div>

    <nav class="cp-nav" :aria-label="t('nav.primary')">
      <div
        v-for="group in visibleGroups"
        :key="group.labelId"
        class="cp-nav-group"
        role="group"
        :aria-labelledby="group.label ? group.labelId : undefined"
      >
        <!-- Collapsed, this heading keeps its box but drops to a hairline rule:
             the rail loses the words, never the grouping. -->
        <div v-if="group.label" :id="group.labelId" class="cp-nav-group__label">
          {{ group.label }}
        </div>

        <ul class="cp-nav-list">
          <li v-for="item in group.items" :key="item.to">
            <RouterLink
              :to="item.to"
              class="cp-nav-item"
              :class="{ 'cp-nav-item--active': isActive(item.to) }"
              :aria-current="isActive(item.to) ? 'page' : undefined"
              :aria-label="ui.sidebarCollapsed ? t(item.i18nKey) : undefined"
            >
              <v-icon
                class="cp-nav-item__icon"
                :icon="item.icon"
                :size="ui.sidebarCollapsed ? 20 : 18"
              />
              <span class="cp-nav-item__label">{{ t(item.i18nKey) }}</span>

              <!-- The rail's only name for this link. Teleported out of the
                   anchor, so the 48px box never has to make room for it. -->
              <v-tooltip
                v-if="ui.sidebarCollapsed"
                activator="parent"
                location="end"
                theme="dark"
                :text="t(item.i18nKey)"
              />
            </RouterLink>
          </li>
        </ul>
      </div>
    </nav>
  </aside>
</template>

<style scoped>
.cp-sidenav {
  flex: none;
  width: 200px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  /* A side region, not a document surface. The band is what lets the active
     item read as "lifted onto the page". */
  background: var(--cp-panel);
  border-inline-end: 1px solid var(--cp-border);
  overflow: hidden;
  /* Width is a layout property, so it is animated deliberately and only here:
     one pane, one axis, on a user-initiated toggle (Ctrl+B). The global
     reduced-motion guard in main.css collapses this to an instant snap. */
  transition: width var(--cp-dur-slow) var(--cp-ease);
}
.cp-sidenav--rail {
  width: 48px;
}

/* Brand block at the head of the pane - one row tall, aligned to the command
   bar so the pane header and the chrome share a baseline. */
.cp-brand {
  display: flex;
  align-items: center;
  height: var(--cp-commandbar-h);
  padding-inline: 12px;
  flex: none;
  border-block-end: 1px solid var(--cp-border);
  overflow: hidden;
  white-space: nowrap;
}
/* The shared logo sizes its wordmark for the login screen. In a 32px chrome
   strip that shouts; the pane header should read as chrome, not as a banner. */
.cp-brand :deep(.cp-logo__label) {
  font-size: 0.82rem;
}
.cp-sidenav--rail .cp-brand {
  padding-inline: 0;
  justify-content: center;
}

.cp-nav {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-block: 4px 8px;
}

.cp-nav-group__label {
  padding: 12px 14px 4px;
  color: var(--cp-text-muted);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  white-space: nowrap;
}

.cp-nav-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

/* One row of the ledger's table of contents. Flex, not grid: the label is the
   only flexible part, and in the rail it is removed outright so the icon is
   genuinely centred in the box rather than parked in a leftover column. */
.cp-nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 30px;
  margin: 1px 6px;
  padding-inline: 9px;
  border: 1px solid transparent;
  border-radius: var(--cp-radius-sm);
  color: var(--cp-text);
  font-size: 0.82rem;
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;
  transition:
    background-color var(--cp-dur-fast) var(--cp-ease),
    color var(--cp-dur-fast) var(--cp-ease),
    border-color var(--cp-dur-fast) var(--cp-ease);
}
.cp-nav-item__icon {
  flex: none;
  /* Muted, not faded: #4A5568 holds 6.9:1 on the panel band and still sits a
     full step below the active item's primary. */
  color: var(--cp-text-muted);
}
.cp-nav-item__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Rest -> hover -> active is one ladder out of the band and onto the page:
   panel, then the workspace canvas, then the document surface itself. */
.cp-nav-item:hover:not(.cp-nav-item--active) {
  background: var(--cp-bg);
}
.cp-nav-item:focus-visible {
  outline: 2px solid var(--cp-primary);
  outline-offset: -2px;
}

.cp-nav-item--active {
  background: var(--cp-surface);
  border-color: var(--cp-border);
  color: var(--cp-primary);
  font-weight: 600;
}
.cp-nav-item--active .cp-nav-item__icon {
  color: var(--cp-primary);
}
/* The you-are-here marker, shaped like the Windows 11 NavigationView
   indicator: a short centred pill on the inline-start edge, not a full-height
   stripe. Logical inset keeps it correct under RTL. */
.cp-nav-item--active::before {
  content: '';
  position: absolute;
  inset-inline-start: -1px;
  inset-block-start: 50%;
  width: 3px;
  height: 16px;
  transform: translateY(-50%);
  border-radius: var(--cp-radius-pill);
  background: var(--cp-primary);
}

/* ---------- rail ----------
   48px, so a 36px item with a 20px glyph sits centred with real clearance. The
   labels go and the tooltips carry the names; the group headings stay in the
   DOM - they still name their lists for a screen reader - but collapse to the
   hairline rules that keep the icon stack legible. */
.cp-sidenav--rail .cp-nav-item {
  justify-content: center;
  gap: 0;
  height: 32px;
  margin: 2px 6px;
  padding-inline: 0;
}
.cp-sidenav--rail .cp-nav-item__label {
  display: none;
}
.cp-sidenav--rail .cp-nav-group__label {
  height: 0;
  margin: 6px 8px;
  padding: 0;
  overflow: hidden;
  border-block-start: 1px solid var(--cp-border);
}
</style>
