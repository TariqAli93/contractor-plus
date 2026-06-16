<script setup lang="ts">
import type { ContractItem } from '@/types/contract';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';

defineProps<{ item: ContractItem }>();
</script>

<template>
  <tr>
    <td>{{ item.material.name }}</td>
    <td>{{ item.unit }}</td>
    <td class="text-end">{{ Number(item.quantity) }}</td>
    <td class="text-end"><MoneyDisplay :amount="item.estimatedPrice" /></td>
    <td>{{ item.notes ?? '—' }}</td>
  </tr>
</template>
