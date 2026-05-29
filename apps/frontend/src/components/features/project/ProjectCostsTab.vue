<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { costsApi } from '@/services/api/costs.api';
import { useApiError } from '@/composables/useApiError';
import { RoleName } from '@/types/enums';
import type { ProjectCostSummary } from '@/types/cost';
import SummaryCard from '@/components/shared/SummaryCard.vue';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';
import EmptyState from '@/components/shared/EmptyState.vue';
import ErrorState from '@/components/shared/ErrorState.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';
import RoleGate from '@/components/shared/RoleGate.vue';
import AddCostDialog from './AddCostDialog.vue';

const props = defineProps<{ projectId: string }>();
const emit = defineEmits<{ (e: 'changed'): void }>();
const { t } = useI18n();
const { handle } = useApiError();

const ADD_ROLES: RoleName[] = [
  RoleName.OWNER,
  RoleName.ADMIN,
  RoleName.ACCOUNTANT,
  RoleName.ENGINEER,
];

const summary = ref<ProjectCostSummary | null>(null);
const loading = ref(false);
const error = ref<unknown>(null);

async function fetch() {
  loading.value = true;
  error.value = null;
  try {
    summary.value = await costsApi.getProjectSummary(props.projectId);
  } catch (e) {
    error.value = e;
    handle(e);
  } finally {
    loading.value = false;
  }
}

onMounted(fetch);
watch(() => props.projectId, fetch);

// Dialog state lives at the tab level so the button next to the title can
// open it without prop-drilling into the table area.
const addOpen = ref(false);

async function onCreated() {
  // Pessimistic refresh of this tab's own data, plus an upward signal so
  // ProjectEditView can refetch the cost summary used by ProjectSummaryPanel.
  await fetch();
  emit('changed');
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-3 gap-3 flex-wrap">
      <h2 class="text-h6">{{ t('projects.costs.title') }}</h2>
      <div class="flex items-center gap-2">
        <RoleGate :roles="ADD_ROLES">
          <v-btn
            color="primary"
            prepend-icon="mdi-cash-minus"
            @click="addOpen = true"
          >
            {{ t('projects.costs.addCost') }}
          </v-btn>
        </RoleGate>
        <v-btn
          variant="tonal"
          prepend-icon="mdi-refresh"
          :loading="loading"
          @click="fetch"
        >
          {{ t('common.retry') }}
        </v-btn>
      </div>
    </div>

    <ErrorState v-if="error" :error="error" class="my-4" @retry="fetch" />

    <template v-else-if="summary">
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <SummaryCard
          :title="t('projects.costs.summary.totalCosts')"
          icon="mdi-cash-minus"
          :loading="loading"
        >
          <MoneyDisplay :amount="summary.totalCosts" />
        </SummaryCard>
        <SummaryCard
          :title="t('projects.costs.summary.materials')"
          icon="mdi-cube-outline"
        >
          <MoneyDisplay :amount="summary.materialCosts" />
        </SummaryCard>
        <SummaryCard
          :title="t('projects.costs.summary.labor')"
          icon="mdi-account-hard-hat-outline"
        >
          <MoneyDisplay :amount="summary.laborCosts" />
        </SummaryCard>
        <SummaryCard
          :title="t('projects.costs.summary.machinery')"
          icon="mdi-tools"
        >
          <MoneyDisplay :amount="summary.machineryCosts" />
        </SummaryCard>
        <SummaryCard
          :title="t('projects.costs.summary.transport')"
          icon="mdi-truck-outline"
        >
          <MoneyDisplay :amount="summary.transportCosts" />
        </SummaryCard>
        <SummaryCard
          :title="t('projects.costs.summary.misc')"
          icon="mdi-dots-horizontal-circle-outline"
        >
          <MoneyDisplay :amount="summary.miscCosts" />
        </SummaryCard>
        <SummaryCard
          :title="t('projects.costs.summary.count')"
          icon="mdi-counter"
        >
          {{ summary.costCount }}
        </SummaryCard>
      </div>

      <v-card variant="outlined">
        <v-card-title class="text-h6">{{ t('projects.costs.latest') }}</v-card-title>
        <v-divider />
        <v-table density="comfortable" hover>
          <thead>
            <tr>
              <th class="text-start" style="width: 110px">{{ t('projects.costs.fields.date') }}</th>
              <th class="text-start" style="width: 130px">{{ t('projects.costs.fields.category') }}</th>
              <th class="text-start">{{ t('projects.costs.fields.description') }}</th>
              <th class="text-end" style="width: 110px">{{ t('projects.costs.fields.quantity') }}</th>
              <th class="text-end" style="width: 130px">{{ t('projects.costs.fields.unitPrice') }}</th>
              <th class="text-end" style="width: 140px">{{ t('projects.costs.fields.totalAmount') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="cost in summary.latestCosts" :key="cost.id">
              <td><DateDisplay :value="cost.date" /></td>
              <td>
                <v-chip size="x-small" variant="tonal">{{ cost.category }}</v-chip>
              </td>
              <td>{{ cost.description }}</td>
              <td class="text-end">
                {{ cost.quantity !== null ? Number(cost.quantity) : '—' }}
              </td>
              <td class="text-end">
                <MoneyDisplay :amount="cost.unitPrice" />
              </td>
              <td class="text-end"><MoneyDisplay :amount="cost.totalAmount" /></td>
            </tr>
          </tbody>
        </v-table>
        <EmptyState
          v-if="summary.latestCosts.length === 0"
          :title="t('projects.costs.empty')"
          icon="mdi-cash-minus"
        />
      </v-card>
    </template>

    <v-progress-linear v-else indeterminate />

    <AddCostDialog
      v-model="addOpen"
      :project-id="projectId"
      @created="onCreated"
    />
  </div>
</template>
