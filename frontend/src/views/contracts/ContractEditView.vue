<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { t } from '@/i18n';
import { contractsApi } from '@/services/api/contracts.api';
import { useApiError } from '@/composables/useApiError';
import type { ContractWithRelations } from '@/types/contract';
import ErrorState from '@/components/shared/ErrorState.vue';
import ContractActionToolbar from '@/components/features/contract/ContractActionToolbar.vue';
import ContractHeaderCard from '@/components/features/contract/ContractHeaderCard.vue';
import ContractSummaryPanel from '@/components/features/contract/ContractSummaryPanel.vue';
import ContractGeneralTab from '@/components/features/contract/ContractGeneralTab.vue';
import ContractItemsTab from '@/components/features/contract/ContractItemsTab.vue';
import ContractEstimateTab from '@/components/features/contract/ContractEstimateTab.vue';
import ContractProjectTab from '@/components/features/contract/ContractProjectTab.vue';
import ContractGenerateDocxPanel from '@/components/features/contract/ContractGenerateDocxPanel.vue';

const route = useRoute();
const { handle } = useApiError();

const contractId = computed(() => {
  const id = route.params.id;
  return typeof id === 'string' ? id : undefined;
});

const heading = computed(() =>
  contractId.value ? t('contracts.edit') : t('contracts.new'),
);

const contract = ref<ContractWithRelations | null>(null);
const loading = ref(false);
const error = ref<unknown>(null);

async function loadContract() {
  if (!contractId.value) {
    contract.value = null;
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    contract.value = await contractsApi.get(contractId.value);
  } catch (e) {
    error.value = e;
    handle(e);
  } finally {
    loading.value = false;
  }
}

onMounted(loadContract);
watch(contractId, loadContract);

type TabKey = 'general' | 'items' | 'estimate' | 'project';
const activeTab = ref<TabKey>('general');

const tabsLocked = computed(() => !contractId.value);
</script>

<template>
  <div>
    <div class="flex items-center gap-2 mb-4">
      <v-btn icon="mdi-arrow-right" variant="text" to="/contracts" />
      <h1 class="text-h5">{{ heading }}</h1>
    </div>

    <ErrorState v-if="error" :error="error" class="my-4" @retry="loadContract" />

    <template v-else>
      <ContractActionToolbar
        v-if="contract"
        :contract="contract"
        class="mb-4"
        @refetch="loadContract"
      />

      <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div :class="contract ? 'lg:col-span-9' : 'lg:col-span-12'">
          <ContractHeaderCard v-if="contract" :contract="contract" class="mb-4" />
          <ContractGenerateDocxPanel
            v-if="contract && contractId"
            :contract-id="contractId"
          />

          <v-card>
            <v-tabs v-model="activeTab" color="primary" align-tabs="start">
              <v-tab value="general">{{ t('contracts.tabs.general') }}</v-tab>
              <v-tab value="items" :disabled="tabsLocked">{{ t('contracts.tabs.items') }}</v-tab>
              <v-tab value="estimate" :disabled="tabsLocked">{{ t('contracts.tabs.estimate') }}</v-tab>
              <v-tab value="project" :disabled="tabsLocked">{{ t('contracts.tabs.project') }}</v-tab>
            </v-tabs>
            <v-divider />
            <v-window v-model="activeTab">
              <v-window-item value="general" class="pa-4">
                <ContractGeneralTab
                  v-if="activeTab === 'general'"
                  :id="contractId"
                  :status="contract?.status"
                  @saved="loadContract"
                />
              </v-window-item>
              <v-window-item value="items" class="pa-4">
                <ContractItemsTab
                  v-if="activeTab === 'items' && contract"
                  :contract="contract"
                />
              </v-window-item>
              <v-window-item value="estimate" class="pa-4">
                <ContractEstimateTab
                  v-if="activeTab === 'estimate' && contract"
                  :contract="contract"
                  @refetch="loadContract"
                />
              </v-window-item>
              <v-window-item value="project" class="pa-4">
                <ContractProjectTab
                  v-if="activeTab === 'project' && contract"
                  :contract="contract"
                />
              </v-window-item>
            </v-window>
          </v-card>
        </div>

        <div v-if="contract" class="lg:col-span-3">
          <ContractSummaryPanel :contract="contract" class="sticky top-4" />
        </div>
      </div>

      <v-alert
        v-if="tabsLocked"
        type="info"
        variant="tonal"
        icon="mdi-information-outline"
        class="mt-4"
      >
        {{ t('contracts.saveFirstHint') }}
      </v-alert>
    </template>
  </div>
</template>
