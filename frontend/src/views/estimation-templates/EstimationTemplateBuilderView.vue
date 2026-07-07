<script setup lang="ts">
// AI Smart Estimation Template Builder — a 4-step wizard over a server-persisted
// draft (the draft row IS the state; no localStorage). Step 1 talks to the AI
// (generate → clarify → refine), step 2 resolves missing materials, step 3 is an
// editable preview grid (all math server-side), step 4 confirms and saves.
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { t } from '@/i18n';
import PageHeader from '@/components/shared/PageHeader.vue';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';
import DataGrid from '@/components/shared/datagrid/DataGrid.vue';
import type { GridCellCommit, GridColumn, GridRow } from '@/components/shared/datagrid/types';
import { useEstimationTemplateBuilder } from '@/composables/useEstimationTemplateBuilder';
import { useConfirm } from '@/composables/useConfirm';
import { useCurrencyFormat } from '@/composables/useCurrencyFormat';
import type { EstimationDraftItem, EstimationUpdateItemRequest } from '@contractor-plus/shared';

const router = useRouter();
const { confirm } = useConfirm();
const { format: money } = useCurrencyFormat();
const builder = useEstimationTemplateBuilder();

const WASTE_TEMP_ID = '__waste__';

const step = ref(1);
const command = ref('');
const clarifyAnswer = ref('');
const templateName = ref('');
const wasteInput = ref('0');

const stepTitles = computed(() => [
  t('estimation.builder.steps.describe'),
  t('estimation.builder.steps.materials'),
  t('estimation.builder.steps.preview'),
  t('estimation.builder.steps.confirm'),
]);

// Only material-backed lines participate in resolution decisions.
const materialLines = computed<EstimationDraftItem[]>(
  () => builder.draft.value?.items.filter((i) => i.materialNameGuess !== null) ?? [],
);
const pendingLines = computed(() => materialLines.value.filter((i) => i.resolutionStatus === 'PENDING_APPROVAL'));

const canNext = computed(() => {
  if (step.value === 1) return builder.hasDraft.value;
  if (step.value === 2) return !builder.hasPendingMaterials.value;
  return true;
});

const gridRows = computed<GridRow[]>(() => (builder.draft.value?.items ?? []) as unknown as GridRow[]);
const gridColumns = computed<GridColumn[]>(() => [
  { field: 'description', title: t('estimation.columns.description'), type: 'text', editable: false, width: 220 },
  {
    field: 'category',
    title: t('estimation.columns.category'),
    editable: false,
    width: 110,
    format: (v) => t(`estimation.category.${String(v)}`),
  },
  {
    field: 'quantity',
    title: t('estimation.columns.quantity'),
    type: 'number',
    step: 0.001,
    editable: (row) => row.tempId !== WASTE_TEMP_ID,
    width: 120,
    format: (v) => (v == null ? '—' : String(v)),
  },
  {
    field: 'unit',
    title: t('estimation.columns.unit'),
    type: 'text',
    editable: (row) => row.tempId !== WASTE_TEMP_ID && row.resolutionStatus !== 'MATCHED',
    width: 90,
    format: (v) => (v == null ? '—' : String(v)),
  },
  {
    field: 'unitPrice',
    title: t('estimation.columns.unitPrice'),
    type: 'money',
    editable: (row) => row.tempId !== WASTE_TEMP_ID,
    width: 130,
    format: (v) => (v == null ? '—' : money(v as string)),
  },
  {
    field: 'totalAmount',
    title: t('estimation.columns.total'),
    type: 'money',
    editable: false,
    width: 130,
    format: (v) => money(v as string),
  },
]);

async function onGenerate() {
  if (!command.value.trim()) return;
  await builder.generate(command.value.trim());
  syncWaste();
}

async function onAnswerClarification() {
  if (!clarifyAnswer.value.trim()) return;
  await builder.generate(clarifyAnswer.value.trim(), true);
  clarifyAnswer.value = '';
  syncWaste();
}

async function decide(item: EstimationDraftItem, decision: 'approve_create' | 'skip') {
  await builder.resolveMaterials([{ tempId: item.tempId, decision } as never]);
}

async function onCellCommit(payload: GridCellCommit) {
  const patch: EstimationUpdateItemRequest = {};
  if (payload.field === 'quantity') patch.quantity = Number(payload.value);
  else if (payload.field === 'unitPrice') patch.unitPrice = Number(payload.value);
  else if (payload.field === 'description') patch.description = String(payload.value);
  else if (payload.field === 'unit') patch.unit = String(payload.value);
  else return;
  await builder.updateItem(payload.id, patch);
}

