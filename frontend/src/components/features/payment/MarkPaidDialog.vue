<script setup lang="ts">
import { ref, watch } from 'vue';
import { t } from '@/i18n';
import { PaymentMethod } from '@/types/enums';
import type { MarkPaidBody } from '@/types/payment';

const props = defineProps<{
  modelValue: boolean;
  submitting?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'confirm', body: MarkPaidBody): void;
}>();

const paymentDate = ref<string>(new Date().toISOString().slice(0, 10));
const method = ref<PaymentMethod | undefined>(undefined);
const reference = ref<string>('');

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      paymentDate.value = new Date().toISOString().slice(0, 10);
      method.value = undefined;
      reference.value = '';
    }
  },
);

const methodOptions = [
  { value: undefined as PaymentMethod | undefined, title: '—' },
  { value: PaymentMethod.CASH, title: 'CASH' },
  { value: PaymentMethod.BANK_TRANSFER, title: 'BANK_TRANSFER' },
  { value: PaymentMethod.CHECK, title: 'CHECK' },
  { value: PaymentMethod.OTHER, title: 'OTHER' },
];

function close() {
  emit('update:modelValue', false);
}

function confirm() {
  const body: MarkPaidBody = { paymentDate: paymentDate.value };
  if (method.value) body.method = method.value;
  const ref = reference.value.trim();
  if (ref.length > 0) body.reference = ref;
  emit('confirm', body);
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="480" @update:model-value="emit('update:modelValue', $event)">
    <v-card>
      <v-card-title>{{ t('payments.markPaid.title') }}</v-card-title>
      <v-card-text class="grid grid-cols-1 gap-3">
        <v-text-field
          v-model="paymentDate"
          :label="t('payments.fields.paymentDate')"
          type="date"
          required
        />
        <v-select
          v-model="method"
          :items="methodOptions"
          :label="t('payments.fields.method')"
          clearable
        />
        <v-text-field
          v-model="reference"
          :label="t('payments.fields.reference')"
        />
      </v-card-text>
      <v-card-actions>
        <v-btn variant="text" :disabled="submitting" @click="close">
          {{ t('common.cancel') }}
        </v-btn>
        <v-spacer />
        <v-btn color="success" variant="flat" :loading="submitting" @click="confirm">
          {{ t('payments.markPaid.confirm') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
