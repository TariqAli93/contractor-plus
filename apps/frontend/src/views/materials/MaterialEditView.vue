<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import MaterialForm from '@/components/features/material/MaterialForm.vue';

const route = useRoute();
const { t } = useI18n();

const materialId = computed(() => {
  const id = route.params.id;
  return typeof id === 'string' ? id : undefined;
});

const heading = computed(() => (materialId.value ? t('materials.edit') : t('materials.new')));
</script>

<template>
  <div>
    <div class="flex items-center gap-2 mb-4">
      <v-btn icon="mdi-arrow-right" variant="text" to="/materials" />
      <h1 class="text-h5">{{ heading }}</h1>
    </div>

    <MaterialForm :id="materialId" />
  </div>
</template>
