<script setup lang="ts">
// Full-page contract detail: a thin wrapper around ContractDetailPanel, driven
// by the route :id (undefined on /contracts/new). The reusable panel holds all
// the logic so the master-detail workspace can embed the same surface.
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { t } from '@/i18n';
import ContractDetailPanel from '@/components/features/contract/ContractDetailPanel.vue';
import PageHeader from '@/components/shared/PageHeader.vue';

const route = useRoute();

const contractId = computed(() => {
  const id = route.params.id;
  return typeof id === 'string' ? id : undefined;
});

const heading = computed(() => (contractId.value ? t('contracts.edit') : t('contracts.new')));
</script>

<template>
  <div>
    <PageHeader :title="heading" back="/contracts" />

    <ContractDetailPanel :contract-id="contractId" />
  </div>
</template>
