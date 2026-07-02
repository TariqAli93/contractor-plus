<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { t } from '@/i18n';
import { useCostForm } from '@/composables/useCostForm';
import { useSaveShortcut } from '@/composables/useSaveShortcut';
import { projectsApi } from '@/services/api/projects.api';
import { materialsApi } from '@/services/api/materials.api';
import { CostCategory } from '@/types/enums';
import type { ProjectWithContract } from '@/types/project';
import type { Material } from '@/types/material';

const props = defineProps<{ id?: string; initialProjectId?: string }>();
const { form, isEdit, loading, submitting, fieldErrors, load, submit, cancel } = useCostForm(
  props.id,
  props.initialProjectId,
);

useSaveShortcut(submit, { enabled: () => !submitting.value });

// Lightweight pickers — both endpoints are cheap to call once and small
// enough that we don't need autocomplete-with-fetch.
const projects = ref<ProjectWithContract[]>([]);
const projectsLoading = ref(false);
const materials = ref<Material[]>([]);
const materialsLoading = ref(false);

async function loadPickers() {
  projectsLoading.value = true;
  materialsLoading.value = true;
  try {
    // Backend caps pageSize at 100 — pageSize: 200 returns 400. Both pickers
    // populate dropdowns only; the dedicated /materials and /projects pages
    // remain the place for paging through the full lists.
    const [p, m] = await Promise.all([
      projectsApi.list({ page: 1, pageSize: 100, sortBy: 'name', sortDir: 'asc' }),
      materialsApi.list({ page: 1, pageSize: 100, sortBy: 'name', sortDir: 'asc' }),
    ]);
    projects.value = p.items;
    materials.value = m.items;
  } finally {
    projectsLoading.value = false;
    materialsLoading.value = false;
  }
}

onMounted(async () => {
  await Promise.all([load(), loadPickers()]);
});

const categories = computed(() => [
  { value: CostCategory.MATERIAL, title: t('costs.category.MATERIAL') },
  { value: CostCategory.LABOR, title: t('costs.category.LABOR') },
  { value: CostCategory.MACHINERY, title: t('costs.category.MACHINERY') },
  { value: CostCategory.TRANSPORT, title: t('costs.category.TRANSPORT') },
  { value: CostCategory.MISC, title: t('costs.category.MISC') },
]);

const projectOptions = computed(() =>
  projects.value.map((p) => ({
    value: p.id,
    title: p.contract?.contractNumber
      ? `${p.name} — ${p.contract.contractNumber}`
      : p.name,
  })),
);

const materialOptions = computed(() => [
  { value: null as string | null, title: t('costs.form.noMaterial') },
  ...materials.value.map((m) => ({ value: m.id, title: `${m.name} (${m.unit})` })),
]);

// When the user picks a material, copy its unit + default price into the row
// if they haven't typed their own values yet. Pure UX nicety; never overrides
// existing input.
watch(
  () => form.value.materialId,
  (newId) => {
    if (!newId) return;
    const m = materials.value.find((x) => x.id === newId);
    if (!m) return;
    if (!form.value.unit) form.value.unit = m.unit;
    if (form.value.unitPrice === null && m.defaultPrice !== null) {
      form.value.unitPrice = Number(m.defaultPrice);
    }
  },
);

// Show derived total inline so the user can confirm what we'll send.
const derivedTotal = computed(() => {
  const q = form.value.quantity;
  const p = form.value.unitPrice;
  if (q !== null && p !== null) return q * p;
  return null;
});

const requiredRule = (v: unknown) => !!v || ' ';
const nonNegRule = (v: number | null | undefined) =>
  v === null || v === undefined || v >= 0 || t('common.error');
</script>

<template>
  <v-card :loading="loading || projectsLoading || materialsLoading">
    <v-form @submit.prevent="submit">
      <v-card-text class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <v-select
          v-model="form.projectId"
          :items="projectOptions"
          :label="t('costs.fields.project')"
          :rules="[requiredRule]"
          :error-messages="fieldErrors.projectId"
          :disabled="isEdit"
          required
        />
        <v-select
          v-model="form.category"
          :items="categories"
          :label="t('costs.fields.category')"
          :rules="[requiredRule]"
          :error-messages="fieldErrors.category"
          required
        />
        <v-text-field
          v-model="form.description"
          :label="t('costs.fields.description')"
          :placeholder="t('costs.placeholders.description')"
          :rules="[requiredRule]"
          :error-messages="fieldErrors.description"
          class="md:col-span-2"
          required
        />
        <v-select
          v-model="form.materialId"
          :items="materialOptions"
          :label="t('costs.fields.material')"
          :error-messages="fieldErrors.materialId"
          clearable
        />
        <v-text-field
          v-model="form.unit"
          :label="t('costs.fields.unit')"
          :placeholder="t('costs.placeholders.unit')"
          :error-messages="fieldErrors.unit"
        />
        <v-text-field
          v-model.number="form.quantity"
          :label="t('costs.fields.quantity')"
          :placeholder="t('costs.placeholders.quantity')"
          type="number"
          step="0.001"
          min="0"
          :rules="[nonNegRule]"
          :error-messages="fieldErrors.quantity"
        />
        <v-text-field
          v-model.number="form.unitPrice"
          :label="t('costs.fields.unitPrice')"
          :placeholder="t('costs.placeholders.unitPrice')"
          type="number"
          step="0.01"
          min="0"
          :rules="[nonNegRule]"
          :error-messages="fieldErrors.unitPrice"
        />
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
        <v-text-field
          v-model="form.date"
          :label="t('costs.fields.date')"
          type="date"
          :rules="[requiredRule]"
          :error-messages="fieldErrors.date"
          required
        />
        <v-textarea
          v-model="form.notes"
          :label="t('costs.fields.notes')"
          :error-messages="fieldErrors.notes"
          rows="2"
          auto-grow
          class="md:col-span-2"
        />
      </v-card-text>

      <v-divider />

      <v-card-actions class="px-4 py-3">
        <v-btn variant="text" :disabled="submitting" @click="cancel">
          {{ t('common.cancel') }}
        </v-btn>
        <v-spacer />
        <v-btn type="submit" color="primary" variant="flat" :loading="submitting">
          {{ isEdit ? t('common.update') : t('common.create') }}
        </v-btn>
      </v-card-actions>
    </v-form>
  </v-card>
</template>
