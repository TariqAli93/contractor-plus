<script setup lang="ts">
// Guided project creation (roadmap Phase 3 / prompt 6). A multi-step wizard
// over what the backend actually supports for a Project (name, optional linked
// contract, dates, notes) — materials/costs/payments are added afterwards from
// the project's own tabs. "Save as draft" persists the half-filled wizard to
// localStorage (no backend DRAFT status needed) and offers to resume it.
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { t } from '@/i18n';
import PageHeader from '@/components/shared/PageHeader.vue';
import { projectsApi } from '@/services/api/projects.api';
import { contractsApi } from '@/services/api/contracts.api';
import { useApiError } from '@/composables/useApiError';
import { useToast } from '@/composables/useToast';
import { useAccess } from '@/composables/useAccess';
import { useCurrencyFormat } from '@/composables/useCurrencyFormat';
import { RoleName } from '@/types/enums';
import type { CreateProjectInput } from '@/types/project';

const router = useRouter();
const { handle } = useApiError();
const toast = useToast();
const { canAccess } = useAccess();
const { format: money } = useCurrencyFormat();

const DRAFT_KEY = 'contractor-plus.project-draft';

interface WizardState {
  name: string;
  notes: string;
  contractId: string | null;
  startDate: string;
  deliveryDate: string;
}
const emptyState = (): WizardState => ({
  name: '',
  notes: '',
  contractId: null,
  startDate: '',
  deliveryDate: '',
});

function readDraft(): Partial<WizardState> | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Partial<WizardState>) : null;
  } catch {
    return null;
  }
}

const initialDraft = readDraft();
const wizard = reactive<WizardState>({ ...emptyState(), ...(initialDraft ?? {}) });

function draftHasContent(d: Partial<WizardState> | null): boolean {
  return (
    !!d && Boolean(d.name || d.notes || d.contractId || d.startDate || d.deliveryDate)
  );
}
const resumed = ref(draftHasContent(initialDraft));

function persist() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(wizard));
  } catch {
    /* storage unavailable — draft is best-effort */
  }
}
watch(wizard, persist, { deep: true });
function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
}

const step = ref(1);
const stepTitles = computed(() => [
  t('projects.wizard.steps.basics'),
  t('projects.wizard.steps.contract'),
  t('projects.wizard.steps.duration'),
  t('projects.wizard.steps.review'),
]);

const canProceed = computed(() => (step.value === 1 ? wizard.name.trim().length > 0 : true));

// ----- Contract picker (optional link) -----
const contractItems = ref<{ value: string; title: string }[]>([]);
const loadingContracts = ref(false);
const canReadContracts = computed(() =>
  canAccess({
    permissions: ['contracts.read'],
    roles: [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT, RoleName.ENGINEER, RoleName.VIEWER],
  }),
);

async function loadContracts() {
  if (!canReadContracts.value) return;
  loadingContracts.value = true;
  try {
    const res = await contractsApi.list({ pageSize: 50, sortBy: 'createdAt', sortDir: 'desc' });
    contractItems.value = res.items.map((c) => ({
      value: c.id,
      title: `${c.contractNumber} · ${money(c.totalPrice)}`,
    }));
  } catch (e) {
    handle(e);
  } finally {
    loadingContracts.value = false;
  }
}
onMounted(loadContracts);

const selectedContractLabel = computed(
  () => contractItems.value.find((c) => c.value === wizard.contractId)?.title ?? null,
);

// ----- Actions -----
const creating = ref(false);

function startFresh() {
  Object.assign(wizard, emptyState());
  clearDraft();
  resumed.value = false;
  step.value = 1;
}

function saveDraftAndExit() {
  persist();
  toast.success(t('projects.wizard.draftSaved'));
  void router.push('/projects');
}

async function createProject() {
  if (!wizard.name.trim()) {
    step.value = 1;
    return;
  }
  creating.value = true;
  try {
    const payload: CreateProjectInput = {
      name: wizard.name.trim(),
      notes: wizard.notes.trim() || null,
      contractId: wizard.contractId || null,
      startDate: wizard.startDate || null,
      deliveryDate: wizard.deliveryDate || null,
    };
    const project = await projectsApi.create(payload);
    clearDraft();
    toast.success(t('projects.wizard.created'));
    void router.push(`/projects/${project.id}`);
  } catch (e) {
    handle(e);
  } finally {
    creating.value = false;
  }
}

const requiredRule = (v: unknown) => !!v || ' ';
</script>

