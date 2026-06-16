<script setup lang="ts">
defineProps<{ status: string; kind?: string }>();
</script>

<template>
  <v-chip size="small" variant="tonal">{{ status }}</v-chip>
</template>
