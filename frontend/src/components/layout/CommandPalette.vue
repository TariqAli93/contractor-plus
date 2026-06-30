<script setup lang="ts">
// Global command palette (Ctrl/⌘+K). One box for everything: jump to any
// screen, run a quick-create, search projects/contracts/customers/materials
// live, or re-open something recent. Keyboard-first; the parent owns nothing —
// it reads ui.paletteOpen and this component drives navigation + recents.
import { computed, nextTick, ref, watch } from 'vue';
import { watchDebounced } from '@vueuse/core';
import { useRoute, useRouter } from 'vue-router';
import { t } from '@/i18n';
import { useUiStore } from '@/stores/ui.store';
import { useAccess } from '@/composables/useAccess';
import { useRecent, type RecentType } from '@/composables/useRecent';
import { RoleName } from '@/types/enums';
import { projectsApi } from '@/services/api/projects.api';
import { contractsApi } from '@/services/api/contracts.api';
import { customersApi } from '@/services/api/customers.api';
import { materialsApi } from '@/services/api/materials.api';

interface Entry {
  key: string;
  icon: string;
  label: string;
  sub?: string;
  perform: () => void;
}
interface Group {
  title: string;
  entries: Entry[];
}

const ui = useUiStore();
const router = useRouter();
const route = useRoute();
const { canAccess } = useAccess();
const { recent, pushRecent } = useRecent();

// Always close the palette once navigation lands — covers the close on select
// and any other route change while it's open.
watch(() => route.fullPath, () => ui.closePalette());

const ALL: RoleName[] = [
  RoleName.OWNER,
  RoleName.ADMIN,
  RoleName.ACCOUNTANT,
  RoleName.ENGINEER,
  RoleName.VIEWER,
];
const WRITE_PROJECTS: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ENGINEER];
const WRITE_CONTRACTS: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];
const WRITE_CUSTOMERS: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];
const WRITE_MATERIALS: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];

const can = (perm: string, roles: RoleName[]) => canAccess({ permissions: [perm], roles });

const query = ref('');
const highlighted = ref(0);
const loading = ref(false);
const results = ref<Entry[]>([]);
const latest = ref<Entry[]>([]);
const inputRef = ref<{ focus: () => void } | null>(null);

function go(to: string) {
  // Close first, then navigate on the next tick. Pushing the route in the same
  // tick as the close races the overlay teardown and strands the scrim in the
  // DOM; letting the close flush first keeps teardown clean.
  ui.closePalette();
  void nextTick(() => router.push(to));
}

function entryFor(
  type: RecentType,
  id: string,
  label: string,
  to: string,
  icon: string,
  sub: string,
): Entry {
  return {
    key: `${type}:${id}`,
    icon,
    label,
    sub,
    perform: () => {
      pushRecent({ type, id, label, to });
      go(to);
    },
  };
}

// ---- Static actions (navigation + quick-create), permission-gated ----
const actions = computed<Entry[]>(() => {
  const list: Entry[] = [];
  if (can('projects.create', WRITE_PROJECTS))
    list.push({ key: 'new-project', icon: 'mdi-folder-plus-outline', label: t('palette.actions.newProject'), perform: () => go('/projects/new') });
  if (can('contracts.create', WRITE_CONTRACTS))
    list.push({ key: 'new-contract', icon: 'mdi-file-plus-outline', label: t('palette.actions.newContract'), perform: () => go('/contracts/new') });
  if (can('customers.create', WRITE_CUSTOMERS))
    list.push({ key: 'new-customer', icon: 'mdi-account-plus-outline', label: t('palette.actions.newCustomer'), perform: () => go('/customers/new') });
  if (can('materials.create', WRITE_MATERIALS))
    list.push({ key: 'new-material', icon: 'mdi-plus-box-outline', label: t('palette.actions.newMaterial'), perform: () => go('/materials/new') });

  const nav: Array<[string, string, string, string]> = [
    ['dashboard.read', '/', 'mdi-view-dashboard-outline', t('palette.actions.goDashboard')],
    ['projects.read', '/projects', 'mdi-folder-outline', t('palette.actions.goProjects')],
    ['contracts.read', '/contracts', 'mdi-file-document-outline', t('palette.actions.goContracts')],
    ['materials.read', '/materials', 'mdi-cube-outline', t('palette.actions.goMaterials')],
    ['reports.read', '/reports', 'mdi-chart-box-outline', t('palette.actions.goReports')],
    ['settings.read', '/settings', 'mdi-cog-outline', t('palette.actions.goSettings')],
  ];
  for (const [perm, to, icon, label] of nav) {
    if (can(perm, ALL)) list.push({ key: `go:${to}`, icon, label, perform: () => go(to) });
  }

  const q = query.value.trim().toLowerCase();
  return q ? list.filter((e) => e.label.toLowerCase().includes(q)) : list;
});

