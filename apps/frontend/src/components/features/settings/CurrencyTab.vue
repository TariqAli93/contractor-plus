<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { settingsApi } from '@/services/api/settings.api';
import { useToast } from '@/composables/useToast';
import { useApiError } from '@/composables/useApiError';
import { useConfirm } from '@/composables/useConfirm';
import { useSettingsStore } from '@/stores/settings.store';
import { formatMoney } from '@/lib/currency-format';
import type { Currency } from '@/types/settings';
import SettingsCard from './SettingsCard.vue';
import CurrencyDialog from './CurrencyDialog.vue';
import ErrorState from '@/components/shared/ErrorState.vue';
import EmptyState from '@/components/shared/EmptyState.vue';

const { t } = useI18n();
const toast = useToast();
const { handle } = useApiError();
const { confirm } = useConfirm();
const settingsStore = useSettingsStore();

const items = ref<Currency[]>([]);
const loading = ref(false);
const error = ref<unknown>(null);
const busyId = ref<string | null>(null);

const dialogOpen = ref(false);
const editing = ref<Currency | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const res = await settingsApi.listCurrencies();
    items.value = res.items;
    syncStoreDefault();
  } catch (e) {
    error.value = e;
  } finally {
    loading.value = false;
  }
}

function syncStoreDefault() {
  settingsStore.setDefaultCurrency(items.value.find((c) => c.isDefault) ?? null);
}

function openCreate() {
  editing.value = null;
  dialogOpen.value = true;
}

function openEdit(c: Currency) {
  editing.value = c;
  dialogOpen.value = true;
}

function onSaved() {
  void load();
}

async function setDefault(c: Currency) {
  if (c.isDefault || busyId.value) return;
  busyId.value = c.id;
  try {
    await settingsApi.setDefaultCurrency(c.id);
    toast.success(t('settings.saved'));
    await load();
  } catch (e) {
    handle(e);
  } finally {
    busyId.value = null;
  }
}

async function toggleActive(c: Currency) {
  if (busyId.value) return;
  busyId.value = c.id;
  try {
    await settingsApi.updateCurrency(c.id, { isActive: !c.isActive });
    toast.success(t('settings.saved'));
    await load();
  } catch (e) {
    handle(e);
  } finally {
    busyId.value = null;
  }
}

async function remove(c: Currency) {
  if (c.isDefault) {
    toast.error(t('settings.currency.errors.cannotDeleteDefault'));
    return;
  }
  const ok = await confirm({
    title: t('settings.currency.deleteConfirmTitle'),
    message: t('settings.currency.deleteConfirmMessage', { code: c.code }),
    destructive: true,
    confirmText: t('common.delete'),
    cancelText: t('common.cancel'),
  });
  if (!ok) return;
  busyId.value = c.id;
  try {
    await settingsApi.deleteCurrency(c.id);
    toast.success(t('common.deleted'));
    await load();
  } catch (e) {
    handle(e);
  } finally {
    busyId.value = null;
  }
}

function preview(c: Currency): string {
  return formatMoney(1234.56, { currency: c });
}

const hasItems = computed(() => items.value.length > 0);

onMounted(load);
</script>

<template>
  <SettingsCard
    :title="t('settings.currency.title')"
    :description="t('settings.currency.description')"
    icon="mdi-currency-usd"
  >
    <template #action>
      <v-btn
        color="primary"
        prepend-icon="mdi-plus"
        @click="openCreate"
      >
        {{ t('settings.currency.addNew') }}
      </v-btn>
    </template>

    <ErrorState v-if="error" :error="error" @retry="load" />

    <div v-else-if="loading && !hasItems" class="space-y-2">
      <v-skeleton-loader v-for="i in 3" :key="i" type="list-item-avatar-two-line" />
    </div>

    <EmptyState
      v-else-if="!hasItems"
      :title="t('settings.currency.empty')"
      icon="mdi-currency-usd-off"
      compact
    >
      <v-btn class="mt-2" color="primary" prepend-icon="mdi-plus" @click="openCreate">
        {{ t('settings.currency.addNew') }}
      </v-btn>
    </EmptyState>

    <ul v-else class="cp-currency-list">
      <li
        v-for="c in items"
        :key="c.id"
        class="cp-currency-row"
        :class="{ 'cp-currency-row--inactive': !c.isActive }"
      >
        <div class="cp-currency-row__main">
          <div class="cp-currency-row__avatar">
            <span class="cp-currency-row__symbol">{{ c.symbol }}</span>
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-medium">{{ c.code }}</span>
              <span class="text-medium-emphasis">·</span>
              <span class="text-medium-emphasis text-sm truncate">{{ c.name }}</span>
              <v-chip
                v-if="c.isDefault"
                size="x-small"
                color="primary"
                variant="tonal"
                prepend-icon="mdi-star"
              >
                {{ t('settings.currency.defaultBadge') }}
              </v-chip>
              <v-chip
                v-if="!c.isActive"
                size="x-small"
                color="warning"
                variant="tonal"
              >
                {{ t('settings.currency.inactiveBadge') }}
              </v-chip>
            </div>
            <div class="text-caption text-medium-emphasis mt-0.5 tabular-nums">
              {{ preview(c) }}
            </div>
          </div>
        </div>

        <div class="cp-currency-row__actions">
          <v-btn
            v-if="!c.isDefault && c.isActive"
            size="small"
            variant="text"
            prepend-icon="mdi-star-outline"
            :loading="busyId === c.id"
            @click="setDefault(c)"
          >
            {{ t('settings.currency.setDefault') }}
          </v-btn>
          <v-btn
            size="small"
            variant="text"
            :prepend-icon="c.isActive ? 'mdi-pause' : 'mdi-play'"
            :disabled="c.isDefault && c.isActive"
            :loading="busyId === c.id"
            @click="toggleActive(c)"
          >
            {{ c.isActive ? t('settings.currency.deactivate') : t('settings.currency.activate') }}
          </v-btn>
          <v-btn
            icon="mdi-pencil-outline"
            size="small"
            variant="text"
            :aria-label="t('common.edit')"
            @click="openEdit(c)"
          />
          <v-btn
            icon="mdi-delete-outline"
            size="small"
            variant="text"
            color="error"
            :disabled="c.isDefault"
            :aria-label="t('common.delete')"
            @click="remove(c)"
          />
        </div>
      </li>
    </ul>

    <CurrencyDialog
      v-model="dialogOpen"
      :currency="editing"
      @saved="onSaved"
    />
  </SettingsCard>
</template>

<style scoped>
.cp-currency-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.cp-currency-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-md);
  background: var(--cp-surface);
  transition: border-color var(--cp-dur-base) var(--cp-ease),
    box-shadow var(--cp-dur-base) var(--cp-ease);
  flex-wrap: wrap;
}
.cp-currency-row:hover {
  border-color: var(--cp-border-strong);
  box-shadow: var(--cp-shadow-sm);
}
.cp-currency-row--inactive {
  opacity: 0.7;
}
.cp-currency-row__main {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1;
}
.cp-currency-row__avatar {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--cp-primary-soft);
  color: var(--cp-primary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  flex-shrink: 0;
}
.cp-currency-row__symbol {
  font-size: 1rem;
  font-weight: 700;
  line-height: 1;
}
.cp-currency-row__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
</style>
