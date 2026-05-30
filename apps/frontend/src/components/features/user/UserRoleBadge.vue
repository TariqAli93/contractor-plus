<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@/i18n';
import { RoleName } from '@/types/enums';

const props = defineProps<{
  // Role name (system or custom).
  role: string;
  size?: 'x-small' | 'small' | 'default' | 'large';
}>();

const color = computed(() => {
  switch (props.role) {
    case RoleName.OWNER:
      return 'deep-purple';
    case RoleName.ADMIN:
      return 'primary';
    case RoleName.ACCOUNTANT:
      return 'teal';
    case RoleName.ENGINEER:
      return 'indigo';
    case RoleName.VIEWER:
      return 'blue-grey';
    default:
      return undefined;
  }
});
</script>

<template>
  <v-chip :color="color" :size="size ?? 'small'" variant="tonal">
    {{ t(`roles.${role}`) }}
  </v-chip>
</template>
