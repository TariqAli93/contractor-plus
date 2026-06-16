<script setup lang="ts">
import { t } from '@/i18n';

const props = defineProps<{
  active: boolean;
  size?: 'x-small' | 'small' | 'default' | 'large';
}>();
</script>

<template>
  <v-chip
    :color="props.active ? 'success' : 'error'"
    :prepend-icon="props.active ? 'mdi-check-circle-outline' : 'mdi-cancel'"
    :size="size ?? 'small'"
    variant="tonal"
  >
    {{ props.active ? t('users.status.active') : t('users.status.inactive') }}
  </v-chip>
</template>
