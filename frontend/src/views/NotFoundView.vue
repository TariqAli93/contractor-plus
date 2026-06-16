<script setup lang="ts">
import { t } from '@/i18n';

</script>

<template>
  <div class="flex flex-col items-center justify-center text-center py-12 gap-3">
    <v-icon icon="mdi-map-marker-question-outline" size="64" class="text-medium-emphasis" />
    <div class="text-h5">{{ t('errors.notFound') }}</div>
    <v-btn to="/" color="primary" variant="tonal">{{ t('common.back') }}</v-btn>
  </div>
</template>
