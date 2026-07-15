<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { t } from '@/i18n';
import { paymentsApi } from '@/services/api/payments.api';
import { useApiError } from '@/composables/useApiError';
import { useToast } from '@/composables/useToast';
import { useSaveShortcut } from '@/composables/useSaveShortcut';
import { PaymentMethod } from '@/types/enums';
import AdvancedOptions from '@/components/shared/AdvancedOptions.vue';
import type { CreatePaymentInput, MarkPaidBody } from '@/types/payment';

// Inline create dialog hosted by ProjectPaymentsTab. Project is fixed by the
// parent. The "already paid today" toggle collapses the old two-step flow
// (create PENDING → later mark paid) into one: on submit we create the payment
// and, when toggled, immediately record it as paid in a single interaction.

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
  amount: number | null;
  dueDate: string;
  method: PaymentMethod | null;
  reference: string | null;
  notes: string | null;
  alreadyPaid: boolean;
  paymentDate: string;
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
    alreadyPaid: false,
    paymentDate: todayIso(),
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
  // Enter in any field fires the form submit regardless of the button's loading
  // state, so guard against a second create while the first is in flight.
  if (submitting.value) return;
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
    const created = await paymentsApi.create(payload);

    if (form.value.alreadyPaid) {
      // Record the receipt now - same data the standalone mark-paid step needs.
      const body: MarkPaidBody = { paymentDate: form.value.paymentDate };
      if (form.value.method) body.method = form.value.method;
      if (form.value.reference) body.reference = form.value.reference;
      await paymentsApi.markPaid(created.id, body);
      toast.success(t('projects.payments.paymentRecorded'));
    } else {
      toast.success(t('projects.payments.paymentCreated'));
    }

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
          <!-- Collapses create + mark-paid into one step. -->
          <v-switch
            v-model="form.alreadyPaid"
            :label="t('projects.payments.alreadyPaidToday')"
            color="success"
            density="compact"
            hide-details
            class="md:col-span-2"
          />
          <v-text-field
            v-if="form.alreadyPaid"
            v-model="form.paymentDate"
            :label="t('payments.fields.paymentDate')"
            type="date"
            :rules="[requiredRule]"
            :error-messages="fieldErrors.paymentDate"
            class="md:col-span-2"
          />

          <AdvancedOptions>
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
          </AdvancedOptions>
        </v-card-text>

        <v-divider />

        <v-card-actions class="px-4 py-3">
          <v-btn variant="text" :disabled="submitting" @click="close">
            {{ t('common.cancel') }}
          </v-btn>
          <v-spacer />
          <v-btn type="submit" color="primary" variant="flat" :loading="submitting">
            {{ form.alreadyPaid ? t('projects.payments.recordPaid') : t('payments.add') }}
          </v-btn>
        </v-card-actions>
      </v-form>
    </v-card>
  </v-dialog>
</template>
