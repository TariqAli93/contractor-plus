<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { t } from '@/i18n';
import MaterialForm from '@/components/features/material/MaterialForm.vue';
import PageHeader from '@/components/shared/PageHeader.vue';

const route = useRoute();

const materialId = computed(() => {
  const id = route.params.id;
  return typeof id === 'string' ? id : undefined;
});

const heading = computed(() => (materialId.value ? t('materials.edit') : t('materials.new')));
</script>

<template>
  <div>
    <PageHeader :title="heading" back="/materials" />

    <MaterialForm :id="materialId" />
  </div>
</template>
