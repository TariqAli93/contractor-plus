<script setup lang="ts">
defineProps<{
  title: string;
  value?: string | number;
  icon?: string;
  loading?: boolean;
}>();
</script>

<template>
  <v-card>
    <v-card-text>
      <div class="flex items-center justify-between gap-3">
        <div>
          <div class="text-medium-emphasis text-sm">{{ title }}</div>
          <div v-if="loading" class="mt-1">
            <v-skeleton-loader type="text" />
          </div>
          <div v-else class="text-h5 mt-1">
            <slot>{{ value ?? '—' }}</slot>
          </div>
        </div>
        <v-icon v-if="icon" :icon="icon" size="32" class="text-medium-emphasis" />
      </div>
    </v-card-text>
  </v-card>
</template>