// ---- Live entity search (debounced) ----
let searchToken = 0;
async function searchOne<T>(allowed: boolean, fn: () => Promise<{ items: T[] }>): Promise<T[]> {
  if (!allowed) return [];
  try {
    return (await fn()).items;
  } catch {
    return [];
  }
}

async function runSearch() {
  const q = query.value.trim();
  if (q.length < 2) {
    results.value = [];
    loading.value = false;
    return;
  }
  loading.value = true;
  const token = ++searchToken;
  const [projects, contracts, customers, materials] = await Promise.all([
    searchOne(can('projects.read', ALL), () => projectsApi.list({ search: q, pageSize: 5 })),
    searchOne(can('contracts.read', ALL), () => contractsApi.list({ search: q, pageSize: 5 })),
    searchOne(can('customers.read', ALL), () => customersApi.list({ search: q, pageSize: 5 })),
    searchOne(can('materials.read', ALL), () => materialsApi.list({ search: q, pageSize: 5 })),
  ]);
  if (token !== searchToken) return; // a newer search superseded this one
  const entries: Entry[] = [];
  for (const p of projects)
    entries.push(entryFor('project', p.id, p.name, `/projects/${p.id}`, 'mdi-folder-outline', t('nav.projects')));
  for (const c of contracts)
    entries.push(entryFor('contract', c.id, c.contractNumber, `/contracts/${c.id}`, 'mdi-file-document-outline', t('nav.contracts')));
  for (const c of customers)
    entries.push(entryFor('customer', c.id, c.name, `/customers/${c.id}`, 'mdi-account-outline', t('nav.customers')));
  for (const m of materials)
    entries.push(entryFor('material', m.id, m.name, `/materials/${m.id}`, 'mdi-cube-outline', t('nav.materials')));
  results.value = entries;
  loading.value = false;
}

watchDebounced(query, runSearch, { debounce: 220 });

async function loadLatest() {
  if (!can('projects.read', ALL)) {
    latest.value = [];
    return;
  }
  try {
    const res = await projectsApi.list({ pageSize: 5, sortBy: 'createdAt', sortDir: 'desc' });
    latest.value = res.items.map((p) =>
      entryFor('project', p.id, p.name, `/projects/${p.id}`, 'mdi-folder-outline', t('nav.projects')),
    );
  } catch {
    latest.value = [];
  }
}

// ---- Grouped + flattened view ----
const recentEntries = computed<Entry[]>(() =>
  recent.value.map((r) =>
    entryFor(r.type, r.id, r.label, r.to, recentIcon(r.type), t(`nav.${pluralOf(r.type)}`)),
  ),
);
function recentIcon(type: RecentType): string {
  return type === 'project'
    ? 'mdi-folder-outline'
    : type === 'contract'
      ? 'mdi-file-document-outline'
      : type === 'customer'
        ? 'mdi-account-outline'
        : 'mdi-cube-outline';
}
function pluralOf(type: RecentType): string {
  return type === 'project'
    ? 'projects'
    : type === 'contract'
      ? 'contracts'
      : type === 'customer'
        ? 'customers'
        : 'materials';
}

const groups = computed<Group[]>(() => {
  const out: Group[] = [];
  if (query.value.trim() === '') {
    if (recentEntries.value.length)
      out.push({ title: t('palette.groups.recent'), entries: recentEntries.value });
    if (latest.value.length)
      out.push({ title: t('palette.groups.latestProjects'), entries: latest.value });
    if (actions.value.length) out.push({ title: t('palette.groups.actions'), entries: actions.value });
  } else {
    if (actions.value.length) out.push({ title: t('palette.groups.actions'), entries: actions.value });
    if (results.value.length) out.push({ title: t('palette.groups.results'), entries: results.value });
  }
  return out;
});
const flat = computed<Entry[]>(() => groups.value.flatMap((g) => g.entries));

watch(flat, () => {
  if (highlighted.value >= flat.value.length) highlighted.value = Math.max(0, flat.value.length - 1);
});

