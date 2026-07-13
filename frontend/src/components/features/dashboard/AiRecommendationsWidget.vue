<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { t } from '@/i18n';
import { aiApi } from '@/services/api/ai.api';
import { useAccess } from '@/composables/useAccess';
import { useConfirm } from '@/composables/useConfirm';
import { useToast } from '@/composables/useToast';
import { ApiError } from '@/types/api';
import type { RecommendationItem, RecommendationsResult } from '@/types/ai';
import DashboardSection from './DashboardSection.vue';
import EmptyState from '@/components/shared/EmptyState.vue';

// AI pattern findings over the same data the Delayed/Overdue widgets show.
// Read + Suggest only: the sole mutation is the explicit apply, which creates
// a DRAFT change order the change-orders approval flow still governs.
const { hasPermission } = useAccess();
const { confirm } = useConfirm();
const toast = useToast();

const canView = computed(() => hasPermission('ai.view-recommendations'));
const canApply = computed(() => hasPermission('ai.apply-suggestions'));

const data = ref<RecommendationsResult | null>(null);
const loading = ref(false);
const failed = ref(false);
const actingOn = ref<string | null>(null);

const top = computed(() => (data.value?.items ?? []).slice(0, 6));

async function fetch() {
  if (!canView.value) return;
  loading.value = true;
  failed.value = false;
  try {
    data.value = await aiApi.recommendations();
  } catch {
    // Quiet failure: the dashboard must never break because of this widget.
    failed.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(fetch);

async function apply(item: RecommendationItem) {
  if (!item.suggestionId) return;
  const ok = await confirm({
    title: t('dashboard.aiRecommendations.confirmApplyTitle'),
    message: t('dashboard.aiRecommendations.confirmApplyText', {
      contract: item.contractNumber ?? item.projectName ?? '',
    }),
    confirmText: t('dashboard.aiRecommendations.apply'),
    cancelText: t('common.cancel'),
  });
  if (!ok) return;
  actingOn.value = item.suggestionId;
  try {
    const result = await aiApi.applySuggestion(item.suggestionId);
    toast.success(
      t('dashboard.aiRecommendations.applied', { number: result.changeOrder.number }),
    );
    await fetch();
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : t('dashboard.aiRecommendations.applyFailed'));
  } finally {
    actingOn.value = null;
  }
}

async function reject(item: RecommendationItem) {
  if (!item.suggestionId) return;
  actingOn.value = item.suggestionId;
  try {
    await aiApi.rejectSuggestion(item.suggestionId);
    toast.info(t('dashboard.aiRecommendations.rejected'));
    await fetch();
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : t('dashboard.aiRecommendations.applyFailed'));
  } finally {
    actingOn.value = null;
  }
}

const severityColor: Record<RecommendationItem['severity'], string> = {
  critical: 'error',
  warning: 'warning',
  info: 'default',
};
</script>

<template>
  <DashboardSection
    v-if="canView"
    :title="t('dashboard.aiRecommendations.title')"
    icon="mdi-auto-fix"
  >
    <template #action>
      <v-btn
        variant="text"
        size="small"
        prepend-icon="mdi-refresh"
        :loading="loading"
        @click="fetch"
      >
        {{ t('dashboard.refresh') }}
      </v-btn>
    </template>

    <div v-if="loading && !data" class="p-2">
      <v-skeleton-loader v-for="i in 2" :key="i" type="list-item-two-line" class="px-2" />
    </div>

    <p v-else-if="failed" class="cp-ai-recs__quiet">
      {{ t('dashboard.aiRecommendations.failed') }}
    </p>

    <div v-else-if="top.length > 0">
      <div v-for="item in top" :key="item.id" class="cp-ai-recs__row">
        <div class="cp-ai-recs__head">
          <v-chip :color="severityColor[item.severity]" size="x-small" variant="tonal" label>
            {{ t(`dashboard.aiRecommendations.severity.${item.severity}`) }}
          </v-chip>
          <span class="cp-ai-recs__title">{{ item.title }}</span>
        </div>
        <p class="cp-ai-recs__detail">{{ item.detail }}</p>
        <p v-if="item.aiAdvice" class="cp-ai-recs__advice">
          <v-icon icon="mdi-lightbulb-on-outline" size="13" />
          {{ item.aiAdvice }}
        </p>
        <div v-if="item.applicable && item.suggestionId && canApply" class="cp-ai-recs__actions">
          <v-btn
            size="x-small"
            color="primary"
            variant="tonal"
            :loading="actingOn === item.suggestionId"
            @click="apply(item)"
          >
            {{ t('dashboard.aiRecommendations.apply') }}
          </v-btn>
          <v-btn
            size="x-small"
            variant="text"
            :disabled="actingOn === item.suggestionId"
            @click="reject(item)"
          >
            {{ t('dashboard.aiRecommendations.reject') }}
          </v-btn>
        </div>
      </div>
      <p v-if="data?.aiEnriched" class="cp-ai-recs__quiet cp-ai-recs__footer">
        {{ t('dashboard.aiRecommendations.enrichedBy', { model: data.modelUsed ?? '' }) }}
      </p>
    </div>

    <EmptyState
      v-else
      :title="t('dashboard.aiRecommendations.empty')"
      icon="mdi-check-circle-outline"
      compact
    />
  </DashboardSection>
</template>

<style scoped>
.cp-ai-recs__row {
  padding: 8px 12px;
  border-block-end: 1px solid var(--cp-border);
}
.cp-ai-recs__row:last-of-type {
  border-block-end: none;
}
.cp-ai-recs__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cp-ai-recs__title {
  font-size: 0.8rem;
  font-weight: 500;
}
.cp-ai-recs__detail {
  margin: 3px 0 0;
  font-size: 0.76rem;
  color: var(--cp-text-muted);
  line-height: 1.6;
}
.cp-ai-recs__advice {
  display: flex;
  align-items: baseline;
  gap: 5px;
  margin: 4px 0 0;
  font-size: 0.74rem;
  line-height: 1.6;
}
.cp-ai-recs__actions {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.cp-ai-recs__quiet {
  margin: 0;
  padding: 8px 12px;
  font-size: 0.74rem;
  color: var(--cp-text-muted);
}
.cp-ai-recs__footer {
  padding-block: 4px;
  border-block-start: 1px solid var(--cp-border);
  direction: ltr;
  text-align: end;
}
</style>
