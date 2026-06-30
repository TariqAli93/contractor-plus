<script setup lang="ts">
// The full project detail surface (header, progress, tabbed editor, side
// summary), driven by a `projectId` PROP rather than the route. Used both by
// the full-page ProjectEditView and the master-detail ProjectsWorkspaceView.
// Emits `changed` after any mutation that alters list-visible fields (status,
// name, dates, progress) so a parent list can refresh.
import { computed, ref, watch } from 'vue';
import { t } from '@/i18n';
import { projectsApi } from '@/services/api/projects.api';
import { costsApi } from '@/services/api/costs.api';
import { paymentsApi } from '@/services/api/payments.api';
import { useApiError } from '@/composables/useApiError';
import type { ProjectWithContract } from '@/types/project';
import type { ProjectCostSummary } from '@/types/cost';
import type { ProjectPaymentSummary } from '@/types/payment';
import ErrorState from '@/components/shared/ErrorState.vue';
import ProjectActionToolbar from './ProjectActionToolbar.vue';
import ProjectHeaderCard from './ProjectHeaderCard.vue';
import ProjectProgressCard from './ProjectProgressCard.vue';
import ProjectSummaryPanel from './ProjectSummaryPanel.vue';
import ProjectGeneralTab from './ProjectGeneralTab.vue';
import ProjectCostsTab from './ProjectCostsTab.vue';
import ProjectPaymentsTab from './ProjectPaymentsTab.vue';
import ProjectProgressTab from './ProjectProgressTab.vue';

const props = defineProps<{ projectId: string | undefined }>();
const emit = defineEmits<{ (e: 'changed'): void }>();
const { handle } = useApiError();

const project = ref<ProjectWithContract | null>(null);
const costSummary = ref<ProjectCostSummary | null>(null);
const paymentSummary = ref<ProjectPaymentSummary | null>(null);
const loading = ref(false);
const error = ref<unknown>(null);

type TabKey = 'general' | 'costs' | 'payments' | 'progress';
const activeTab = ref<TabKey>('general');
const tabsLocked = computed(() => !props.projectId);

async function loadAll() {
  if (!props.projectId) {
    project.value = null;
    costSummary.value = null;
    paymentSummary.value = null;
    activeTab.value = 'general';
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    const [p, cs, ps] = await Promise.all([
      projectsApi.get(props.projectId),
      costsApi.getProjectSummary(props.projectId).catch(() => null),
      paymentsApi.getProjectSummary(props.projectId).catch(() => null),
    ]);
    project.value = p;
    costSummary.value = cs;
    paymentSummary.value = ps;
  } catch (e) {
    error.value = e;
    handle(e);
  } finally {
    loading.value = false;
  }
}

// Reload whenever the selected project changes (and on first render).
watch(() => props.projectId, loadAll, { immediate: true });

// A lifecycle/identity mutation: reload, then tell the parent list to refresh.
async function onChanged() {
  await loadAll();
  emit('changed');
}

// Narrow refetches for the tab dialogs — only the side-panel summaries, no
// full project refetch, no list refresh (cost/payment edits don't show there).
async function refreshCostSummary() {
  if (!props.projectId) return;
  costSummary.value = await costsApi
    .getProjectSummary(props.projectId)
    .catch(() => costSummary.value);
}
async function refreshPaymentSummary() {
  if (!props.projectId) return;
  paymentSummary.value = await paymentsApi
    .getProjectSummary(props.projectId)
    .catch(() => paymentSummary.value);
}
</script>

<template>
  <div>
    <ErrorState v-if="error" :error="error" class="my-4" @retry="loadAll" />

    <template v-else>
      <ProjectActionToolbar v-if="project" :project="project" class="mb-4" @refetch="onChanged" />

      <div class="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div :class="project ? 'xl:col-span-8' : 'xl:col-span-12'">
          <template v-if="project">
            <ProjectHeaderCard :project="project" class="mb-4" />
            <ProjectProgressCard :project="project" class="mb-4" />
          </template>

          <v-card>
            <v-tabs v-model="activeTab" color="primary" align-tabs="start">
              <v-tab value="general">{{ t('projects.tabs.general') }}</v-tab>
              <v-tab value="costs" :disabled="tabsLocked">{{ t('projects.tabs.costs') }}</v-tab>
              <v-tab value="payments" :disabled="tabsLocked">{{ t('projects.tabs.payments') }}</v-tab>
              <v-tab value="progress" :disabled="tabsLocked">{{ t('projects.tabs.progress') }}</v-tab>
            </v-tabs>
            <v-divider />
            <v-window v-model="activeTab">
              <v-window-item value="general" class="pa-4">
                <ProjectGeneralTab
                  v-if="activeTab === 'general'"
                  :id="projectId"
                  :status="project?.status"
                  @saved="onChanged"
                />
              </v-window-item>
              <v-window-item value="costs" class="pa-4">
                <ProjectCostsTab
                  v-if="activeTab === 'costs' && projectId"
                  :project-id="projectId"
                  @changed="refreshCostSummary"
                />
              </v-window-item>
              <v-window-item value="payments" class="pa-4">
                <ProjectPaymentsTab
                  v-if="activeTab === 'payments' && projectId"
                  :project-id="projectId"
                  @changed="refreshPaymentSummary"
                />
              </v-window-item>
              <v-window-item value="progress" class="pa-4">
                <ProjectProgressTab
                  v-if="activeTab === 'progress' && project"
                  :project="project"
                  @refetch="onChanged"
                />
              </v-window-item>
            </v-window>
          </v-card>
        </div>

        <div v-if="project" class="xl:col-span-4">
          <ProjectSummaryPanel
            :project="project"
            :cost-summary="costSummary"
            :payment-summary="paymentSummary"
            class="sticky top-4"
          />
        </div>
      </div>

      <v-alert
        v-if="tabsLocked"
        type="info"
        variant="tonal"
        icon="mdi-information-outline"
        class="mt-4"
      >
        {{ t('projects.saveFirstHint') }}
      </v-alert>
    </template>
  </div>
</template>
