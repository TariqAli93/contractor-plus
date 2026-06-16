<script setup lang="ts">
defineProps<{ active: boolean; message?: string }>();
</script>

<template>
  <v-overlay :model-value="active" persistent class="align-center justify-center" contained>
    <div class="flex flex-col items-center gap-3">
      <v-progress-circular indeterminate color="primary" />
      <div v-if="message" class="text-sm">{{ message }}</div>
    </div>
  </v-overlay>
</template>
