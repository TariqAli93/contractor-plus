<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { t } from '@/i18n';
import { useContractForm } from '@/composables/useContractForm';
import { customersApi } from '@/services/api/customers.api';
import { templatesApi } from '@/services/api/templates.api';
import { ContractStatus } from '@/types/enums';
import type { Customer } from '@/types/customer';
import type { BuildingTemplate } from '@/types/template';

const props = defineProps<{
  id?: string;
  status?: ContractStatus;
}>();

const emit = defineEmits<{ saved: [] }>();

const { form, isEdit, loading, submitting, fieldErrors, load, submit, cancel } =
  useContractForm(props.id);

// Per-source state: each selector loads independently so a single API
// failure can never white-screen the form. Backend's
// paginationQuerySchema caps pageSize at 100 — sending more returns 400.
// We use the minimal {page, pageSize} shape (no isActive/sortBy/sortDir)
// per the stabilization brief; client-side sort happens below.
const PICKER_PAGE_SIZE = 100;

const customers = ref<Customer[]>([]);
const customersLoading = ref(false);
const customersError = ref<unknown>(null);

const templates = ref<BuildingTemplate[]>([]);
const templatesLoading = ref(false);
const templatesError = ref<unknown>(null);

const sortedCustomers = computed(() =>
  [...customers.value].sort((a, b) => a.name.localeCompare(b.name)),
);
const sortedTemplates = computed(() =>
  [...templates.value].sort((a, b) => a.name.localeCompare(b.name)),
);

async function loadCustomers(): Promise<void> {
  customersLoading.value = true;
  customersError.value = null;
  try {
    const res = await customersApi.list({ page: 1, pageSize: PICKER_PAGE_SIZE });
    customers.value = res.items;
  } catch (err) {
    customersError.value = err;
    customers.value = [];
  } finally {
    customersLoading.value = false;
  }
}

async function loadTemplates(): Promise<void> {
  templatesLoading.value = true;
  templatesError.value = null;
  try {
    const res = await templatesApi.list({ page: 1, pageSize: PICKER_PAGE_SIZE });
    templates.value = res.items;
  } catch (err) {
    templatesError.value = err;
    templates.value = [];
  } finally {
    templatesLoading.value = false;
  }
}

onMounted(() => {
  // Promise.allSettled — any single failure (load contract, customers,
  // or templates) leaves the others usable. The form is operational with
  // partial data; selectors render an inline retry on individual failures.
  void Promise.allSettled([load(), loadCustomers(), loadTemplates()]);
});

// DRAFT: all editable. APPROVED: only contractNumber, customerId, notes.
// CANCELLED: read-only entirely.
const financialLocked = computed(
  () => props.status !== undefined && props.status !== ContractStatus.DRAFT,
);
const allLocked = computed(() => props.status === ContractStatus.CANCELLED);

async function handleSubmit() {
  await submit();
  emit('saved');
}

const requiredRule = (v: unknown) => !!v || ' ';
const positiveRule = (v: unknown) =>
  v !== null && v !== undefined && v !== '' && Number(v) > 0 || t('contracts.errors.positive');
const minFloorsRule = (v: unknown) => (Number.isInteger(Number(v)) && Number(v) >= 1) || ' ';
const nonNegRule = (v: unknown) =>
  v === null || v === undefined || v === '' || Number(v) >= 0 || t('contracts.errors.nonNegative');
const percentageRule = (v: unknown) => {
  if (v === null || v === undefined || v === '') return true;
  const n = Number(v);
  return (Number.isFinite(n) && n >= 0 && n <= 100) || t('contracts.errors.percentage');
};
</script>

