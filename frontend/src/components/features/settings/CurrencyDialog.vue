<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { t } from '@/i18n';
import { settingsApi } from '@/services/api/settings.api';
import { useToast } from '@/composables/useToast';
import { useApiError } from '@/composables/useApiError';
import { formatMoney } from '@/lib/currency-format';
import type {
  CreateCurrencyInput,
  Currency,
  CurrencySymbolPosition,
} from '@/types/settings';

const props = defineProps<{
  modelValue: boolean;
  // When set, the dialog is in edit mode for the given currency.
  currency?: Currency | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'saved', currency: Currency): void;
}>();

const toast = useToast();
const { handle, fieldErrors, clear: clearErrors } = useApiError();

const saving = ref(false);

interface FormShape {
  code: string;
  name: string;
  symbol: string;
  symbolPosition: CurrencySymbolPosition;
  decimalPrecision: number;
  thousandSeparator: string;
  decimalSeparator: string;
  isActive: boolean;
}

const DEFAULTS: FormShape = {
  code: '',
  name: '',
  symbol: '',
  symbolPosition: 'BEFORE',
  decimalPrecision: 2,
  thousandSeparator: ',',
  decimalSeparator: '.',
  isActive: true,
};

const form = reactive<FormShape>({ ...DEFAULTS });

const isEdit = computed(() => Boolean(props.currency));
const title = computed(() =>
  isEdit.value ? t('settings.currency.edit') : t('settings.currency.addNew'),
);

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    clearErrors();
    if (props.currency) {
      form.code = props.currency.code;
      form.name = props.currency.name;
      form.symbol = props.currency.symbol;
      form.symbolPosition = props.currency.symbolPosition;
      form.decimalPrecision = props.currency.decimalPrecision;
      form.thousandSeparator = props.currency.thousandSeparator;
      form.decimalSeparator = props.currency.decimalSeparator;
      form.isActive = props.currency.isActive;
    } else {
      Object.assign(form, DEFAULTS);
    }
  },
);

const previewCurrency = computed<Currency>(() => ({
  id: 'preview',
  code: form.code || 'XXX',
  name: form.name || '',
  symbol: form.symbol || '',
  symbolPosition: form.symbolPosition,
  decimalPrecision: form.decimalPrecision,
  thousandSeparator: form.thousandSeparator,
  decimalSeparator: form.decimalSeparator,
  isActive: form.isActive,
  isDefault: false,
  createdAt: '',
  updatedAt: '',
}));

const preview = computed(() => formatMoney(1234567.89, { currency: previewCurrency.value }));

function close() {
  emit('update:modelValue', false);
}

async function save() {
  if (saving.value) return;
  clearErrors();
  saving.value = true;
  try {
    const payload: CreateCurrencyInput = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      symbol: form.symbol.trim(),
      symbolPosition: form.symbolPosition,
      decimalPrecision: form.decimalPrecision,
      thousandSeparator: form.thousandSeparator,
      decimalSeparator: form.decimalSeparator,
      isActive: form.isActive,
    };
    const saved = props.currency
      ? await settingsApi.updateCurrency(props.currency.id, payload)
      : await settingsApi.createCurrency(payload);
    toast.success(t('settings.saved'));
    emit('saved', saved);
    close();
  } catch (e) {
    handle(e);
  } finally {
    saving.value = false;
  }
}

function fieldError(name: string): string {
  return fieldErrors.value[name]?.[0] ?? '';
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="640"
    persistent
    scrollable
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon icon="mdi-currency-usd" class="me-2" />
        {{ title }}
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" :aria-label="t('common.close')" @click="close" />
      </v-card-title>
      <v-divider />
      <v-card-text class="py-4">
        <form class="grid grid-cols-1 sm:grid-cols-2 gap-3" @submit.prevent="save">
          <v-text-field
            v-model="form.code"
            :label="t('settings.currency.code') + ' *'"
            maxlength="8"
            :error-messages="fieldError('code')"
            :disabled="isEdit"
            required
          />
          <v-text-field
            v-model="form.name"
            :label="t('settings.currency.name') + ' *'"
            maxlength="100"
            :error-messages="fieldError('name')"
            required
          />
          <v-text-field
            v-model="form.symbol"
            :label="t('settings.currency.symbol') + ' *'"
            maxlength="10"
            :error-messages="fieldError('symbol')"
            required
          />
          <v-select
            v-model="form.symbolPosition"
            :items="[
              { value: 'BEFORE', title: t('settings.currency.positionBefore') },
              { value: 'AFTER', title: t('settings.currency.positionAfter') },
            ]"
            item-title="title"
            item-value="value"
            :label="t('settings.currency.symbolPosition')"
          />
          <v-text-field
            v-model.number="form.decimalPrecision"
            type="number"
            min="0"
            max="6"
            :label="t('settings.currency.decimalPrecision')"
            :error-messages="fieldError('decimalPrecision')"
          />
          <v-text-field
            v-model="form.thousandSeparator"
            :label="t('settings.currency.thousandSeparator')"
            maxlength="2"
            :error-messages="fieldError('thousandSeparator')"
          />
          <v-text-field
            v-model="form.decimalSeparator"
            :label="t('settings.currency.decimalSeparator')"
            maxlength="2"
            :error-messages="fieldError('decimalSeparator')"
          />
          <v-switch
            v-model="form.isActive"
            :label="t('settings.currency.isActive')"
            color="primary"
            inset
            hide-details
          />

          <div class="sm:col-span-2 mt-2">
            <p class="cp-eyebrow mb-1">{{ t('settings.currency.preview') }}</p>
            <div class="cp-currency-preview">
              <span class="text-medium-emphasis text-sm me-2">
                {{ t('settings.currency.previewDescription') }}
              </span>
              <span class="cp-currency-preview__value">{{ preview }}</span>
            </div>
          </div>
        </form>
      </v-card-text>
      <v-divider />
      <v-card-actions class="px-4 py-2">
        <v-spacer />
        <v-btn variant="text" @click="close">{{ t('common.cancel') }}</v-btn>
        <v-btn
          color="primary"
          :loading="saving"
          prepend-icon="mdi-content-save-outline"
          @click="save"
        >
          {{ isEdit ? t('common.saveChanges') : t('settings.currency.addNew') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.cp-currency-preview {
  display: flex;
  align-items: center;
  padding: 12px 14px;
  background: var(--cp-surface-2);
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-sm);
  flex-wrap: wrap;
}
.cp-currency-preview__value {
  font-size: 1.1rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--cp-text);
}
</style>
