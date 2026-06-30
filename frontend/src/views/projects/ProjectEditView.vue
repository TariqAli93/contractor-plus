<script setup lang="ts">
// Full-page project detail: a thin wrapper around ProjectDetailPanel, driven by
// the route :id (undefined on /projects/new). The reusable panel holds all the
// logic so the master-detail workspace can embed the same surface.
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { t } from '@/i18n';
import ProjectDetailPanel from '@/components/features/project/ProjectDetailPanel.vue';

const route = useRoute();

const projectId = computed(() => {
  const id = route.params.id;
  return typeof id === 'string' ? id : undefined;
});

const heading = computed(() => (projectId.value ? t('projects.edit') : t('projects.new')));
</script>

<template>
  <div>
    <div class="flex items-center gap-2 mb-4">
      <v-btn icon="mdi-arrow-right" variant="text" to="/projects" />
      <h1 class="text-h5">{{ heading }}</h1>
    </div>

    <ProjectDetailPanel :project-id="projectId" />
  </div>
</template>
