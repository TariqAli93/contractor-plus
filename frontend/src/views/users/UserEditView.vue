<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { t } from '@/i18n';
import UserForm from '@/components/features/user/UserForm.vue';
import PageHeader from '@/components/shared/PageHeader.vue';

const route = useRoute();
const userId = computed(() => {
  const id = route.params.id;
  return typeof id === 'string' ? id : undefined;
});
const heading = computed(() => (userId.value ? t('users.edit') : t('users.new')));
</script>

<template>
  <div>
    <PageHeader :title="heading" back="/users" />
    <UserForm :id="userId" />
  </div>
</template>
