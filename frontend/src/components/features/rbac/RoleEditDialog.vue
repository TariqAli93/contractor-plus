<script setup lang="ts">
import { ref, watch } from 'vue';
import { t } from '@/i18n';
import { rbacApi } from '@/services/api/rbac.api';
import { useApiError } from '@/composables/useApiError';
import { useToast } from '@/composables/useToast';
import type { Role } from '@/types/rbac';

// role === null  -> create a new custom role
// role !== null  -> edit metadata of an existing role
const props = defineProps<{ modelValue: boolean; role: Role | null }>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'saved'): void;
}>();

const toast = useToast();
const { fieldErrors, handle, clear } = useApiError();

const form = ref({ name: '', displayName: '', description: '' as string | null, sortOrder: 100 });
const submitting = ref(false);

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    clear();
    if (props.role) {
      form.value = {
        name: props.role.name,
        displayName: props.role.displayName ?? '',
        description: props.role.description,
        sortOrder: props.role.sortOrder,
      };
    } else {
      form.value = { name: '', displayName: '', description: '', sortOrder: 100 };
    }
  },
);

const requiredRule = (v: unknown) => !!v || ' ';
const nameRule = (v: string) => /^[a-z][a-z0-9_-]*$/.test(v) || t('rbac.errors.nameFormat');

function close() {
  emit('update:modelValue', false);
}

async function submit() {
  clear();
  submitting.value = true;
  try {
    if (props.role) {
      await rbacApi.updateRole(props.role.id, {
        displayName: form.value.displayName,
        description: form.value.description,
        sortOrder: form.value.sortOrder,
      });
    } else {
      await rbacApi.createRole({
        name: form.value.name,
        displayName: form.value.displayName,
        description: form.value.description,
        sortOrder: form.value.sortOrder,
      });
    }
    toast.success(t('common.saved'));
    emit('saved');
    close();
  } catch (e) {
    handle(e);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="480" @update:model-value="close">
    <v-card>
      <v-card-title>{{ role ? t('rbac.editRole') : t('rbac.createRole') }}</v-card-title>
      <v-form @submit.prevent="submit">
        <v-card-text class="flex flex-col gap-1">
          <v-text-field
            v-if="!role"
            v-model="form.name"
            :label="t('rbac.fields.name')"
            :hint="t('rbac.fields.nameHint')"
            persistent-hint
            :rules="[requiredRule, nameRule]"
            :error-messages="fieldErrors.name"
            autofocus
          />
          <v-text-field
            v-else
            :model-value="form.name"
            :label="t('rbac.fields.name')"
            readonly
            disabled
          />
          <v-text-field
            v-model="form.displayName"
            :label="t('rbac.fields.displayName')"
            :rules="[requiredRule]"
            :error-messages="fieldErrors.displayName"
          />
          <v-textarea
            v-model="form.description"
            :label="t('rbac.fields.description')"
            :error-messages="fieldErrors.description"
            rows="2"
            auto-grow
          />
          <v-text-field
            v-model.number="form.sortOrder"
            :label="t('rbac.fields.sortOrder')"
            type="number"
            min="0"
            :error-messages="fieldErrors.sortOrder"
          />
        </v-card-text>
        <v-divider />
        <v-card-actions class="px-4 py-3">
          <v-btn variant="text" :disabled="submitting" @click="close">{{ t('common.cancel') }}</v-btn>
          <v-spacer />
          <v-btn type="submit" color="primary" variant="flat" :loading="submitting">
            {{ role ? t('common.save') : t('common.create') }}
          </v-btn>
        </v-card-actions>
      </v-form>
    </v-card>
  </v-dialog>
</template>
