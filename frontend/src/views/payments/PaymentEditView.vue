<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { t } from '@/i18n';
import PaymentForm from '@/components/features/payment/PaymentForm.vue';
import PageHeader from '@/components/shared/PageHeader.vue';

const route = useRoute();

const paymentId = computed(() => {
  const id = route.params.id;
  return typeof id === 'string' && id !== 'new' ? id : undefined;
});

const initialProjectId = computed(() => {
  const qp = route.query.projectId;
  return typeof qp === 'string' && qp.length > 0 ? qp : undefined;
});

const heading = computed(() => (paymentId.value ? t('payments.edit') : t('payments.new')));
</script>

<template>
  <div>
    <PageHeader :title="heading" back="/payments" />

    <PaymentForm :id="paymentId" :initial-project-id="initialProjectId" />
  </div>
</template>
