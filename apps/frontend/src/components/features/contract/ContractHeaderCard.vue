<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import type { ContractWithRelations } from '@/types/contract';
import DateDisplay from '@/components/shared/DateDisplay.vue';

defineProps<{ contract: ContractWithRelations }>();
const { t } = useI18n();
const router = useRouter();
</script>

<template>
  <v-card variant="outlined">
    <v-card-text class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div>
        <div class="text-medium-emphasis text-xs">{{ t('contracts.fields.contractNumber') }}</div>
        <div class="text-h6">{{ contract.contractNumber }}</div>
      </div>
      <div>
        <div class="text-medium-emphasis text-xs">{{ t('contracts.fields.customer') }}</div>
        <div class="text-subtitle-1">{{ contract.customer.name }}</div>
        <div v-if="contract.customer.phone" class="text-caption text-medium-emphasis">
          {{ contract.customer.phone }}
        </div>
      </div>
      <div>
        <div class="text-medium-emphasis text-xs">{{ t('contracts.fields.template') }}</div>
        <button
          v-if="contract.template"
          class="text-subtitle-1 text-start text-primary underline-offset-2 hover:underline"
          @click="router.push(`/templates/${contract.template!.id}`)"
        >
          {{ contract.template.name }}
        </button>
        <div v-else class="text-subtitle-1 text-medium-emphasis">—</div>
      </div>
      <div>
        <div class="text-medium-emphasis text-xs">{{ t('contracts.fields.signedAt') }}</div>
        <DateDisplay :value="contract.signedAt" />
      </div>
      <div>
        <div class="text-medium-emphasis text-xs">{{ t('contracts.fields.createdAt') }}</div>
        <DateDisplay :value="contract.createdAt" />
      </div>
    </v-card-text>
  </v-card>
</template>
