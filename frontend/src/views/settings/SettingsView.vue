<script setup lang="ts">
import { computed, ref } from 'vue';
import { t } from '@/i18n';
import { useAccess } from '@/composables/useAccess';
import GeneralSettingsTab from '@/components/features/settings/GeneralSettingsTab.vue';
import CompanyProfileTab from '@/components/features/settings/CompanyProfileTab.vue';
import CurrencyTab from '@/components/features/settings/CurrencyTab.vue';
import ContractTemplatesTab from '@/components/features/settings/ContractTemplatesTab.vue';
import AiSettingsTab from '@/components/features/settings/AiSettingsTab.vue';
import PageHeader from '@/components/shared/PageHeader.vue';

const { hasPermission } = useAccess();
const showAi = computed(() => hasPermission('ai.manage-settings'));

const activeTab = ref<'general' | 'company' | 'currency' | 'contractTemplates' | 'ai' | 'links'>(
  'general',
);

// The AI governance tab is added only for holders of ai.manage-settings.
const tabs = computed(
  () =>
    [
      { value: 'general', icon: 'mdi-tune' },
      { value: 'currency', icon: 'mdi-currency-usd' },
      { value: 'company', icon: 'mdi-domain' },
      { value: 'contractTemplates', icon: 'mdi-file-document-outline' },
      ...(showAi.value ? [{ value: 'ai', icon: 'mdi-robot-outline' } as const] : []),
      { value: 'links', icon: 'mdi-link-variant' },
    ] as const,
);
</script>

<template>
  <div class="cp-settings cp-fill">
    <PageHeader :title="t('nav.settings')" icon="mdi-cog-outline" :hint="t('settings.subtitle')" />
    <section class="cp-settings__workspace">
      <v-tabs v-model="activeTab" direction="vertical" color="primary" class="cp-settings__tabs">
        <v-tab v-for="tab in tabs" :key="tab.value" :value="tab.value" :prepend-icon="tab.icon">
          {{ t(`settings.tabs.${tab.value}`) }}
        </v-tab>
      </v-tabs>

      <v-window v-model="activeTab" class="cp-settings__content">
        <v-window-item value="general"><GeneralSettingsTab /></v-window-item>
        <v-window-item value="currency"><CurrencyTab /></v-window-item>
        <v-window-item value="company"><CompanyProfileTab /></v-window-item>
        <v-window-item value="contractTemplates"><ContractTemplatesTab /></v-window-item>
        <v-window-item v-if="showAi" value="ai"><AiSettingsTab /></v-window-item>
        <v-window-item value="links">
          <section class="cp-panel cp-settings__links">
            <RouterLink to="/tunnel" class="cp-settings__link">
              <v-icon icon="mdi-tunnel" size="17" />
              <span>{{ t('settings.links.tunnel') }}</span>
              <small>{{ t('settings.links.tunnelDesc') }}</small>
              <v-icon icon="mdi-arrow-left" size="16" />
            </RouterLink>
            <RouterLink to="/audit" class="cp-settings__link">
              <v-icon icon="mdi-history" size="17" />
              <span>{{ t('settings.links.audit') }}</span>
              <small>{{ t('settings.links.auditDesc') }}</small>
              <v-icon icon="mdi-arrow-left" size="16" />
            </RouterLink>
            <div class="cp-settings__note">{{ t('settings.phase2Note') }}</div>
          </section>
        </v-window-item>
      </v-window>
    </section>
  </div>
</template>

<style scoped>
.cp-settings__workspace {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 178px minmax(0, 1fr);
  background: var(--cp-surface);
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-md);
  overflow: hidden;
}
.cp-settings__tabs {
  align-self: stretch;
  padding: 4px;
  background: var(--cp-panel);
  border-inline-end: 1px solid var(--cp-border);
}
.cp-settings__tabs :deep(.v-tab) {
  justify-content: flex-start;
  min-width: 0;
  margin: 1px 0;
  padding-inline: 8px;
}
.cp-settings__content {
  min-width: 0;
  overflow: auto;
  padding: 8px;
  background: var(--cp-bg);
}
.cp-settings__links {
  overflow: hidden;
}
.cp-settings__link {
  display: grid;
  grid-template-columns: auto minmax(110px, max-content) 1fr auto;
  align-items: center;
  gap: 7px;
  min-height: 34px;
  padding: 5px 8px;
  color: var(--cp-primary);
  text-decoration: none;
  border-block-end: 1px solid var(--cp-border);
  font-size: 0.78rem;
}
.cp-settings__link:hover {
  background: var(--cp-primary-soft);
}
.cp-settings__link small {
  color: var(--cp-text-muted);
  font-size: 0.72rem;
}
.cp-settings__note {
  padding: 7px 8px;
  color: var(--cp-text-muted);
  background: var(--cp-surface-2);
  font-size: 0.76rem;
}
@media (max-width: 760px) {
  .cp-settings__workspace {
    grid-template-columns: 1fr;
  }
  .cp-settings__tabs {
    border-inline-end: 0;
    border-block-end: 1px solid var(--cp-border);
  }
}
</style>
