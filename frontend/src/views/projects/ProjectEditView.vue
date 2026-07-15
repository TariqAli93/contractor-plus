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

// `/projects/new` has no id; the edit route yields a string. Guard the odd
// cases too - a catch-all can hand back an array, and an empty segment must read
// as "new", not as a project whose id is the empty string.
const projectId = computed(() => {
  const raw = route.params.id;
  const id = Array.isArray(raw) ? raw[0] : raw;
  return typeof id === 'string' && id.trim() !== '' ? id : undefined;
});

const heading = computed(() => (projectId.value ? t('projects.edit') : t('projects.new')));
</script>

<template>
  <div>
    <PageHeader :title="heading" back="/projects" />

    <ProjectDetailPanel :project-id="projectId" />
  </div>
</template>
