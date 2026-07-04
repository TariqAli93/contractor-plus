<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { t } from '@/i18n';
import { useMaterialForm } from '@/composables/useMaterialForm';
import AdvancedOptions from '@/components/shared/AdvancedOptions.vue';

const props = defineProps<{ id?: string }>();
const { form, isEdit, loading, submitting, fieldErrors, load, submit, cancel } =
  useMaterialForm(props.id);

onMounted(load);

const requiredRule = (v: unknown) => !!v || t('errors.required');
const nonNegativeRule = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === '' || Number(v) >= 0 || t('materials.errors.price');

// Reveal on edit when the material is inactive or already carries notes.
const hasAdvanced = computed(() => form.value.isActive === false || !!form.value.notes);
</script>

<template>
  <v-card :loading="loading">
    <v-form @submit.prevent="submit">
      <v-card-text class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <v-text-field
          v-model="form.name"
          :label="t('materials.fields.name')"
          :placeholder="t('materials.placeholders.name')"
          :rules="[requiredRule]"
          :error-messages="fieldErrors.name"
          autofocus
          required
        />
        <v-text-field
          v-model="form.unit"
          :label="t('materials.fields.unit')"
          :placeholder="t('materials.placeholders.unit')"
          :rules="[requiredRule]"
          :error-messages="fieldErrors.unit"
          :hint="t('materials.fields.unitHint')"
          persistent-hint
          required
        />
        <v-text-field
          v-model.number="form.defaultPrice"
          :label="t('materials.fields.defaultPrice')"
          :placeholder="t('materials.placeholders.defaultPrice')"
          type="number"
          step="0.01"
          min="0"
          :rules="[nonNegativeRule]"
          :error-messages="fieldErrors.defaultPrice"
        />
        <AdvancedOptions :default-open="hasAdvanced">
          <div class="flex items-center">
            <v-switch
              v-model="form.isActive"
              :label="t('materials.fields.isActive')"
              color="success"
              hide-details
              inset
              :error-messages="fieldErrors.isActive"
            />
          </div>
          <v-textarea
            v-model="form.notes"
            :label="t('materials.fields.notes')"
            :error-messages="fieldErrors.notes"
            rows="3"
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
          {{ isEdit ? t('common.saveChanges') : t('materials.add') }}
        </v-btn>
      </v-card-actions>
    </v-form>
  </v-card>
</template>
