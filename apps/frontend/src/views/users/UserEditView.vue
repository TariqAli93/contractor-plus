<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { t } from '@/i18n';
import UserForm from '@/components/features/user/UserForm.vue';

const route = useRoute();
const userId = computed(() => {
  const id = route.params.id;
  return typeof id === 'string' ? id : undefined;
});
const heading = computed(() => (userId.value ? t('users.edit') : t('users.new')));
</script>

<template>
  <div>
    <div class="flex items-center gap-2 mb-4">
      <v-btn icon="mdi-arrow-right" variant="text" to="/users" />
      <h1 class="text-h5">{{ heading }}</h1>
    </div>
    <UserForm :id="userId" />
  </div>
</template>
