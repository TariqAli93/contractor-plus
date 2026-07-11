<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { t } from '@/i18n';
import { usePaymentForm } from '@/composables/usePaymentForm';
import { useSaveShortcut } from '@/composables/useSaveShortcut';
import { projectsApi } from '@/services/api/projects.api';
import { PaymentMethod } from '@/types/enums';
import AdvancedOptions from '@/components/shared/AdvancedOptions.vue';
import type { ProjectWithContract } from '@/types/project';

const props = defineProps<{ id?: string; initialProjectId?: string }>();
const { form, isEdit, loading, submitting, fieldErrors, load, submit, cancel } = usePaymentForm(
  props.id,
  props.initialProjectId,
);

useSaveShortcut(submit, { enabled: () => !submitting.value });

const projects = ref<ProjectWithContract[]>([]);
const projectsLoading = ref(false);

async function loadProjects() {
  projectsLoading.value = true;
  try {
    const p = await projectsApi.list({
      page: 1,
      pageSize: 100,
      sortBy: 'name',
      sortDir: 'asc',
    });
    projects.value = p.items;
  } finally {
    projectsLoading.value = false;
  }
}

onMounted(async () => {
  await Promise.all([load(), loadProjects()]);
});

const projectOptions = computed(() =>
  projects.value.map((p) => ({
    value: p.id,
    title: p.contract?.contractNumber
      ? `${p.name} - ${p.contract.contractNumber}`
      : p.name,
  })),
);

const methodOptions = computed(() => [
  { value: null as PaymentMethod | null, title: t('payments.method.unset') },
  { value: PaymentMethod.CASH, title: t('payments.method.CASH') },
  { value: PaymentMethod.BANK_TRANSFER, title: t('payments.method.BANK_TRANSFER') },
  { value: PaymentMethod.CHECK, title: t('payments.method.CHECK') },
  { value: PaymentMethod.OTHER, title: t('payments.method.OTHER') },
]);

const requiredRule = (v: unknown) => !!v || t('errors.required');
const positiveRule = (v: number | null | undefined) =>
  (typeof v === 'number' && v > 0) || t('payments.errors.positiveAmount');

// Reveal on edit when any optional payment detail is already filled.
const hasAdvanced = computed(
  () => !!(form.value.method || form.value.reference || form.value.notes),
);
</script>

<template>
  <v-card :loading="loading || projectsLoading">
    <v-form @submit.prevent="submit">
      <v-card-text class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <v-select
          v-model="form.projectId"
          :items="projectOptions"
          :label="t('payments.fields.project')"
          :rules="[requiredRule]"
          :error-messages="fieldErrors.projectId"
          :disabled="isEdit"
          required
        />
        <v-text-field
          v-model.number="form.amount"
          :label="t('payments.fields.amount')"
          :placeholder="t('payments.placeholders.amount')"
          type="number"
          step="0.01"
          min="0"
          :rules="[positiveRule]"
          :error-messages="fieldErrors.amount"
          required
        />
        <v-text-field
          v-model="form.dueDate"
          :label="t('payments.fields.dueDate')"
          type="date"
          :rules="[requiredRule]"
          :error-messages="fieldErrors.dueDate"
          required
        />
        <AdvancedOptions :default-open="hasAdvanced">
          <v-select
            v-model="form.method"
            :items="methodOptions"
            :label="t('payments.fields.method')"
            :error-messages="fieldErrors.method"
            clearable
          />
          <v-text-field
            v-model="form.reference"
            :label="t('payments.fields.reference')"
            :placeholder="t('payments.placeholders.reference')"
            :error-messages="fieldErrors.reference"
            class="md:col-span-2"
          />
          <v-textarea
            v-model="form.notes"
            :label="t('payments.fields.notes')"
            :error-messages="fieldErrors.notes"
            rows="2"
            auto-grow
            class="md:col-span-2"
          />
        </AdvancedOptions>
      </v-card-text>

      <v-divider />

      <v-card-actions class="px-4 py-3">
        <v-btn variant="text" :disabled="submitting" @click="cancel">
          {{ t('common.cancel') }}
        </v-btn>
        <v-spacer />
        <v-btn type="submit" color="primary" variant="flat" :loading="submitting">
          {{ isEdit ? t('common.saveChanges') : t('payments.add') }}
        </v-btn>
      </v-card-actions>
    </v-form>
  </v-card>
</template>