async function onWasteChange() {
  const n = Number(wasteInput.value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return;
  await builder.updateWaste(n);
}

function syncWaste() {
  if (builder.draft.value) {
    wasteInput.value = builder.draft.value.wastePercentage;
    if (!templateName.value) templateName.value = builder.draft.value.templateName;
  }
}

async function onConfirm() {
  if (!templateName.value.trim()) return;
  const ok = await confirm({
    title: t('estimation.confirm.title'),
    message: t('estimation.confirm.message'),
    confirmText: t('estimation.confirm.button'),
  });
  if (!ok) return;
  const id = await builder.confirm(templateName.value.trim());
  if (id) void router.push(`/estimation-templates/${id}`);
}

async function onCancel() {
  await builder.cancel();
  void router.push('/estimation-templates');
}

// Load the server-supplied preview (warning + buckets) when entering step 3.
watch(step, (s) => {
  if (s === 3) void builder.loadPreview();
});

const warning = computed(() => builder.preview.value?.warning ?? t('estimation.preview.warning'));
</script>

<template>
  <div class="mx-auto" style="max-width: 1000px">
    <PageHeader
      :title="t('estimation.builder.title')"
      back="/estimation-templates"
      icon="mdi-robot-outline"
      :hint="t('estimation.hint')"
    />

    <v-card>
      <v-stepper v-model="step" flat>
        <v-stepper-header>
          <template v-for="(title, i) in stepTitles" :key="i">
            <v-stepper-item :value="i + 1" :title="title" :complete="step > i + 1" />
            <v-divider v-if="i < stepTitles.length - 1" />
          </template>
        </v-stepper-header>

        <v-stepper-window>
          <!-- 1. Describe -->
          <v-stepper-window-item :value="1">
            <div class="pa-2">
              <v-textarea
                v-model="command"
                :label="t('estimation.command.label')"
                :placeholder="t('estimation.command.placeholder')"
                rows="3"
                auto-grow
                autofocus
                :disabled="builder.processing.value"
              />
              <div class="flex gap-2">
                <v-btn
                  color="primary"
                  variant="flat"
                  prepend-icon="mdi-creation"
                  :loading="builder.processing.value"
                  :disabled="!command.trim()"
                  @click="onGenerate"
                >
                  {{ builder.hasDraft.value ? t('estimation.command.regenerate') : t('estimation.command.submit') }}
                </v-btn>
                <v-chip v-if="builder.draft.value" size="small" variant="tonal" color="info">
                  {{ t('estimation.confidence') }}: {{ Math.round((builder.draft.value.confidence ?? 0) * 100) }}%
                </v-chip>
              </div>

              <v-alert
                v-if="builder.rejectedMessage.value"
                type="warning"
                variant="tonal"
                class="mt-4"
              >
                {{ builder.rejectedMessage.value }}
              </v-alert>

              <!-- Clarification loop -->
              <v-alert
                v-if="builder.needsClarification.value && builder.clarification.value"
                type="info"
                variant="tonal"
                class="mt-4"
                icon="mdi-help-circle-outline"
              >
                <p class="mb-2 font-medium">{{ builder.clarification.value.question }}</p>
                <div class="flex gap-2 items-center flex-wrap">
                  <v-text-field
                    v-model="clarifyAnswer"
                    :placeholder="t('estimation.clarification.answerPlaceholder')"
                    density="compact"
                    hide-details
                    style="min-width: 240px"
                    @keydown.enter="onAnswerClarification"
                  />
                  <v-btn
                    color="primary"
                    size="small"
                    :loading="builder.processing.value"
                    @click="onAnswerClarification"
                  >
                    {{ t('estimation.clarification.answer') }}
                  </v-btn>
                </div>
              </v-alert>

              <v-alert
                v-if="builder.draft.value"
                type="success"
                variant="tonal"
                density="comfortable"
                class="mt-4"
              >
                {{ builder.draft.value.templateName }}
              </v-alert>
            </div>
          </v-stepper-window-item>

          <!-- 2. Materials -->
          <v-stepper-window-item :value="2">
            <div class="pa-2">
              <p class="text-medium-emphasis mb-3">{{ t('estimation.materials.pendingHint') }}</p>
              <v-alert
                v-if="materialLines.length === 0 || pendingLines.length === 0"
                type="success"
                variant="tonal"
                density="comfortable"
                class="mb-3"
              >
                {{ t('estimation.materials.noneNeeded') }}
              </v-alert>

              <v-list class="rounded-lg border">
                <template v-for="item in materialLines" :key="item.tempId">
                  <v-list-item :title="item.description" :subtitle="item.materialNameGuess ?? ''">
                    <template #append>
                      <div class="flex gap-2 items-center">
                        <v-chip
                          v-if="item.resolutionStatus === 'MATCHED'"
                          size="small"
                          color="success"
                          variant="tonal"
                        >
                          {{ t('estimation.materials.matched') }}
                        </v-chip>
                        <v-chip
                          v-else-if="item.resolutionStatus === 'APPROVED_CREATE'"
                          size="small"
                          color="info"
                          variant="tonal"
                        >
                          {{ t('estimation.materials.created') }}
                        </v-chip>
                        <v-chip
                          v-else-if="item.resolutionStatus === 'SKIPPED'"
                          size="small"
                          variant="tonal"
                        >
                          {{ t('estimation.materials.skipped') }}
                        </v-chip>
                        <template v-else>
                          <v-btn
                            size="small"
                            color="primary"
                            variant="tonal"
                            prepend-icon="mdi-plus"
                            :loading="builder.processing.value"
                            @click="decide(item, 'approve_create')"
                          >
                            {{ t('estimation.materials.create') }}
                          </v-btn>
                          <v-btn
                            size="small"
                            variant="text"
                            :loading="builder.processing.value"
                            @click="decide(item, 'skip')"
                          >
                            {{ t('estimation.materials.skip') }}
                          </v-btn>
                        </template>
                      </div>
                    </template>
                  </v-list-item>
                  <v-divider />
                </template>
              </v-list>
            </div>
          </v-stepper-window-item>

          <!-- 3. Preview -->
          <v-stepper-window-item :value="3">
            <div class="pa-2">
              <v-alert type="warning" variant="tonal" density="comfortable" class="mb-3">
                {{ warning }}
              </v-alert>

              <div class="flex items-center gap-3 mb-3 flex-wrap">
                <v-text-field
                  v-model="wasteInput"
                  :label="t('estimation.waste')"
                  type="number"
                  density="compact"
                  hide-details
                  style="max-width: 160px"
                  @change="onWasteChange"
                />
              </div>

              <DataGrid
                v-if="builder.draft.value"
                :rows="gridRows"
                :columns="gridColumns"
                row-key="tempId"
                :editable="true"
                height="420px"
                @cell-commit="onCellCommit"
              />

              <div class="flex items-center justify-end gap-3 mt-3 pe-2">
                <span class="font-medium">{{ t('estimation.total') }}</span>
                <span class="font-medium text-h6">
                  <MoneyDisplay :amount="builder.draft.value?.estimatedTotal ?? '0'" />
                </span>
              </div>
            </div>
          </v-stepper-window-item>

          <!-- 4. Confirm -->
          <v-stepper-window-item :value="4">
            <div class="pa-2">
              <v-text-field
                v-model="templateName"
                :label="t('estimation.confirm.templateName')"
                autofocus
              />
              <v-list class="rounded-lg border">
                <v-list-item :title="t('estimation.listColumns.projectType')" :subtitle="builder.draft.value?.projectType ?? '—'" />
                <v-divider />
                <v-list-item
                  :title="t('estimation.listColumns.area')"
                  :subtitle="builder.draft.value?.areaValue ? `${builder.draft.value.areaValue} ${builder.draft.value.areaUnit ?? ''}` : '—'"
                />
                <v-divider />
                <v-list-item :title="t('estimation.waste')" :subtitle="`${builder.draft.value?.wastePercentage ?? '0'}%`" />
                <v-divider />
                <v-list-item :title="t('estimation.total')">
                  <template #subtitle>
                    <MoneyDisplay :amount="builder.draft.value?.estimatedTotal ?? '0'" />
                  </template>
                </v-list-item>
              </v-list>
              <v-alert type="warning" variant="tonal" density="comfortable" class="mt-3">
                {{ warning }}
              </v-alert>
            </div>
          </v-stepper-window-item>
        </v-stepper-window>
      </v-stepper>

      <v-divider />
      <div class="flex items-center gap-2 pa-4 flex-wrap">
        <v-btn variant="text" color="error" prepend-icon="mdi-close" @click="onCancel">
          {{ t('estimation.cancel') }}
        </v-btn>
        <v-spacer />
        <v-btn v-if="step > 1" variant="tonal" @click="step--">{{ t('estimation.prev') }}</v-btn>
        <v-btn
          v-if="step < 4"
          color="primary"
          variant="flat"
          :disabled="!canNext"
          @click="step++"
        >
          {{ t('estimation.next') }}
        </v-btn>
        <v-btn
          v-else
          color="primary"
          variant="flat"
          prepend-icon="mdi-content-save-check-outline"
          :loading="builder.processing.value"
          :disabled="!templateName.trim()"
          @click="onConfirm"
        >
          {{ t('estimation.confirm.button') }}
        </v-btn>
      </div>
    </v-card>
  </div>
</template>
