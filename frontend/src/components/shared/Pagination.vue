<script setup lang="ts">
// Placeholder; pages mostly use v-data-table-server's built-in pagination.
defineProps<{ page: number; pageSize: number; total: number }>();
defineEmits<{ (e: 'update:page', v: number): void }>();
</script>

<template>
  <div class="flex justify-center py-2">
    <v-pagination :model-value="page" :length="Math.max(1, Math.ceil(total / pageSize))"
      @update:model-value="(v) => $emit('update:page', v)" />
  </div>
</template>
