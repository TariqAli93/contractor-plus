<script setup lang="ts">
import { ref } from 'vue';
import { t } from '@/i18n';
import { useAuthStore } from '@/stores/auth.store';
import UserRoleBadge from '@/components/features/user/UserRoleBadge.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';
import PageHeader from '@/components/shared/PageHeader.vue';
import ProfileForm from '@/components/features/profile/ProfileForm.vue';
import ChangePasswordDialog from '@/components/features/profile/ChangePasswordDialog.vue';

const auth = useAuthStore();
const pwOpen = ref(false);
</script>

<template>
  <div>
    <PageHeader :title="t('profile.title')" icon="mdi-account-circle-outline" />

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <!-- Account summary (read-only) -->
      <v-card>
        <v-card-title class="text-h6">{{ t('profile.accountTitle') }}</v-card-title>
        <v-divider />
        <v-list lines="two" class="!bg-transparent">
          <v-list-item :title="auth.user?.fullName ?? '—'" :subtitle="t('users.fields.fullName')" />
          <v-list-item :title="auth.user?.username ?? '—'" :subtitle="t('users.fields.username')" />
          <v-list-item :subtitle="t('users.fields.role')">
            <template #title>
              <UserRoleBadge v-if="auth.user" :role="auth.user.role" class="mt-1" />
            </template>
          </v-list-item>
          <v-list-item :subtitle="t('users.fields.lastLoginAt')">
            <template #title>
              <DateDisplay :value="auth.user?.lastLoginAt" />
            </template>
          </v-list-item>
        </v-list>
        <v-divider />
        <v-card-actions class="px-4 py-3">
          <v-btn variant="tonal" prepend-icon="mdi-lock-reset" @click="pwOpen = true">
            {{ t('profile.password.title') }}
          </v-btn>
        </v-card-actions>
      </v-card>

      <!-- Editable contact info -->
      <ProfileForm />
    </div>

    <ChangePasswordDialog v-model="pwOpen" />
  </div>
</template>