<template>
  <div :class="{ 'opacity-60 pointer-events-none': loading }">
    <v-alert
      v-if="financialLocked && !allLocked"
      type="info"
      variant="tonal"
      icon="mdi-lock-outline"
      class="mb-4"
    >
      {{ t('contracts.locked.approved') }}
    </v-alert>
    <v-alert
      v-if="allLocked"
      type="warning"
      variant="tonal"
      icon="mdi-cancel"
      class="mb-4"
    >
      {{ t('contracts.locked.cancelled') }}
    </v-alert>

    <v-form @submit.prevent="handleSubmit">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <v-text-field
          v-model="form.contractNumber"
          :label="t('contracts.fields.contractNumber')"
          :rules="[requiredRule]"
          :error-messages="fieldErrors.contractNumber"
          :disabled="allLocked"
          required
        />
        <div>
          <v-autocomplete
            v-model="form.customerId"
            :items="sortedCustomers"
            item-title="name"
            item-value="id"
            :label="t('contracts.fields.customer')"
            :rules="[requiredRule]"
            :error-messages="fieldErrors.customerId"
            :disabled="allLocked || customersLoading || !!customersError"
            :loading="customersLoading"
            required
          />
          <div
            v-if="customersError"
            class="text-caption text-error mt-1 flex items-center gap-2"
          >
            <v-icon icon="mdi-alert-circle-outline" size="small" />
            <span>{{ t('contracts.errors.failedToLoadCustomers') }}</span>
            <v-btn
              size="x-small"
              variant="text"
              density="compact"
              :loading="customersLoading"
              @click="loadCustomers"
            >
              {{ t('common.retry') }}
            </v-btn>
          </div>
        </div>
        <div>
          <v-autocomplete
            v-model="form.templateId"
            :items="sortedTemplates"
            item-title="name"
            item-value="id"
            :label="t('contracts.fields.template')"
            :error-messages="fieldErrors.templateId"
            :disabled="financialLocked || templatesLoading || !!templatesError"
            :loading="templatesLoading"
            clearable
          />
          <div
            v-if="templatesError"
            class="text-caption text-error mt-1 flex items-center gap-2"
          >
            <v-icon icon="mdi-alert-circle-outline" size="small" />
            <span>{{ t('contracts.errors.failedToLoadTemplates') }}</span>
            <v-btn
              size="x-small"
              variant="text"
              density="compact"
              :loading="templatesLoading"
              @click="loadTemplates"
            >
              {{ t('common.retry') }}
            </v-btn>
          </div>
        </div>
        <v-text-field
          v-model.number="form.floors"
          :label="t('contracts.fields.floors')"
          type="number"
          min="1"
          step="1"
          :rules="[minFloorsRule]"
          :error-messages="fieldErrors.floors"
          :disabled="financialLocked"
          required
        />
        <v-text-field
          v-model.number="form.buildingArea"
          :label="t('contracts.fields.buildingArea')"
          type="number"
          min="0"
          step="0.01"
          suffix="m²"
          :rules="[positiveRule]"
          :error-messages="fieldErrors.buildingArea"
          :disabled="financialLocked"
          required
        />
        <v-text-field
          v-model.number="form.meterPrice"
          :label="t('contracts.fields.meterPrice')"
          type="number"
          min="0"
          step="0.01"
          :rules="[nonNegRule]"
          :error-messages="fieldErrors.meterPrice"
          :disabled="financialLocked"
          required
        />
        <v-text-field
          v-model.number="form.expectedProfitMargin"
          :label="t('contracts.fields.expectedProfitMargin')"
          type="number"
          min="0"
          max="100"
          step="0.01"
          suffix="%"
          :rules="[percentageRule]"
          :error-messages="fieldErrors.expectedProfitMargin"
          :disabled="financialLocked"
        />
        <div class="md:col-span-2">
          <v-textarea
            v-model="form.notes"
            :label="t('contracts.fields.notes')"
            :error-messages="fieldErrors.notes"
            :disabled="allLocked"
            rows="3"
            auto-grow
          />
        </div>
      </div>

      <div v-if="!allLocked" class="flex items-center pt-4">
        <v-btn variant="text" :disabled="submitting" @click="cancel">
          {{ t('common.cancel') }}
        </v-btn>
        <v-spacer />
        <v-btn type="submit" color="primary" variant="flat" :loading="submitting">
          {{ isEdit ? t('common.update') : t('common.create') }}
        </v-btn>
      </div>
    </v-form>
  </div>
</template>
