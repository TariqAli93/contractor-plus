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
  <div class="cp-fill">
    <PageHeader :title="t('profile.title')" icon="mdi-account-circle-outline" />

    <div class="cp-profile__workspace">
      <!-- Account summary (read-only) -->
      <section class="cp-panel cp-profile__account">
        <h2 class="cp-profile__title">{{ t('profile.accountTitle') }}</h2>
        <v-list lines="two" class="!bg-transparent">
          <v-list-item :title="auth.user?.fullName ?? '-'" :subtitle="t('users.fields.fullName')" />
          <v-list-item :title="auth.user?.username ?? '-'" :subtitle="t('users.fields.username')" />
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
        <div class="cp-profile__actions">
          <v-btn variant="tonal" prepend-icon="mdi-lock-reset" @click="pwOpen = true">
            {{ t('profile.password.title') }}
          </v-btn>
        </div>
      </section>

      <!-- Editable contact info -->
      <ProfileForm />
    </div>

    <ChangePasswordDialog v-model="pwOpen" />
  </div>
</template>

<style scoped>
.cp-profile__workspace {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(260px, 0.8fr) minmax(360px, 1.2fr);
  gap: 6px;
  overflow: auto;
}
.cp-profile__account { overflow: hidden; }
.cp-profile__title {
  margin: 0;
  padding: 6px 8px;
  color: var(--cp-text);
  background: var(--cp-surface-2);
  border-block-end: 1px solid var(--cp-border);
  font-size: 0.82rem;
  font-weight: 600;
}
.cp-profile__actions {
  padding: 6px 8px;
  background: var(--cp-surface-2);
  border-block-start: 1px solid var(--cp-border);
}
</style>
