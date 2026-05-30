<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { t } from '@/i18n';
import { useUserForm } from '@/composables/useUserForm';
import { useAuthStore } from '@/stores/auth.store';
import { useAccess } from '@/composables/useAccess';
import { RoleName } from '@/types/enums';

const props = defineProps<{ id?: string }>();
const auth = useAuthStore();
const { hasRole } = useAccess();
const { form, isEdit, loading, submitting, fieldErrors, load, submit, cancel } = useUserForm(
  props.id,
);

onMounted(load);

const isOwner = computed(() => hasRole(RoleName.OWNER));
const isSelf = computed(() => isEdit && auth.user?.id === props.id);

// Only an OWNER may assign the OWNER role.
const roleOptions = computed(() =>
  Object.values(RoleName)
    .filter((r) => isOwner.value || r !== RoleName.OWNER)
    .map((r) => ({ value: r, title: t(`roles.${r}`) })),
);

const requiredRule = (v: unknown) => !!v || ' ';
const usernameRule = (v: string) => (v?.trim().length ?? 0) >= 3 || t('users.errors.usernameMin');
const passwordRule = (v: string) => (v?.length ?? 0) >= 8 || t('users.errors.passwordMin');
const emailRule = (v: string | null | undefined) =>
  !v || /.+@.+\..+/.test(v) || t('users.errors.email');
</script>

<template>
  <v-card :loading="loading">
    <v-form @submit.prevent="submit">
      <v-card-text class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <v-text-field
          v-if="!isEdit"
          v-model="form.username"
          :label="t('users.fields.username')"
          autocomplete="off"
          :rules="[requiredRule, usernameRule]"
          :error-messages="fieldErrors.username"
          autofocus
        />
        <v-text-field
          v-else
          :model-value="form.username"
          :label="t('users.fields.username')"
          readonly
          disabled
          :hint="t('users.usernameLocked')"
          persistent-hint
        />
        <v-text-field
          v-if="!isEdit"
          v-model="form.password"
          :label="t('users.fields.password')"
          type="password"
          autocomplete="new-password"
          :rules="[requiredRule, passwordRule]"
          :error-messages="fieldErrors.password"
        />

        <v-text-field
          v-model="form.fullName"
          :label="t('users.fields.fullName')"
          :rules="[requiredRule]"
          :error-messages="fieldErrors.fullName"
        />
        <v-select
          v-model="form.roleName"
          :label="t('users.fields.role')"
          :items="roleOptions"
          :disabled="isSelf"
          :hint="isSelf ? t('users.selfRoleLocked') : undefined"
          :persistent-hint="isSelf"
          :error-messages="fieldErrors.roleName"
        />
        <v-text-field
          v-model="form.email"
          :label="t('users.fields.email')"
          type="email"
          :rules="[emailRule]"
          :error-messages="fieldErrors.email"
        />
        <v-text-field
          v-model="form.phone"
          :label="t('users.fields.phone')"
          :error-messages="fieldErrors.phone"
        />

        <v-switch
          v-model="form.isActive"
          :label="t('users.fields.active')"
          color="primary"
          :disabled="isSelf"
          :hint="isSelf ? t('users.selfDeactivateLocked') : undefined"
          :persistent-hint="isSelf"
          inset
        />
      </v-card-text>

      <v-divider />

      <v-card-actions class="px-4 py-3">
        <v-btn variant="text" :disabled="submitting" @click="cancel">{{ t('common.cancel') }}</v-btn>
        <v-spacer />
        <v-btn type="submit" color="primary" variant="flat" :loading="submitting">
          {{ isEdit ? t('common.update') : t('common.create') }}
        </v-btn>
      </v-card-actions>
    </v-form>
  </v-card>
</template>
