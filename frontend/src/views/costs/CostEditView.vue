<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { t } from '@/i18n';
import CostForm from '@/components/features/cost/CostForm.vue';
import PageHeader from '@/components/shared/PageHeader.vue';

const route = useRoute();

const costId = computed(() => {
  const id = route.params.id;
  return typeof id === 'string' && id !== 'new' ? id : undefined;
});

// Optional ?projectId=... pre-binds the project picker so the user can land
// from a project page already scoped to that project.
const initialProjectId = computed(() => {
  const qp = route.query.projectId;
  return typeof qp === 'string' && qp.length > 0 ? qp : undefined;
});

const heading = computed(() => (costId.value ? t('costs.edit') : t('costs.new')));
</script>

<template>
  <div>
    <PageHeader :title="heading" back="/costs" />

    <CostForm :id="costId" :initial-project-id="initialProjectId" />
  </div>
</template>
