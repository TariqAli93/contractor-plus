<script setup lang="ts">
import { onMounted, ref, watch, computed } from 'vue';
import { t } from '@/i18n';
import { aiApi } from '@/services/api/ai.api';
import { useAccess } from '@/composables/useAccess';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';
import type { ReferencePrice } from '@/types/ai';

// Latest EXTERNAL reference price for a material (Phase 5). Purely
// informational, sits under the manual "default price" field. Renders nothing
// when the user lacks ai.use, when no reference price exists yet, or when the
// fetch fails — it must never get in the way of editing a material.
const props = defineProps<{ materialId?: string }>();

const { hasPermission } = useAccess();
const canSee = computed(() => hasPermission('ai.use'));

const price = ref<ReferencePrice | null>(null);

async function load() {
  price.value = null;
  if (!props.materialId || !canSee.value) return;
  try {
    price.value = await aiApi.materialReferencePrice(props.materialId);
  } catch {
    // Offline / not-configured — stay silent, show nothing.
    price.value = null;
  }
}

onMounted(load);
watch(() => props.materialId, load);

// Flag prices whose SOURCE date is old, so an offline/stale figure is visible.
const STALE_DAYS = 60;
const isStale = computed(() => {
  if (!price.value) return false;
  const ageMs = Date.now() - new Date(price.value.referenceUpdatedAt).getTime();
  return ageMs > STALE_DAYS * 24 * 60 * 60 * 1000;
});
</script>

<template>
  <div v-if="price" class="cp-refprice md:col-span-2">
    <div class="cp-refprice__row">
      <span class="cp-refprice__label">
        <v-icon icon="mdi-tag-outline" size="14" />
        {{ t('materials.referencePrice.label') }}
      </span>
      <span class="cp-refprice__value">
        <MoneyDisplay :amount="price.price" :currency="price.currency" />
      </span>
    </div>
    <div class="cp-refprice__meta">
      <span>{{ t('materials.referencePrice.source') }}: {{ price.source }}</span>
      <span v-if="price.region" class="cp-refprice__dot">·</span>
      <span v-if="price.region">{{ price.region }}</span>
      <span class="cp-refprice__dot">·</span>
      <span :class="{ 'cp-refprice__stale': isStale }">
        {{ t('materials.referencePrice.asOf') }} <DateDisplay :value="price.referenceUpdatedAt" />
      </span>
      <span v-if="isStale" class="cp-refprice__stale-tag">{{ t('materials.referencePrice.stale') }}</span>
    </div>
  </div>
</template>

<style scoped>
.cp-refprice {
  padding: 8px 12px;
  background: var(--cp-surface-2);
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-sm);
  font-size: 0.78rem;
}
.cp-refprice__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.cp-refprice__label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--cp-text-muted);
}
.cp-refprice__value {
  font-weight: 600;
}
.cp-refprice__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  margin-top: 3px;
  color: var(--cp-text-muted);
  font-size: 0.72rem;
}
.cp-refprice__dot {
  opacity: 0.6;
}
.cp-refprice__stale {
  color: rgb(var(--v-theme-warning));
}
.cp-refprice__stale-tag {
  padding: 0 5px;
  color: rgb(var(--v-theme-warning));
  border: 1px solid rgb(var(--v-theme-warning));
  border-radius: 999px;
  font-size: 0.66rem;
}
</style>
