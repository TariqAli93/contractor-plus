<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { t } from '@/i18n';
import { projectsApi } from '@/services/api/projects.api';
import { costsApi } from '@/services/api/costs.api';
import { paymentsApi } from '@/services/api/payments.api';
import { useApiError } from '@/composables/useApiError';
import type { ProjectWithContract } from '@/types/project';
import type { ProjectCostSummary } from '@/types/cost';
import type { ProjectPaymentSummary } from '@/types/payment';
import ErrorState from '@/components/shared/ErrorState.vue';
import ProjectActionToolbar from '@/components/features/project/ProjectActionToolbar.vue';
import ProjectHeaderCard from '@/components/features/project/ProjectHeaderCard.vue';
import ProjectProgressCard from '@/components/features/project/ProjectProgressCard.vue';
import ProjectSummaryPanel from '@/components/features/project/ProjectSummaryPanel.vue';
import ProjectGeneralTab from '@/components/features/project/ProjectGeneralTab.vue';
import ProjectCostsTab from '@/components/features/project/ProjectCostsTab.vue';
import ProjectPaymentsTab from '@/components/features/project/ProjectPaymentsTab.vue';
import ProjectProgressTab from '@/components/features/project/ProjectProgressTab.vue';

const route = useRoute();
const { handle } = useApiError();

const projectId = computed(() => {
  const id = route.params.id;
  return typeof id === 'string' ? id : undefined;
});

const heading = computed(() =>
  projectId.value ? t('projects.edit') : t('projects.new'),
);

const project = ref<ProjectWithContract | null>(null);
const costSummary = ref<ProjectCostSummary | null>(null);
const paymentSummary = ref<ProjectPaymentSummary | null>(null);
const loading = ref(false);
const error = ref<unknown>(null);

async function loadAll() {
  if (!projectId.value) {
    project.value = null;
    costSummary.value = null;
    paymentSummary.value = null;
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    const [p, cs, ps] = await Promise.all([
      projectsApi.get(projectId.value),
      costsApi.getProjectSummary(projectId.value).catch(() => null),
      paymentsApi.getProjectSummary(projectId.value).catch(() => null),
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

onMounted(loadAll);
watch(projectId, loadAll);

// Narrow refetches used by the tab dialogs. They re-pull only the summary
// that ProjectSummaryPanel reads from, so a new cost/payment shows up in the
// side panel without a full project refetch and without a route navigation.
async function refreshCostSummary() {
  if (!projectId.value) return;
  costSummary.value = await costsApi
    .getProjectSummary(projectId.value)
    .catch(() => costSummary.value);
}

async function refreshPaymentSummary() {
  if (!projectId.value) return;
  paymentSummary.value = await paymentsApi
    .getProjectSummary(projectId.value)
    .catch(() => paymentSummary.value);
}

type TabKey = 'general' | 'costs' | 'payments' | 'progress';
const activeTab = ref<TabKey>('general');

const tabsLocked = computed(() => !projectId.value);
</script>

<template>
  <div>
    <div class="flex items-center gap-2 mb-4">
      <v-btn icon="mdi-arrow-right" variant="text" to="/projects" />
      <h1 class="text-h5">{{ heading }}</h1>
    </div>

    <ErrorState v-if="error" :error="error" class="my-4" @retry="loadAll" />

    <template v-else>
      <ProjectActionToolbar
        v-if="project"
        :project="project"
        class="mb-4"
        @refetch="loadAll"
      />

      <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div :class="project ? 'lg:col-span-9' : 'lg:col-span-12'">
          <template v-if="project">
            <ProjectHeaderCard :project="project" class="mb-4" />
            <ProjectProgressCard :project="project" class="mb-4" />
          </template>

          <v-card>
            <v-tabs v-model="activeTab" color="primary" align-tabs="start">
              <v-tab value="general">{{ t('projects.tabs.general') }}</v-tab>
              <v-tab value="costs" :disabled="tabsLocked">
                {{ t('projects.tabs.costs') }}
              </v-tab>
              <v-tab value="payments" :disabled="tabsLocked">
                {{ t('projects.tabs.payments') }}
              </v-tab>
              <v-tab value="progress" :disabled="tabsLocked">
                {{ t('projects.tabs.progress') }}
              </v-tab>
            </v-tabs>
            <v-divider />
            <v-window v-model="activeTab">
              <v-window-item value="general" class="pa-4">
                <ProjectGeneralTab
                  v-if="activeTab === 'general'"
                  :id="projectId"
                  :status="project?.status"
                  @saved="loadAll"
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
                  @refetch="loadAll"
                />
              </v-window-item>
            </v-window>
          </v-card>
        </div>

        <div v-if="project" class="lg:col-span-3">
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
