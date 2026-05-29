<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { PaymentStatus } from '@/types/enums';

const props = defineProps<{ status: PaymentStatus }>();
const { t } = useI18n();

const color = computed(() => {
  switch (props.status) {
    case PaymentStatus.PAID:
      return 'success';
    case PaymentStatus.PENDING:
      return undefined;
    case PaymentStatus.LATE:
      return 'error';
    case PaymentStatus.CANCELLED:
      return 'grey';
    default:
      return undefined;
  }
});

const icon = computed(() => {
  switch (props.status) {
    case PaymentStatus.PAID:
      return 'mdi-check-circle-outline';
    case PaymentStatus.PENDING:
      return 'mdi-clock-outline';
    case PaymentStatus.LATE:
      return 'mdi-alert-circle-outline';
    case PaymentStatus.CANCELLED:
      return 'mdi-close-circle-outline';
    default:
      return undefined;
  }
});

const label = computed(() => t(`payments.status.${props.status}`));
</script>

<template>
  <v-chip size="small" variant="tonal" :color="color" :prepend-icon="icon">
    {{ label }}
  </v-chip>
</template>
