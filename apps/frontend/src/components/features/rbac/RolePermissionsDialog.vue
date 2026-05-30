<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { t } from '@/i18n';
import { rbacApi } from '@/services/api/rbac.api';
import { useApiError } from '@/composables/useApiError';
import { useToast } from '@/composables/useToast';
import { RoleName } from '@/types/enums';
import type { Role } from '@/types/rbac';
import type { PermissionMatrix } from '@/types/rbac';
import PermissionGroupCard from './PermissionGroupCard.vue';
import RoleBadge from './RoleBadge.vue';

const props = defineProps<{
  modelValue: boolean;
  role: Role | null;
  modules: PermissionMatrix['modules'];
}>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'saved'): void;
}>();

const toast = useToast();
const { handle } = useApiError();

const selected = ref<Set<string>>(new Set());
const loading = ref(false);
const submitting = ref(false);

// OWNER is locked (super-admin, immutable).
const locked = computed(() => props.role?.name === RoleName.OWNER);

watch(
  () => props.modelValue,
  async (open) => {
    if (!open || !props.role) return;
    loading.value = true;
    try {
      const res = await rbacApi.getRolePermissions(props.role.id);
      selected.value = new Set(res.permissions);
    } catch (e) {
      handle(e);
    } finally {
      loading.value = false;
    }
  },
);

function onToggle(key: string, value: boolean) {
  if (locked.value) return;
  const next = new Set(selected.value);
  if (value) next.add(key);
  else next.delete(key);
  selected.value = next;
}

function close() {
  emit('update:modelValue', false);
}

async function save() {
  if (!props.role || locked.value) return;
  submitting.value = true;
  try {
    await rbacApi.setRolePermissions(props.role.id, [...selected.value]);
    toast.success(t('rbac.permissionsSaved'));
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
  <v-dialog :model-value="modelValue" max-width="760" scrollable @update:model-value="close">
    <v-card v-if="role">
      <v-card-title class="flex items-center gap-2">
        {{ t('rbac.editPermissions') }}
        <RoleBadge :name="role.name" :display-name="role.displayName" :is-system="role.isSystem" />
      </v-card-title>
      <v-divider />
      <v-card-text style="max-height: 70vh">
        <v-alert
          v-if="locked"
          type="info"
          variant="tonal"
          density="comfortable"
          class="mb-3 text-body-2"
        >
          {{ t('rbac.ownerLocked') }}
        </v-alert>
        <v-alert
          v-else-if="role.isSystem"
          type="warning"
          variant="tonal"
          density="comfortable"
          class="mb-3 text-body-2"
        >
          {{ t('rbac.systemRoleWarning') }}
        </v-alert>

        <v-progress-linear v-if="loading" indeterminate class="mb-3" />

        <div class="flex flex-col gap-3">
          <PermissionGroupCard
            v-for="mod in modules"
            :key="mod.key"
            :module-key="mod.key"
            :permissions="mod.permissions"
            :selected="selected"
            :disabled="locked"
            @toggle="onToggle"
          />
        </div>
      </v-card-text>
      <v-divider />
      <v-card-actions class="px-4 py-3">
        <span class="text-caption text-medium-emphasis">{{ t('rbac.selectedCount', { n: selected.size }) }}</span>
        <v-spacer />
        <v-btn variant="text" :disabled="submitting" @click="close">{{ t('common.cancel') }}</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="submitting"
          :disabled="locked"
          @click="save"
        >
          {{ t('common.save') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
