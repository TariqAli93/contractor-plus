<script setup lang="ts">
import { onMounted } from 'vue';
import { t } from '@/i18n';
import { useCustomerForm } from '@/composables/useCustomerForm';

const props = defineProps<{ id?: string }>();
const { form, isEdit, loading, submitting, fieldErrors, load, submit, cancel } = useCustomerForm(
  props.id,
);

onMounted(load);

const requiredRule = (v: unknown) => !!v || t('errors.required');
const emailRule = (v: string | null | undefined) =>
  !v || /.+@.+\..+/.test(v) || t('customers.errors.email');
const phoneRule = (v: string | null | undefined) =>
  !v || /^[\d+\-\s()]{7,}$/.test(v) || t('customers.errors.phone');
</script>

<template>
  <v-card :loading="loading">
    <v-form @submit.prevent="submit">
      <v-card-text class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <v-text-field
          v-model="form.name"
          :label="t('customers.fields.name')"
          :placeholder="t('customers.placeholders.name')"
          :rules="[requiredRule]"
          :error-messages="fieldErrors.name"
          autofocus
          required
        />
        <v-text-field
          v-model="form.phone"
          :label="t('customers.fields.phone')"
          :placeholder="t('customers.placeholders.phone')"
          :rules="[phoneRule]"
          :error-messages="fieldErrors.phone"
        />
        <v-text-field
          v-model="form.email"
          :label="t('customers.fields.email')"
          :placeholder="t('customers.placeholders.email')"
          type="email"
          :rules="[emailRule]"
          :error-messages="fieldErrors.email"
        />
        <v-text-field
          v-model="form.address"
          :label="t('customers.fields.address')"
          :placeholder="t('customers.placeholders.address')"
          :error-messages="fieldErrors.address"
          class="md:col-span-2"
        />
        <v-textarea
          v-model="form.notes"
          :label="t('customers.fields.notes')"
          :error-messages="fieldErrors.notes"
          rows="3"
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
