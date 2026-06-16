<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { t } from '@/i18n';
import PaymentForm from '@/components/features/payment/PaymentForm.vue';

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
    <div class="flex items-center gap-2 mb-4">
      <v-btn icon="mdi-arrow-right" variant="text" to="/payments" />
      <h1 class="text-h5">{{ heading }}</h1>
    </div>

    <PaymentForm :id="paymentId" :initial-project-id="initialProjectId" />
  </div>
</template>
