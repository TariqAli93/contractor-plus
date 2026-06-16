<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@/i18n';
import { CostCategory } from '@/types/enums';

const props = defineProps<{ category: CostCategory }>();

const color = computed(() => {
  switch (props.category) {
    case CostCategory.MATERIAL:
      return 'primary';
    case CostCategory.LABOR:
      return 'info';
    case CostCategory.MACHINERY:
      return 'warning';
    case CostCategory.TRANSPORT:
      return 'secondary';
    default:
      return undefined;
  }
});

const label = computed(() => t(`costs.category.${props.category}`));
</script>

<template>
  <v-chip size="small" variant="tonal" :color="color">{{ label }}</v-chip>
</template>
