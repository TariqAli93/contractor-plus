<script setup lang="ts">
import { computed } from 'vue';
import { AuditAction } from '@/types/enums';

const props = defineProps<{ action: AuditAction }>();

const color = computed(() => {
  switch (props.action) {
    case AuditAction.CREATE:
      return 'success';
    case AuditAction.UPDATE:
      return 'info';
    case AuditAction.DELETE:
      return 'error';
    default:
      return undefined;
  }
});

const icon = computed(() => {
  switch (props.action) {
    case AuditAction.CREATE:
      return 'mdi-plus-circle-outline';
    case AuditAction.UPDATE:
      return 'mdi-pencil-circle-outline';
    case AuditAction.DELETE:
      return 'mdi-delete-circle-outline';
    default:
      return undefined;
  }
});
</script>

<template>
  <v-chip size="small" variant="tonal" :color="color" :prepend-icon="icon">
    {{ action }}
  </v-chip>
</template>
