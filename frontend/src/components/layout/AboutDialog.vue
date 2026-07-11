<script setup lang="ts">
// Help ▸ About. The small, factual box every Windows program has: what this is,
// which build, what it is bound to. No marketing, no logo wall.
import { computed } from 'vue';
import { t } from '@/i18n';
import { useUiStore } from '@/stores/ui.store';
import { useShellStore } from '@/stores/shell.store';

const ui = useUiStore();
const shell = useShellStore();

interface Fact {
  label: string;
  value: string;
}

const facts = computed<Fact[]>(() => {
  const rows: Fact[] = [];
  if (shell.appVersion) rows.push({ label: t('about.version'), value: shell.appVersion });
  if (shell.platform) rows.push({ label: t('about.platform'), value: shell.platform });
  if (shell.database) rows.push({ label: t('about.database'), value: shell.database });
  if (shell.companyName) rows.push({ label: t('about.company'), value: shell.companyName });
  return rows;
});
</script>

<template>
  <v-dialog v-model="ui.aboutOpen" width="380" :transition="false">
    <div class="cp-about">
      <h2 class="cp-about__title">{{ t('app.name') }}</h2>
      <p class="cp-about__desc">{{ t('about.description') }}</p>

      <dl v-if="facts.length" class="cp-about__facts">
        <template v-for="f in facts" :key="f.label">
          <dt>{{ f.label }}</dt>
          <dd>{{ f.value }}</dd>
        </template>
      </dl>

      <div class="cp-about__actions">
        <button type="button" class="cp-about__ok" @click="ui.aboutOpen = false">
          {{ t('common.close') }}
        </button>
      </div>
    </div>
  </v-dialog>
</template>

<style scoped>
.cp-about {
  padding: 14px 14px 10px;
  background: var(--cp-surface);
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-md);
}
.cp-about__title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  letter-spacing: -0.005em;
}
.cp-about__desc {
  margin: 4px 0 12px;
  font-size: 0.8rem;
  line-height: 1.5;
  color: var(--cp-text-muted);
  text-wrap: pretty;
}
/* Label/value pairs on a hairline grid - a property sheet, not a card. */
.cp-about__facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0;
  margin: 0 0 12px;
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-sm);
  font-size: 0.76rem;
}
.cp-about__facts dt,
.cp-about__facts dd {
  margin: 0;
  padding: 4px 8px;
  border-block-start: 1px solid var(--cp-border);
}
.cp-about__facts dt:first-of-type,
.cp-about__facts dt:first-of-type + dd {
  border-block-start: 0;
}
.cp-about__facts dt {
  color: var(--cp-text-muted);
  background: var(--cp-surface-2);
  border-inline-end: 1px solid var(--cp-border);
  white-space: nowrap;
}
.cp-about__facts dd {
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.cp-about__actions {
  display: flex;
  justify-content: flex-end;
}
.cp-about__ok {
  height: 24px;
  padding: 0 14px;
  font: inherit;
  font-size: 0.78rem;
  color: #FFFFFF;
  background: var(--cp-primary);
  border: 1px solid var(--cp-primary);
  border-radius: var(--cp-radius-sm);
  cursor: default;
}
.cp-about__ok:hover {
  background: var(--cp-primary-hover);
  border-color: var(--cp-primary-hover);
}
.cp-about__ok:focus-visible {
  outline: 2px solid var(--cp-primary);
  outline-offset: 2px;
}
</style>
