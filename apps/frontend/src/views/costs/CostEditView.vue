<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { t } from '@/i18n';
import CostForm from '@/components/features/cost/CostForm.vue';

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
    <div class="flex items-center gap-2 mb-4">
      <v-btn icon="mdi-arrow-right" variant="text" to="/costs" />
      <h1 class="text-h5">{{ heading }}</h1>
    </div>

    <CostForm :id="costId" :initial-project-id="initialProjectId" />
  </div>
</template>
