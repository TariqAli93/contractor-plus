<script setup lang="ts">
// Keyboard-shortcuts cheat sheet. Opened with `?` or the topbar button - makes
// the otherwise-hidden Ctrl+K palette, g-then-key navigation, and grid keys
// discoverable. Pure reference; open state lives in the ui store.
import { computed } from 'vue';
import { t } from '@/i18n';
import { useUiStore } from '@/stores/ui.store';

const ui = useUiStore();
const open = computed({
  get: () => ui.helpOpen,
  set: (v: boolean) => {
    ui.helpOpen = v;
  },
});

interface Shortcut {
  keys: string[];
  label: string;
}
interface Group {
  title: string;
  items: Shortcut[];
}

const groups = computed<Group[]>(() => [
  {
    title: t('shortcuts.groups.global'),
    items: [
      { keys: ['Ctrl', 'K'], label: t('shortcuts.palette') },
      { keys: ['?'], label: t('shortcuts.help') },
    ],
  },
  {
    title: t('shortcuts.groups.nav'),
    items: [
      { keys: ['G', 'D'], label: t('nav.dashboard') },
      { keys: ['G', 'P'], label: t('nav.projects') },
      { keys: ['G', 'C'], label: t('nav.contracts') },
      { keys: ['G', 'M'], label: t('nav.materials') },
      { keys: ['G', 'T'], label: t('nav.templates') },
      { keys: ['G', 'L'], label: t('nav.customers') },
      { keys: ['G', 'R'], label: t('nav.reports') },
      { keys: ['G', 'S'], label: t('nav.settings') },
    ],
  },
  {
    title: t('shortcuts.groups.grid'),
    items: [
      { keys: ['Enter'], label: t('shortcuts.grid.enter') },
      { keys: ['Tab'], label: t('shortcuts.grid.tab') },
      { keys: ['Ctrl', 'C'], label: t('shortcuts.grid.copy') },
      { keys: ['Ctrl', 'V'], label: t('shortcuts.grid.paste') },
      { keys: ['Ctrl', 'D'], label: t('shortcuts.grid.fill') },
      { keys: ['Delete'], label: t('shortcuts.grid.clear') },
      { keys: [t('shortcuts.rightClick')], label: t('shortcuts.grid.menu') },
    ],
  },
]);
</script>

<template>
  <v-dialog v-model="open" max-width="640" scrollable>
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon class="me-2">mdi-keyboard-outline</v-icon>
        <span>{{ t('shortcuts.title') }}</span>
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" size="small" :aria-label="t('common.close')" @click="open = false" />
      </v-card-title>
      <v-divider />
      <v-card-text>
        <div v-for="g in groups" :key="g.title" class="mb-5">
          <div class="text-overline text-medium-emphasis mb-1">{{ g.title }}</div>
          <div v-for="(s, i) in g.items" :key="i" class="cp-sc-row">
            <span>{{ s.label }}</span>
            <span class="cp-sc-keys">
              <kbd v-for="(k, ki) in s.keys" :key="ki" class="cp-kbd">{{ k }}</kbd>
            </span>
          </div>
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.cp-sc-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 0;
}
.cp-sc-keys {
  display: inline-flex;
  gap: 4px;
}
.cp-kbd {
  font-family: inherit;
  font-size: 0.75rem;
  line-height: 1;
  padding: 3px 7px;
  border-radius: 5px;
  border: 1px solid var(--cp-border);
  background: var(--cp-surface-2);
}
</style>
