<script setup lang="ts">
import { ref } from 'vue';
import { t } from '@/i18n';
import GeneralSettingsTab from '@/components/features/settings/GeneralSettingsTab.vue';
import CompanyProfileTab from '@/components/features/settings/CompanyProfileTab.vue';
import CurrencyTab from '@/components/features/settings/CurrencyTab.vue';
import ContractTemplatesTab from '@/components/features/settings/ContractTemplatesTab.vue';
import AppearanceSettingsTab from '@/components/features/settings/AppearanceSettingsTab.vue';
import AiCommandSettingsTab from '@/components/features/settings/AiCommandSettingsTab.vue';
import CompanyLogo from '@/components/shared/CompanyLogo.vue';

const activeTab = ref<
  'general' | 'appearance' | 'company' | 'currency' | 'contractTemplates' | 'ai' | 'links'
>('general');
</script>

<template>
  <div class="cp-settings">
    <header class="cp-settings__header">
      <div class="flex items-center gap-3 min-w-0">
        <CompanyLogo variant="compact" icon-only :size="40" />
        <div class="min-w-0">
          <p class="cp-eyebrow mb-1">{{ t('nav.settings') }}</p>
          <h1 class="cp-settings__title">{{ t('settings.tabs.' + activeTab) }}</h1>
          <p class="text-medium-emphasis text-sm mt-1">{{ t('settings.subtitle') }}</p>
        </div>
      </div>
    </header>

    <v-tabs
      v-model="activeTab"
      color="primary"
      density="comfortable"
      grow
      class="cp-settings__tabs mb-5"
      :show-arrows="true"
    >
      <v-tab value="general" prepend-icon="mdi-tune">
        {{ t('settings.tabs.general') }}
      </v-tab>
      <v-tab value="appearance" prepend-icon="mdi-palette-outline">
        {{ t('settings.tabs.appearance') }}
      </v-tab>
      <v-tab value="currency" prepend-icon="mdi-currency-usd">
        {{ t('settings.tabs.currency') }}
      </v-tab>
      <v-tab value="company" prepend-icon="mdi-domain">
        {{ t('settings.tabs.company') }}
      </v-tab>
      <v-tab value="contractTemplates" prepend-icon="mdi-file-document-outline">
        {{ t('settings.tabs.contractTemplates') }}
      </v-tab>
      <v-tab value="ai" prepend-icon="mdi-robot-outline">
        {{ t('settings.tabs.ai') }}
      </v-tab>
      <v-tab value="links" prepend-icon="mdi-link-variant">
        {{ t('settings.tabs.links') }}
      </v-tab>
    </v-tabs>

    <v-window v-model="activeTab" class="cp-settings__window">
      <v-window-item value="general">
        <GeneralSettingsTab />
      </v-window-item>

      <v-window-item value="appearance">
        <AppearanceSettingsTab />
      </v-window-item>

      <v-window-item value="currency">
        <CurrencyTab />
      </v-window-item>

      <v-window-item value="company">
        <CompanyProfileTab />
      </v-window-item>

      <v-window-item value="contractTemplates">
        <ContractTemplatesTab />
      </v-window-item>

      <v-window-item value="ai">
        <AiCommandSettingsTab />
      </v-window-item>

      <v-window-item value="links">
        <div class="cp-panel">
          <div class="p-4">
            <v-list density="comfortable" class="!bg-transparent">
              <v-list-item
                to="/tunnel"
                prepend-icon="mdi-tunnel"
                :title="t('settings.links.tunnel')"
                :subtitle="t('settings.links.tunnelDesc')"
                append-icon="mdi-arrow-left"
                class="!rounded-lg"
              />
              <v-list-item
                to="/audit"
                prepend-icon="mdi-history"
                :title="t('settings.links.audit')"
                :subtitle="t('settings.links.auditDesc')"
                append-icon="mdi-arrow-left"
                class="!rounded-lg"
              />
            </v-list>
            <v-alert
              type="info"
              variant="tonal"
              density="comfortable"
              class="mt-4 text-sm"
            >
              {{ t('settings.phase2Note') }}
            </v-alert>
          </div>
        </div>
      </v-window-item>
    </v-window>
  </div>
</template>

<style scoped>
.cp-settings__header {
  margin-bottom: 20px;
}
.cp-settings__title {
  font-size: 1.6rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--cp-text);
}
.cp-settings__tabs {
  border-bottom: 1px solid var(--cp-border);
}
.cp-settings__window {
  background: transparent;
}
</style>
