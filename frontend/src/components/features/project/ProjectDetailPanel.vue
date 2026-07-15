<script setup lang="ts">
// The full project detail surface (header, progress, tabbed editor, side
// summary), driven by a `projectId` PROP rather than the route. Used both by
// the full-page ProjectEditView and the master-detail ProjectsWorkspaceView.
// Emits `changed` after any mutation that alters list-visible fields (status,
// name, dates, progress) so a parent list can refresh.
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { t } from '@/i18n';
import { projectsApi } from '@/services/api/projects.api';
import { costsApi } from '@/services/api/costs.api';
import { paymentsApi } from '@/services/api/payments.api';
import { useApiError } from '@/composables/useApiError';
import { ApiError } from '@/types/api';
import type { ProjectWithContract } from '@/types/project';
import type { ProjectCostSummary } from '@/types/cost';
import type { ProjectPaymentSummary } from '@/types/payment';
import ErrorState from '@/components/shared/ErrorState.vue';
import EmptyState from '@/components/shared/EmptyState.vue';
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
const notFound = ref(false);

type TabKey = 'general' | 'costs' | 'payments' | 'progress';
const activeTab = ref<TabKey>('general');
const tabsLocked = computed(() => !props.projectId);

// Initial load blanks to a skeleton; a refetch of the already-loaded project
// keeps its content under a thin busy bar rather than flashing empty.
const initialLoading = computed(() => loading.value && !project.value && !notFound.value);
const refetching = computed(() => loading.value && !!project.value);

// Monotonic token: only the newest load may write state. Guards the
// master-detail case where a slow response for one project would otherwise
// clobber a newer selection.
let loadSeq = 0;

async function loadAll() {
  error.value = null;
  notFound.value = false;
  if (!props.projectId) {
    project.value = null;
    costSummary.value = null;
    paymentSummary.value = null;
    activeTab.value = 'general';
    loading.value = false;
    return;
  }
  // Switching to a different project: drop the previous one so the skeleton
  // shows, never the wrong project's header under a loading bar.
  if (project.value && project.value.id !== props.projectId) {
    project.value = null;
    costSummary.value = null;
    paymentSummary.value = null;
  }
  const seq = ++loadSeq;
  loading.value = true;
  try {
    const [p, cs, ps] = await Promise.all([
      projectsApi.get(props.projectId),
      costsApi.getProjectSummary(props.projectId).catch(() => null),
      paymentsApi.getProjectSummary(props.projectId).catch(() => null),
    ]);
    if (seq !== loadSeq) return; // a newer load superseded this one
    project.value = p;
    costSummary.value = cs;
    paymentSummary.value = ps;
  } catch (e) {
    if (seq !== loadSeq) return;
    // A missing/deleted project is not a retriable failure - show a distinct
    // not-found state with a real way out, and skip the error toast.
    if (e instanceof ApiError && e.statusCode === 404) {
      notFound.value = true;
      project.value = null;
      costSummary.value = null;
      paymentSummary.value = null;
    } else {
      error.value = e;
      handle(e);
    }
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

// Reload whenever the selected project changes (and on first render).
watch(() => props.projectId, loadAll, { immediate: true });

// A load resolving after unmount must not touch refs.
onBeforeUnmount(() => {
  loadSeq++;
});

// A lifecycle/identity mutation: reload, then tell the parent list to refresh.
async function onChanged() {
  await loadAll();
  emit('changed');
}

// Narrow refetches for the tab dialogs - only the side-panel summaries, no
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

    <!-- A deleted/invalid project: distinct from a retriable failure, with a
         real way out rather than a retry that would only fail again. -->
    <EmptyState
      v-else-if="notFound"
      :title="t('projects.notFound')"
      :description="t('projects.notFoundHint')"
      icon="mdi-file-remove-outline"
      class="my-4"
    >
      <v-btn color="primary" variant="tonal" prepend-icon="mdi-arrow-right" to="/projects">
        {{ t('projects.backToList') }}
      </v-btn>
    </EmptyState>

    <!-- Initial load: a skeleton in the shape of the detail card, not a blank. -->
    <v-card
      v-else-if="initialLoading"
      role="status"
      aria-busy="true"
      :aria-label="t('projects.loading')"
      class="pa-2"
    >
      <v-skeleton-loader type="heading, sentences@2, divider, chip@4, divider, paragraph" />
    </v-card>

    <template v-else>
      <!-- Refetch of the already-loaded project (after a mutation): a thin busy
           bar keeps the content in place instead of flashing empty. -->
      <v-progress-linear
        v-if="refetching"
        indeterminate
        color="primary"
        rounded
        class="mb-3"
        :aria-label="t('projects.loading')"
      />

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
