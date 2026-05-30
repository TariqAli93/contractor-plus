<script setup lang="ts">
defineProps<{ allowed: boolean }>();
</script>

<template>
  <v-icon
    :icon="allowed ? 'mdi-check-circle' : 'mdi-minus-circle-outline'"
    :color="allowed ? 'success' : 'medium-emphasis'"
    size="20"
  />
</template>
