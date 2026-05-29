<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { ContractStatus } from '@/types/enums';

const props = defineProps<{
  status: ContractStatus;
  size?: 'x-small' | 'small' | 'default' | 'large';
}>();

const { t } = useI18n();

const color = computed(() => {
  switch (props.status) {
    case ContractStatus.DRAFT:
      return 'info';
    case ContractStatus.APPROVED:
      return 'success';
    case ContractStatus.CANCELLED:
      return 'error';
    default:
      return undefined;
  }
});

const icon = computed(() => {
  switch (props.status) {
    case ContractStatus.DRAFT:
      return 'mdi-file-document-edit-outline';
    case ContractStatus.APPROVED:
      return 'mdi-check-circle-outline';
    case ContractStatus.CANCELLED:
      return 'mdi-cancel';
    default:
      return undefined;
  }
});
</script>

<template>
  <v-chip :color="color" :prepend-icon="icon" :size="size ?? 'small'" variant="tonal">
    {{ t(`contracts.status.${status}`) }}
  </v-chip>
</template>