function move(delta: number) {
  const n = flat.value.length;
  if (!n) return;
  highlighted.value = (highlighted.value + delta + n) % n;
  void nextTick(() => {
    document.querySelector('.cp-pal-item.is-active')?.scrollIntoView({ block: 'nearest' });
  });
}
function activate() {
  flat.value[highlighted.value]?.perform();
}
function setHighlightByKey(key: string) {
  const i = flat.value.findIndex((e) => e.key === key);
  if (i >= 0) highlighted.value = i;
}

function onDialog(open: boolean) {
  if (!open) ui.closePalette();
}

// Reset + focus + prime recents-fallback each time it opens.
watch(
  () => ui.paletteOpen,
  (open) => {
    if (open) {
      query.value = '';
      results.value = [];
      highlighted.value = 0;
      void loadLatest();
      void nextTick(() => inputRef.value?.focus());
    }
  },
);
</script>

<template>
  <v-dialog
    :model-value="ui.paletteOpen"
    max-width="640"
    content-class="cp-pal-dialog"
    :transition="false"
    @update:model-value="onDialog"
  >
    <v-card class="cp-pal-card" elevation="12">
      <div class="cp-pal-search">
        <v-icon class="cp-pal-search-ic">mdi-magnify</v-icon>
        <input
          ref="inputRef"
          v-model="query"
          class="cp-pal-input"
          :placeholder="t('palette.placeholder')"
          autocomplete="off"
          spellcheck="false"
          @keydown.down.prevent="move(1)"
          @keydown.up.prevent="move(-1)"
          @keydown.enter.prevent="activate"
          @keydown.esc.prevent="ui.closePalette()"
        />
        <kbd class="cp-pal-kbd">Esc</kbd>
      </div>

      <v-divider />

      <div class="cp-pal-results">
        <template v-for="group in groups" :key="group.title">
          <div class="cp-pal-group">{{ group.title }}</div>
          <button
            v-for="entry in group.entries"
            :key="entry.key"
            type="button"
            class="cp-pal-item"
            :class="{ 'is-active': flat[highlighted]?.key === entry.key }"
            @click="entry.perform()"
            @mousemove="setHighlightByKey(entry.key)"
          >
            <v-icon size="20" class="cp-pal-item-ic">{{ entry.icon }}</v-icon>
            <span class="cp-pal-item-label">{{ entry.label }}</span>
            <span v-if="entry.sub" class="cp-pal-item-sub">{{ entry.sub }}</span>
          </button>
        </template>

        <div v-if="loading" class="cp-pal-state">
          <v-progress-circular indeterminate size="22" />
        </div>
        <div v-else-if="flat.length === 0" class="cp-pal-state">{{ t('palette.noResults') }}</div>
      </div>

      <v-divider />
      <div class="cp-pal-foot">
        <span><kbd class="cp-pal-kbd">↑</kbd><kbd class="cp-pal-kbd">↓</kbd> {{ t('palette.hintNavigate') }}</span>
        <span><kbd class="cp-pal-kbd">Enter</kbd> {{ t('palette.hintOpen') }}</span>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.cp-pal-card {
  border-radius: 14px;
  overflow: hidden;
}
.cp-pal-search {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
}
.cp-pal-search-ic {
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.cp-pal-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 1.05rem;
  color: rgb(var(--v-theme-on-surface));
}
.cp-pal-results {
  max-height: 56vh;
  overflow-y: auto;
  padding: 6px;
}
.cp-pal-group {
  font-size: 0.72rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.5);
  padding: 10px 12px 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.cp-pal-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 9px 12px;
  border-radius: 8px;
  text-align: start;
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
}
.cp-pal-item.is-active {
  background: rgba(var(--v-theme-primary), 0.12);
}
.cp-pal-item-ic {
  color: rgba(var(--v-theme-on-surface), 0.65);
  flex: 0 0 auto;
}
.cp-pal-item-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cp-pal-item-sub {
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.45);
  flex: 0 0 auto;
}
.cp-pal-state {
  display: flex;
  justify-content: center;
  padding: 28px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.cp-pal-foot {
  display: flex;
  gap: 18px;
  padding: 8px 14px;
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.cp-pal-kbd {
  display: inline-block;
  min-width: 18px;
  padding: 1px 5px;
  margin-inline-end: 3px;
  border-radius: 4px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.2);
  background: rgba(var(--v-theme-on-surface), 0.06);
  font-size: 0.7rem;
  text-align: center;
}
</style>