<template>
  <div class="mx-auto" style="max-width: 900px">
    <PageHeader :title="t('projects.wizard.title')" back="/projects" icon="mdi-folder-plus-outline" />

    <v-alert
      v-if="resumed"
      type="info"
      variant="tonal"
      icon="mdi-content-save-edit-outline"
      class="mb-4"
      closable
      @click:close="resumed = false"
    >
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <span>{{ t('projects.wizard.resumed') }}</span>
        <v-btn size="small" variant="text" @click="startFresh">
          {{ t('projects.wizard.startFresh') }}
        </v-btn>
      </div>
    </v-alert>

    <v-card>
      <v-stepper v-model="step" flat editable>
        <v-stepper-header>
          <template v-for="(title, i) in stepTitles" :key="i">
            <v-stepper-item :value="i + 1" :title="title" :complete="step > i + 1" editable />
            <v-divider v-if="i < stepTitles.length - 1" />
          </template>
        </v-stepper-header>

        <v-stepper-window>
          <!-- 1. Basics -->
          <v-stepper-window-item :value="1">
            <div class="grid grid-cols-1 gap-4 pa-2">
              <v-text-field
                v-model="wizard.name"
                :label="t('projects.fields.name')"
                :placeholder="t('projects.placeholders.name')"
                :rules="[requiredRule]"
                autofocus
                required
              />
              <v-textarea
                v-model="wizard.notes"
                :label="t('projects.fields.notes')"
                rows="3"
                auto-grow
              />
            </div>
          </v-stepper-window-item>

          <!-- 2. Contract (optional) -->
          <v-stepper-window-item :value="2">
            <div class="pa-2">
              <p class="text-medium-emphasis mb-3">{{ t('projects.wizard.contractHint') }}</p>
              <v-autocomplete
                v-model="wizard.contractId"
                :items="contractItems"
                :label="t('projects.wizard.linkContract')"
                item-title="title"
                item-value="value"
                :loading="loadingContracts"
                :no-data-text="t('projects.wizard.noContracts')"
                clearable
                prepend-inner-icon="mdi-file-sign"
              />
            </div>
          </v-stepper-window-item>

          <!-- 3. Duration -->
          <v-stepper-window-item :value="3">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 pa-2">
              <v-text-field
                v-model="wizard.startDate"
                :label="t('projects.fields.startDate')"
                type="date"
              />
              <v-text-field
                v-model="wizard.deliveryDate"
                :label="t('projects.fields.deliveryDate')"
                type="date"
              />
            </div>
          </v-stepper-window-item>

          <!-- 4. Review -->
          <v-stepper-window-item :value="4">
            <div class="pa-2">
              <v-list class="rounded-lg border">
                <v-list-item :title="t('projects.fields.name')" :subtitle="wizard.name || '—'" />
                <v-divider />
                <v-list-item
                  :title="t('projects.wizard.linkContract')"
                  :subtitle="selectedContractLabel ?? t('projects.wizard.noContract')"
                />
                <v-divider />
                <v-list-item
                  :title="t('projects.fields.startDate')"
                  :subtitle="wizard.startDate || '—'"
                />
                <v-divider />
                <v-list-item
                  :title="t('projects.fields.deliveryDate')"
                  :subtitle="wizard.deliveryDate || '—'"
                />
                <v-divider />
                <v-list-item :title="t('projects.fields.notes')" :subtitle="wizard.notes || '—'" />
              </v-list>
              <v-alert type="info" variant="tonal" density="comfortable" class="mt-4">
                {{ t('projects.wizard.reviewHint') }}
              </v-alert>
            </div>
          </v-stepper-window-item>
        </v-stepper-window>
      </v-stepper>

      <v-divider />
      <div class="flex items-center gap-2 pa-4 flex-wrap">
        <v-btn variant="text" prepend-icon="mdi-content-save-outline" @click="saveDraftAndExit">
          {{ t('projects.wizard.saveDraft') }}
        </v-btn>
        <v-spacer />
        <v-btn v-if="step > 1" variant="tonal" @click="step--">
          {{ t('projects.wizard.prev') }}
        </v-btn>
        <v-btn
          v-if="step < 4"
          color="primary"
          variant="flat"
          :disabled="!canProceed"
          @click="step++"
        >
          {{ t('projects.wizard.next') }}
        </v-btn>
        <v-btn
          v-else
          color="primary"
          variant="flat"
          prepend-icon="mdi-check"
          :loading="creating"
          @click="createProject"
        >
          {{ t('projects.wizard.create') }}
        </v-btn>
      </div>
    </v-card>
  </div>
</template>
