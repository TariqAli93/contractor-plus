<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import CustomerForm from '@/components/features/customer/CustomerForm.vue';

const route = useRoute();
const { t } = useI18n();

const customerId = computed(() => {
  const id = route.params.id;
  return typeof id === 'string' ? id : undefined;
});

const heading = computed(() => (customerId.value ? t('customers.edit') : t('customers.new')));
</script>

<template>
  <div>
    <div class="flex items-center gap-2 mb-4">
      <v-btn icon="mdi-arrow-right" variant="text" to="/customers" />
      <h1 class="text-h5">{{ heading }}</h1>
    </div>

    <CustomerForm :id="customerId" />
  </div>
</template>
