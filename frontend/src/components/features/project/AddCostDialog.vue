<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { t } from '@/i18n';
import { costsApi } from '@/services/api/costs.api';
import { materialsApi } from '@/services/api/materials.api';
import { useApiError } from '@/composables/useApiError';
import { useToast } from '@/composables/useToast';
import { useSaveShortcut } from '@/composables/useSaveShortcut';
import { CostCategory } from '@/types/enums';
import AdvancedOptions from '@/components/shared/AdvancedOptions.vue';
import type { CreateCostInput } from '@/types/cost';
import type { Material } from '@/types/material';

// Inline create dialog hosted by ProjectCostsTab. Project is fixed by the
// parent — there is no project selector. Material picker is shown only when
// category is MATERIAL; switching to any other category clears materialId
// so the body we send never violates the backend's category/material rule.

const props = defineProps<{
  modelValue: boolean;
  projectId: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'created'): void;
}>();

const { fieldErrors, handle, clear } = useApiError();
const toast = useToast();

interface FormState {
  category: CostCategory;
  materialId: string | null;
  description: string;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  totalAmount: number | null;
  date: string;
  notes: string | null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm(): FormState {
  return {
    category: CostCategory.MATERIAL,
    materialId: null,
    description: '',
    quantity: null,
    unit: null,
    unitPrice: null,
    totalAmount: null,
    date: todayIso(),
    notes: null,
  };
}

const form = ref<FormState>(emptyForm());
const submitting = ref(false);

// Lazy-loaded material picker — only fetched the first time the dialog opens
// so a project page that never opens the dialog pays nothing.
const materials = ref<Material[]>([]);
const materialsLoaded = ref(false);
const materialsLoading = ref(false);
const materialsError = ref(false);

async function ensureMaterials() {
  if (materialsLoaded.value) return;
  materialsLoading.value = true;
  materialsError.value = false;
  try {
    // Minimal request — backend caps `pageSize` at 100; sending higher (or
    // any extra unsupported filter) returns 400 and would crash the dialog.
    // The list is only used to populate a dropdown for MATERIAL costs; richer
    // filtering lives on the dedicated /materials page.
    const res = await materialsApi.list({ page: 1, pageSize: 100 });
    materials.value = res.items;
    materialsLoaded.value = true;
  } catch {
    // Soft-fail: the dialog stays usable for non-MATERIAL categories, and
    // the material selector shows an inline retry. We swallow the original
    // error here so a transient 4xx/5xx never bubbles as an uncaught promise.
    materialsError.value = true;
  } finally {
    materialsLoading.value = false;
  }
}

function retryMaterials() {
  materialsLoaded.value = false;
  void ensureMaterials();
}

// Reset the form whenever the dialog opens; load the material list on first
// open. Closing the dialog mid-edit discards local state — that matches the
// "no optimistic / no draft" stance the page already takes for projects.
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      form.value = emptyForm();
      clear();
      void ensureMaterials();
    }
  },
);

// Copy the selected material's unit + default price into the row if the user
// hasn't typed their own values yet. Pure UX nicety; never overrides input.
watch(
  () => form.value.materialId,
  (id) => {
    if (!id) return;
    const m = materials.value.find((x) => x.id === id);
    if (!m) return;
    if (!form.value.unit) form.value.unit = m.unit;
    if (form.value.unitPrice === null && m.defaultPrice !== null) {
      form.value.unitPrice = Number(m.defaultPrice);
    }
  },
);

// Drop materialId the moment the user moves away from MATERIAL — the backend
// rejects the combination, so the field must not be in the payload at all.
watch(
  () => form.value.category,
  (cat) => {
    if (cat !== CostCategory.MATERIAL) form.value.materialId = null;
  },
);

const categories = computed(() => [
  { value: CostCategory.MATERIAL, title: t('costs.category.MATERIAL') },
  { value: CostCategory.LABOR, title: t('costs.category.LABOR') },
  { value: CostCategory.MACHINERY, title: t('costs.category.MACHINERY') },
  { value: CostCategory.TRANSPORT, title: t('costs.category.TRANSPORT') },
  { value: CostCategory.MISC, title: t('costs.category.MISC') },
]);

const materialOptions = computed(() =>
  materials.value.map((m) => ({ value: m.id, title: `${m.name} (${m.unit})` })),
);

const isMaterialCategory = computed(() => form.value.category === CostCategory.MATERIAL);

// Display-only preview of qty * unitPrice — the backend is the source of
// financial truth. We never auto-fill totalAmount from this; it just lets
// the user sanity-check what will be persisted if they leave the field blank.
const derivedTotal = computed(() => {
  const q = form.value.quantity;
  const p = form.value.unitPrice;
  if (q === null || p === null) return null;
  const v = q * p;
  return Number.isFinite(v) ? v : null;
});

const requiredRule = (v: unknown) => !!v || ' ';
const nonNegRule = (v: number | null | undefined) =>
  v === null || v === undefined || v >= 0 || t('common.error');

