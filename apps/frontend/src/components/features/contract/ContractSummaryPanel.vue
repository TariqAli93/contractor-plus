<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ContractWithRelations } from '@/types/contract';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';

const props = defineProps<{ contract: ContractWithRelations }>();
const { t } = useI18n();

const builtArea = computed(
  () => Number(props.contract.buildingArea) * props.contract.floors,
);
const itemsCount = computed(() => props.contract.items.length);
</script>

<template>
  <v-card variant="outlined">
    <v-card-title class="text-subtitle-1 font-medium">
      {{ t('contracts.summary.title') }}
    </v-card-title>
    <v-divider />
    <v-list density="compact">
      <v-list-item>
        <template #prepend>
          <v-icon icon="mdi-cash" />
        </template>
        <v-list-item-title>{{ t('contracts.summary.totalPrice') }}</v-list-item-title>
        <template #append>
          <MoneyDisplay :amount="contract.totalPrice" />
        </template>
      </v-list-item>
      <v-list-item>
        <template #prepend>
          <v-icon icon="mdi-ruler-square" />
        </template>
        <v-list-item-title>{{ t('contracts.summary.builtArea') }}</v-list-item-title>
        <template #append>{{ builtArea }} m²</template>
      </v-list-item>
      <v-list-item>
        <template #prepend>
          <v-icon icon="mdi-tag-outline" />
        </template>
        <v-list-item-title>{{ t('contracts.summary.meterPrice') }}</v-list-item-title>
        <template #append>
          <MoneyDisplay :amount="contract.meterPrice" />
        </template>
      </v-list-item>
      <v-list-item>
        <template #prepend>
          <v-icon icon="mdi-percent-outline" />
        </template>
        <v-list-item-title>{{ t('contracts.summary.profitMargin') }}</v-list-item-title>
        <template #append>
          {{ contract.expectedProfitMargin !== null ? `${contract.expectedProfitMargin}%` : '—' }}
        </template>
      </v-list-item>
      <v-divider />
      <v-list-item>
        <template #prepend>
          <v-icon icon="mdi-package-variant" />
        </template>
        <v-list-item-title>{{ t('contracts.summary.items') }}</v-list-item-title>
        <template #append>{{ itemsCount }}</template>
      </v-list-item>
      <v-list-item v-if="contract.project">
        <template #prepend>
          <v-icon icon="mdi-office-building-outline" />
        </template>
        <v-list-item-title>{{ t('contracts.summary.project') }}</v-list-item-title>
        <template #append>
          <RouterLink
            :to="`/projects/${contract.project.id}`"
            class="text-primary text-caption"
          >
            {{ contract.project.name }}
          </RouterLink>
        </template>
      </v-list-item>
    </v-list>
  </v-card>
</template>
