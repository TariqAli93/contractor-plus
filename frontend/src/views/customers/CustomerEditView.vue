<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { t } from '@/i18n';
import CustomerForm from '@/components/features/customer/CustomerForm.vue';
import PageHeader from '@/components/shared/PageHeader.vue';

const route = useRoute();

const customerId = computed(() => {
  const id = route.params.id;
  return typeof id === 'string' ? id : undefined;
});

const heading = computed(() => (customerId.value ? t('customers.edit') : t('customers.new')));
</script>

<template>
  <div>
    <PageHeader :title="heading" back="/customers" />

    <CustomerForm :id="customerId" />
  </div>
</template>
