<script setup lang="ts">
// Full-page project detail: a thin wrapper around ProjectDetailPanel, driven by
// the route :id (undefined on /projects/new). The reusable panel holds all the
// logic so the master-detail workspace can embed the same surface.
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { t } from '@/i18n';
import ProjectDetailPanel from '@/components/features/project/ProjectDetailPanel.vue';
import PageHeader from '@/components/shared/PageHeader.vue';

const route = useRoute();

const projectId = computed(() => {
  const id = route.params.id;
  return typeof id === 'string' ? id : undefined;
});

const heading = computed(() => (projectId.value ? t('projects.edit') : t('projects.new')));
</script>

<template>
  <div>
    <PageHeader :title="heading" back="/projects" />

    <ProjectDetailPanel :project-id="projectId" />
  </div>
</template>
