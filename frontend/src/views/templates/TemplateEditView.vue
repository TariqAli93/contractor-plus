<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { t } from '@/i18n';
import TemplateGeneralTab from '@/components/features/template/TemplateGeneralTab.vue';
import TemplateMaterialsTab from '@/components/features/template/TemplateMaterialsTab.vue';
import TemplateStepsTab from '@/components/features/template/TemplateStepsTab.vue';
import TemplateEstimateTab from '@/components/features/template/TemplateEstimateTab.vue';

const route = useRoute();

const templateId = computed(() => {
  const id = route.params.id;
  return typeof id === 'string' ? id : undefined;
});

const heading = computed(() =>
  templateId.value ? t('templates.edit') : t('templates.new'),
);

type TabKey = 'general' | 'materials' | 'steps' | 'estimate';
const activeTab = ref<TabKey>('general');

const tabsLocked = computed(() => !templateId.value);
</script>

<template>
  <div>
    <div class="flex items-center gap-2 mb-4">
      <v-btn icon="mdi-arrow-right" variant="text" to="/templates" />
      <h1 class="text-h5">{{ heading }}</h1>
    </div>

    <v-card>
      <v-tabs v-model="activeTab" color="primary" align-tabs="start">
        <v-tab value="general">{{ t('templates.tabs.general') }}</v-tab>
        <v-tab value="materials" :disabled="tabsLocked">
          {{ t('templates.tabs.materials') }}
        </v-tab>
        <v-tab value="steps" :disabled="tabsLocked">
          {{ t('templates.tabs.steps') }}
        </v-tab>
        <v-tab value="estimate" :disabled="tabsLocked">
          {{ t('templates.tabs.estimate') }}
        </v-tab>
      </v-tabs>

      <v-divider />

      <v-window v-model="activeTab">
        <v-window-item value="general" class="pa-4">
          <TemplateGeneralTab
            v-if="activeTab === 'general'"
            :id="templateId"
          />
        </v-window-item>
        <v-window-item value="materials" class="pa-4">
          <TemplateMaterialsTab
            v-if="activeTab === 'materials' && templateId"
            :template-id="templateId"
          />
        </v-window-item>
        <v-window-item value="steps" class="pa-4">
          <TemplateStepsTab
            v-if="activeTab === 'steps' && templateId"
            :template-id="templateId"
          />
        </v-window-item>
        <v-window-item value="estimate" class="pa-4">
          <TemplateEstimateTab
            v-if="activeTab === 'estimate' && templateId"
            :template-id="templateId"
          />
        </v-window-item>
      </v-window>
    </v-card>

    <v-alert
      v-if="tabsLocked"
      type="info"
      variant="tonal"
      icon="mdi-information-outline"
      class="mt-4"
    >
      {{ t('templates.saveFirstHint') }}
    </v-alert>
  </div>
</template>
