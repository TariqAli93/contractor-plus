<script setup lang="ts">
// The full contract detail surface (header, DOCX panel, tabbed editor, side
// summary), driven by a `contractId` PROP rather than the route. Used both by
// the full-page ContractEditView and the master-detail ContractsWorkspaceView.
// Emits `changed` after any mutation that alters list-visible fields (status,
// number, totalPrice) so a parent list can refresh.
import { computed, ref, watch } from 'vue';
import { t } from '@/i18n';
import { contractsApi } from '@/services/api/contracts.api';
import { useApiError } from '@/composables/useApiError';
import type { ContractWithRelations } from '@/types/contract';
import ErrorState from '@/components/shared/ErrorState.vue';
import ContractActionToolbar from './ContractActionToolbar.vue';
import ContractHeaderCard from './ContractHeaderCard.vue';
import ContractSummaryPanel from './ContractSummaryPanel.vue';
import ContractGeneralTab from './ContractGeneralTab.vue';
import ContractItemsTab from './ContractItemsTab.vue';
import ContractEstimateTab from './ContractEstimateTab.vue';
import ContractProjectTab from './ContractProjectTab.vue';
import ContractChangeOrdersTab from './ContractChangeOrdersTab.vue';
import ContractGenerateDocxPanel from './ContractGenerateDocxPanel.vue';

const props = defineProps<{ contractId: string | undefined }>();
const emit = defineEmits<{ (e: 'changed'): void }>();
const { handle } = useApiError();

const contract = ref<ContractWithRelations | null>(null);
const loading = ref(false);
const error = ref<unknown>(null);

type TabKey = 'general' | 'items' | 'estimate' | 'project' | 'changeOrders';
const activeTab = ref<TabKey>('general');
const tabsLocked = computed(() => !props.contractId);

async function loadContract() {
  if (!props.contractId) {
    contract.value = null;
    activeTab.value = 'general';
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    contract.value = await contractsApi.get(props.contractId);
  } catch (e) {
    error.value = e;
    handle(e);
  } finally {
    loading.value = false;
  }
}
watch(() => props.contractId, loadContract, { immediate: true });

async function onChanged() {
  await loadContract();
  emit('changed');
}
</script>

<template>
  <div>
    <ErrorState v-if="error" :error="error" class="my-4" @retry="loadContract" />

    <template v-else>
      <ContractActionToolbar
        v-if="contract"
        :contract="contract"
        class="mb-4"
        @refetch="onChanged"
      />

      <div class="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div :class="contract ? 'xl:col-span-8' : 'xl:col-span-12'">
          <ContractHeaderCard v-if="contract" :contract="contract" class="mb-4" />
          <ContractGenerateDocxPanel v-if="contract && contractId" :contract-id="contractId" />

          <v-card>
            <v-tabs v-model="activeTab" color="primary" align-tabs="start">
              <v-tab value="general">{{ t('contracts.tabs.general') }}</v-tab>
              <v-tab value="items" :disabled="tabsLocked">{{ t('contracts.tabs.items') }}</v-tab>
              <v-tab value="estimate" :disabled="tabsLocked">{{ t('contracts.tabs.estimate') }}</v-tab>
              <v-tab value="project" :disabled="tabsLocked">{{ t('contracts.tabs.project') }}</v-tab>
              <v-tab value="changeOrders" :disabled="tabsLocked">{{ t('contracts.tabs.changeOrders') }}</v-tab>
            </v-tabs>
            <v-divider />
            <v-window v-model="activeTab">
              <v-window-item value="general" class="pa-4">
                <ContractGeneralTab
                  v-if="activeTab === 'general'"
                  :id="contractId"
                  :status="contract?.status"
                  @saved="onChanged"
                />
              </v-window-item>
              <v-window-item value="items" class="pa-4">
                <ContractItemsTab v-if="activeTab === 'items' && contract" :contract="contract" />
              </v-window-item>
              <v-window-item value="estimate" class="pa-4">
                <ContractEstimateTab
                  v-if="activeTab === 'estimate' && contract"
                  :contract="contract"
                  @refetch="onChanged"
                />
              </v-window-item>
              <v-window-item value="project" class="pa-4">
                <ContractProjectTab
                  v-if="activeTab === 'project' && contract"
                  :contract="contract"
                  @changed="onChanged"
                />
              </v-window-item>
              <v-window-item value="changeOrders" class="pa-4">
                <ContractChangeOrdersTab
                  v-if="activeTab === 'changeOrders' && contract"
                  :contract="contract"
                />
              </v-window-item>
            </v-window>
          </v-card>
        </div>

        <div v-if="contract" class="xl:col-span-4">
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
