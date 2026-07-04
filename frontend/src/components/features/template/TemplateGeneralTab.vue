<script setup lang="ts">
import { onMounted } from 'vue';
import { t } from '@/i18n';
import { useTemplateForm } from '@/composables/useTemplateForm';

const props = defineProps<{ id?: string }>();
const { form, isEdit, loading, submitting, fieldErrors, load, submit, cancel } =
  useTemplateForm(props.id);

onMounted(load);

const requiredRule = (v: unknown) => !!v || ' ';
const positiveIntRule = (v: unknown) =>
  v === null || v === undefined || v === '' || (Number.isInteger(Number(v)) && Number(v) > 0) ||
  t('templates.errors.positiveInt');
const percentageRule = (v: unknown) => {
  if (v === null || v === undefined || v === '') return true;
  const n = Number(v);
  return (Number.isFinite(n) && n >= 0 && n <= 100) || t('templates.errors.percentage');
};
</script>

<template>
  <div :class="{ 'opacity-60 pointer-events-none': loading }">
    <v-form @submit.prevent="submit">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <v-text-field
          v-model="form.name"
          :label="t('templates.fields.name')"
          :rules="[requiredRule]"
          :error-messages="fieldErrors.name"
          autofocus
          required
          class="md:col-span-2"
        />
        <v-text-field
          v-model.number="form.estimatedDurationDays"
          :label="t('templates.fields.estimatedDurationDays')"
          type="number"
          min="1"
          step="1"
          :rules="[positiveIntRule]"
          :error-messages="fieldErrors.estimatedDurationDays"
        />
        <v-text-field
          v-model.number="form.suggestedProfitMargin"
          :label="t('templates.fields.suggestedProfitMargin')"
          type="number"
          min="0"
          max="100"
          step="0.01"
          suffix="%"
          :rules="[percentageRule]"
          :error-messages="fieldErrors.suggestedProfitMargin"
        />
        <div class="flex items-center">
          <v-switch
            v-model="form.isActive"
            :label="t('templates.fields.isActive')"
            color="success"
            hide-details
            inset
            :error-messages="fieldErrors.isActive"
          />
        </div>
        <v-textarea
          v-model="form.description"
          :label="t('templates.fields.description')"
          :error-messages="fieldErrors.description"
          rows="3"
          auto-grow
          class="md:col-span-2"
        />
      </div>

      <div class="flex items-center pt-4">
        <v-btn variant="text" :disabled="submitting" @click="cancel">
          {{ t('common.cancel') }}
        </v-btn>
        <v-spacer />
        <v-btn type="submit" color="primary" variant="flat" :loading="submitting">
          {{ isEdit ? t('common.saveChanges') : t('templates.add') }}
        </v-btn>
      </div>
    </v-form>
  </div>
</template>
