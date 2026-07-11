<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { t } from '@/i18n';
import TemplateGeneralTab from '@/components/features/template/TemplateGeneralTab.vue';
import TemplateMaterialsTab from '@/components/features/template/TemplateMaterialsTab.vue';
import TemplateStepsTab from '@/components/features/template/TemplateStepsTab.vue';
import TemplateEstimateTab from '@/components/features/template/TemplateEstimateTab.vue';
import PageHeader from '@/components/shared/PageHeader.vue';

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
  <div class="cp-fill">
    <PageHeader :title="heading" back="/templates" />

    <section class="cp-pane">
      <div class="cp-pane__toolbar">
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
      </div>

      <v-window v-model="activeTab" class="cp-pane__body">
        <v-window-item value="general" class="pa-2">
          <TemplateGeneralTab
            v-if="activeTab === 'general'"
            :id="templateId"
          />
        </v-window-item>
        <v-window-item value="materials" class="pa-2">
          <TemplateMaterialsTab
            v-if="activeTab === 'materials' && templateId"
            :template-id="templateId"
          />
        </v-window-item>
        <v-window-item value="steps" class="pa-2">
          <TemplateStepsTab
            v-if="activeTab === 'steps' && templateId"
            :template-id="templateId"
          />
        </v-window-item>
        <v-window-item value="estimate" class="pa-2">
          <TemplateEstimateTab
            v-if="activeTab === 'estimate' && templateId"
            :template-id="templateId"
          />
        </v-window-item>
      </v-window>

      <div v-if="tabsLocked" class="cp-pane__foot">
        <v-icon icon="mdi-information-outline" size="15" />
        {{ t('templates.saveFirstHint') }}
      </div>
    </section>
  </div>
</template>