function close() {
  if (submitting.value) return;
  emit('update:modelValue', false);
}

async function submit() {
  clear();
  submitting.value = true;
  try {
    const payload: CreateCostInput = {
      projectId: props.projectId,
      category: form.value.category,
      // materialId only when the category allows it; otherwise omit so the
      // server-side cross-field invariant always holds.
      ...(isMaterialCategory.value && form.value.materialId
        ? { materialId: form.value.materialId }
        : {}),
      description: form.value.description,
      quantity: form.value.quantity,
      unit: form.value.unit,
      unitPrice: form.value.unitPrice,
      // Only forward totalAmount when the user explicitly typed one. Blank =
      // let the backend compute from quantity × unitPrice.
      ...(form.value.totalAmount !== null
        ? { totalAmount: form.value.totalAmount }
        : {}),
      date: form.value.date,
      notes: form.value.notes,
    };
    await costsApi.create(payload);
    toast.success(t('projects.costs.costCreated'));
    emit('created');
    emit('update:modelValue', false);
  } catch (e) {
    handle(e);
  } finally {
    submitting.value = false;
  }
}

// Ctrl+S saves while the dialog is open and not mid-submit.
useSaveShortcut(submit, { enabled: () => props.modelValue && !submitting.value });
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    :persistent="submitting"
    max-width="600"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card :loading="materialsLoading">
      <v-card-title>{{ t('projects.costs.addCostTitle') }}</v-card-title>
      <v-form @submit.prevent="submit">
        <v-card-text class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <v-select
            v-model="form.category"
            :items="categories"
            :label="t('costs.fields.category')"
            :rules="[requiredRule]"
            :error-messages="fieldErrors.category"
            required
          />
          <!-- Material picker only renders for MATERIAL costs; when the
               backend list is loading or failed, the field is disabled and
               an inline retry is offered so the dialog never deadlocks. -->
          <div v-if="isMaterialCategory">
            <v-select
              v-model="form.materialId"
              :items="materialOptions"
              :label="t('costs.fields.material')"
              :error-messages="fieldErrors.materialId"
              :loading="materialsLoading"
              :disabled="materialsLoading || materialsError"
              clearable
            />
            <div
              v-if="materialsError"
              class="text-caption text-error mt-1 flex items-center gap-2"
            >
              <v-icon icon="mdi-alert-circle-outline" size="small" />
              <span>{{ t('common.error') }}</span>
              <v-btn
                size="x-small"
                variant="text"
                density="compact"
                @click="retryMaterials"
              >
                {{ t('common.retry') }}
              </v-btn>
            </div>
          </div>
          <v-text-field
            v-model="form.description"
            :label="t('costs.fields.description')"
            :rules="[requiredRule]"
            :error-messages="fieldErrors.description"
            class="md:col-span-2"
            required
          />
          <v-text-field
            v-model.number="form.quantity"
            :label="t('costs.fields.quantity')"
            type="number"
            step="0.001"
            min="0"
            :rules="[nonNegRule]"
            :error-messages="fieldErrors.quantity"
          />
          <v-text-field
            v-model="form.unit"
            :label="t('costs.fields.unit')"
            :error-messages="fieldErrors.unit"
          />
          <v-text-field
            v-model.number="form.unitPrice"
            :label="t('costs.fields.unitPrice')"
            type="number"
            step="0.01"
            min="0"
            :rules="[nonNegRule]"
            :error-messages="fieldErrors.unitPrice"
          />
          <v-text-field
            v-model="form.date"
            :label="t('costs.fields.date')"
            type="date"
            :rules="[requiredRule]"
            :error-messages="fieldErrors.date"
            required
          />
          <AdvancedOptions>
            <v-text-field
              v-model.number="form.totalAmount"
              :label="t('costs.fields.totalAmount')"
              type="number"
              step="0.01"
              min="0"
              :hint="
                derivedTotal !== null && form.totalAmount === null
                  ? t('costs.form.derivedTotalHint', { value: derivedTotal.toFixed(2) })
                  : t('costs.form.totalHint')
              "
              persistent-hint
              :rules="[nonNegRule]"
              :error-messages="fieldErrors.totalAmount"
            />
            <v-textarea
              v-model="form.notes"
              :label="t('costs.fields.notes')"
              :error-messages="fieldErrors.notes"
              rows="2"
              auto-grow
              class="md:col-span-2"
            />
          </AdvancedOptions>
        </v-card-text>

        <v-divider />

        <v-card-actions class="px-4 py-3">
          <v-btn variant="text" :disabled="submitting" @click="close">
            {{ t('common.cancel') }}
          </v-btn>
          <v-spacer />
          <v-btn type="submit" color="primary" variant="flat" :loading="submitting">
            {{ t('costs.add') }}
          </v-btn>
        </v-card-actions>
      </v-form>
    </v-card>
  </v-dialog>
</template>
