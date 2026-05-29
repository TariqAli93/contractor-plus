<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { paymentsApi } from '@/services/api/payments.api';
import { useApiError } from '@/composables/useApiError';
import { useToast } from '@/composables/useToast';
import { PaymentMethod } from '@/types/enums';
import type { CreatePaymentInput } from '@/types/payment';

// Inline create dialog hosted by ProjectPaymentsTab. Project is fixed by the
// parent — no project selector, no paymentDate. The status starts as PENDING
// on the backend; marking the payment paid is a separate action elsewhere.

const props = defineProps<{
  modelValue: boolean;
  projectId: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'created'): void;
}>();

const { t } = useI18n();
const { fieldErrors, handle, clear } = useApiError();
const toast = useToast();

interface FormState {
  amount: number | null;
  dueDate: string;
  method: PaymentMethod | null;
  reference: string | null;
  notes: string | null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm(): FormState {
  return {
    amount: null,
    dueDate: todayIso(),
    method: null,
    reference: null,
    notes: null,
  };
}

const form = ref<FormState>(emptyForm());
const submitting = ref(false);

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      form.value = emptyForm();
      clear();
    }
  },
);

const methodOptions = computed(() => [
  { value: null as PaymentMethod | null, title: t('payments.method.unset') },
  { value: PaymentMethod.CASH, title: t('payments.method.CASH') },
  { value: PaymentMethod.BANK_TRANSFER, title: t('payments.method.BANK_TRANSFER') },
  { value: PaymentMethod.CHECK, title: t('payments.method.CHECK') },
  { value: PaymentMethod.OTHER, title: t('payments.method.OTHER') },
]);

const requiredRule = (v: unknown) => !!v || ' ';
const positiveRule = (v: number | null | undefined) =>
  (typeof v === 'number' && v > 0) || t('payments.errors.positiveAmount');

function close() {
  if (submitting.value) return;
  emit('update:modelValue', false);
}

async function submit() {
  clear();
  submitting.value = true;
  try {
    const payload: CreatePaymentInput = {
      projectId: props.projectId,
      amount: form.value.amount ?? 0,
      dueDate: form.value.dueDate,
      method: form.value.method,
      reference: form.value.reference,
      notes: form.value.notes,
    };
    await paymentsApi.create(payload);
    toast.success(t('projects.payments.paymentCreated'));
    emit('created');
    emit('update:modelValue', false);
  } catch (e) {
    handle(e);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    :persistent="submitting"
    max-width="600"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>{{ t('projects.payments.addPaymentTitle') }}</v-card-title>
      <v-form @submit.prevent="submit">
        <v-card-text class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <v-text-field
            v-model.number="form.amount"
            :label="t('payments.fields.amount')"
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
            :error-messages="fieldErrors.reference"
          />
          <v-textarea
            v-model="form.notes"
            :label="t('payments.fields.notes')"
            :error-messages="fieldErrors.notes"
            rows="2"
            auto-grow
            class="md:col-span-2"
          />
        </v-card-text>

        <v-divider />

        <v-card-actions class="px-4 py-3">
          <v-btn variant="text" :disabled="submitting" @click="close">
            {{ t('common.cancel') }}
          </v-btn>
          <v-spacer />
          <v-btn type="submit" color="primary" variant="flat" :loading="submitting">
            {{ t('common.create') }}
          </v-btn>
        </v-card-actions>
      </v-form>
    </v-card>
  </v-dialog>
</template>
