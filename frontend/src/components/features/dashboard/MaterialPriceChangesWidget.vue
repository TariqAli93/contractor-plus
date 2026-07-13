<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { t } from '@/i18n';
import { aiApi } from '@/services/api/ai.api';
import { useAccess } from '@/composables/useAccess';
import { useToast } from '@/composables/useToast';
import { ApiError } from '@/types/api';
import type { MaterialPriceChange } from '@/types/ai';
import DashboardSection from './DashboardSection.vue';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';
import EmptyState from '@/components/shared/EmptyState.vue';

// "تغير أسعار المواد" — movements in the external reference prices. Read-only
// insight; the manual sync (permissioned) refreshes the underlying data.
// Fully offline-tolerant: a failed load shows a quiet line, never breaks the
// dashboard, and any last-known prices already stored stay visible.
const { hasPermission } = useAccess();
const toast = useToast();

const canSee = computed(() => hasPermission('ai.use'));
const canSync = computed(() => hasPermission('ai.sync-material-prices'));

const items = ref<MaterialPriceChange[]>([]);
const loading = ref(false);
const syncing = ref(false);
const failed = ref(false);

const top = computed(() => items.value.slice(0, 6));

async function fetch() {
  if (!canSee.value) return;
  loading.value = true;
  failed.value = false;
  try {
    const res = await aiApi.materialPriceChanges();
    items.value = res.items;
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(fetch);

async function sync() {
  syncing.value = true;
  try {
    const result = await aiApi.syncMaterialPrices();
    if (!result.enabled) {
      toast.info(t('dashboard.materialPrices.noSources'));
    } else {
      toast.success(
        t('dashboard.materialPrices.synced', {
          inserted: result.inserted,
          errors: result.errors.length,
        }),
      );
    }
    await fetch();
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : t('dashboard.materialPrices.syncFailed'));
  } finally {
    syncing.value = false;
  }
}
</script>

<template>
  <DashboardSection
    v-if="canSee"
    :title="t('dashboard.materialPrices.title')"
    icon="mdi-chart-line-variant"
  >
    <template #action>
      <v-btn
        v-if="canSync"
        variant="text"
        size="small"
        prepend-icon="mdi-cloud-sync-outline"
        :loading="syncing"
        @click="sync"
      >
        {{ t('dashboard.materialPrices.sync') }}
      </v-btn>
    </template>

    <div v-if="loading && items.length === 0" class="p-2">
      <v-skeleton-loader v-for="i in 2" :key="i" type="list-item-two-line" class="px-2" />
    </div>

    <p v-else-if="failed" class="cp-mpc__quiet">{{ t('dashboard.materialPrices.failed') }}</p>

    <div v-else-if="top.length > 0">
      <div v-for="c in top" :key="c.materialId" class="cp-mpc__row">
        <div class="cp-mpc__main">
          <v-icon
            :icon="c.direction === 'up' ? 'mdi-arrow-up-bold' : 'mdi-arrow-down-bold'"
            :color="c.direction === 'up' ? 'error' : 'success'"
            size="16"
          />
          <span class="cp-mpc__name">{{ c.materialName }}</span>
        </div>
        <div class="cp-mpc__figures">
          <span :class="['cp-mpc__pct', c.direction === 'up' ? 'is-up' : 'is-down']">
            {{ c.changePercent > 0 ? '+' : '' }}{{ c.changePercent }}%
          </span>
          <span class="cp-mpc__price">
            <MoneyDisplay :amount="c.currentPrice" :currency="c.currency" />
          </span>
        </div>
      </div>
    </div>

    <EmptyState
      v-else
      :title="t('dashboard.materialPrices.empty')"
      icon="mdi-tag-outline"
      compact
    />
  </DashboardSection>
</template>

<style scoped>
.cp-mpc__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 12px;
  border-block-end: 1px solid var(--cp-border);
}
.cp-mpc__row:last-of-type {
  border-block-end: none;
}
.cp-mpc__main {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.cp-mpc__name {
  font-size: 0.8rem;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cp-mpc__figures {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.cp-mpc__pct {
  font-size: 0.78rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.cp-mpc__pct.is-up {
  color: rgb(var(--v-theme-error));
}
.cp-mpc__pct.is-down {
  color: rgb(var(--v-theme-success));
}
.cp-mpc__price {
  font-size: 0.76rem;
  color: var(--cp-text-muted);
}
.cp-mpc__quiet {
  margin: 0;
  padding: 8px 12px;
  font-size: 0.74rem;
  color: var(--cp-text-muted);
}
</style>
