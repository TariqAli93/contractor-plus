<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { t } from '@/i18n';
import { useProjectForm } from '@/composables/useProjectForm';
import { useAccess } from '@/composables/useAccess';
import { ProjectStatus, RoleName } from '@/types/enums';
import RoleGate from '@/components/shared/RoleGate.vue';

const props = defineProps<{
  id?: string;
  status?: ProjectStatus;
}>();

const emit = defineEmits<{ saved: [] }>();

const { canAccess } = useAccess();
const { form, isEdit, loading, submitting, fieldErrors, load, submit, cancel } =
  useProjectForm(props.id);

onMounted(load);

const WRITE_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ENGINEER];
const WRITE_PERMS = ['projects.update'];
const canWrite = computed(() => canAccess({ permissions: WRITE_PERMS, roles: WRITE_ROLES }));

const isTerminal = computed(
  () =>
    props.status === ProjectStatus.COMPLETED || props.status === ProjectStatus.CANCELLED,
);

const allLocked = computed(() => !canWrite.value || isTerminal.value);

const requiredRule = (v: unknown) => !!v || ' ';

async function handleSubmit() {
  await submit();
  emit('saved');
}
</script>

<template>
  <div :class="{ 'opacity-60 pointer-events-none': loading }">
    <v-alert
      v-if="status === ProjectStatus.COMPLETED"
      type="success"
      variant="tonal"
      icon="mdi-check-circle-outline"
      class="mb-4"
    >
      {{ t('projects.locked.completed') }}
    </v-alert>
    <v-alert
      v-else-if="status === ProjectStatus.CANCELLED"
      type="warning"
      variant="tonal"
      icon="mdi-cancel"
      class="mb-4"
    >
      {{ t('projects.locked.cancelled') }}
    </v-alert>

    <v-form @submit.prevent="handleSubmit">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <v-text-field
          v-model="form.name"
          :label="t('projects.fields.name')"
          :rules="[requiredRule]"
          :error-messages="fieldErrors.name"
          :disabled="allLocked"
          required
          class="md:col-span-2"
        />
        <v-text-field
          v-model="form.startDate"
          :label="t('projects.fields.startDate')"
          :error-messages="fieldErrors.startDate"
          :disabled="allLocked"
          type="date"
        />
        <v-text-field
          v-model="form.deliveryDate"
          :label="t('projects.fields.deliveryDate')"
          :error-messages="fieldErrors.deliveryDate"
          :disabled="allLocked"
          type="date"
        />
        <v-textarea
          v-model="form.notes"
          :label="t('projects.fields.notes')"
          :error-messages="fieldErrors.notes"
          :disabled="allLocked"
          rows="3"
          auto-grow
          class="md:col-span-2"
        />
      </div>

      <RoleGate :permissions="WRITE_PERMS" :roles="WRITE_ROLES">
        <div v-if="!isTerminal" class="flex items-center pt-4">
          <v-btn variant="text" :disabled="submitting" @click="cancel">
            {{ t('common.cancel') }}
          </v-btn>
          <v-spacer />
          <v-btn type="submit" color="primary" variant="flat" :loading="submitting">
            {{ isEdit ? t('common.update') : t('common.create') }}
          </v-btn>
        </div>
      </RoleGate>
    </v-form>
  </div>
</template>
