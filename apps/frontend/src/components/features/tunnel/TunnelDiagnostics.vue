<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@/i18n';
import { useTunnelStore } from '@/stores/tunnel.store';
import DateDisplay from '@/components/shared/DateDisplay.vue';

const store = useTunnelStore();

interface Row {
  label: string;
  value: string;
  mono?: boolean;
  status?: 'ok' | 'warn' | 'bad';
}

const placeholder = '—';

const rows = computed<Row[]>(() => {
  const s = store.status;
  if (!s) return [];
  return [
    { label: t('tunnel.diagnostics.subdomain'), value: s.subdomain ?? placeholder, mono: true },
    { label: t('tunnel.diagnostics.tunnelId'), value: s.tunnelId ?? placeholder, mono: true },
    { label: t('tunnel.diagnostics.machineId'), value: s.machineId, mono: true },
    {
      label: t('tunnel.diagnostics.cloudflaredAvailable'),
      value: s.cloudflaredAvailable ? t('common.yes') : t('common.no'),
      status: s.cloudflaredAvailable ? 'ok' : 'bad',
    },
    {
      label: t('tunnel.diagnostics.configExists'),
      value: s.configExists ? t('common.yes') : t('common.no'),
      status: s.configExists ? 'ok' : s.enabled ? 'bad' : 'warn',
    },
    {
      label: t('tunnel.diagnostics.running'),
      value: s.running ? t('common.yes') : t('common.no'),
      status: s.running ? 'ok' : s.enabled ? 'bad' : 'warn',
    },
  ];
});

function statusColor(s?: Row['status']) {
  if (s === 'ok') return 'success';
  if (s === 'bad') return 'error';
  if (s === 'warn') return 'warning';
  return undefined;
}
</script>

<template>
  <v-card variant="outlined" rounded="lg" class="pa-5">
    <div class="text-subtitle-1 font-medium mb-3">
      {{ t('tunnel.diagnostics.title') }}
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
      <div
        v-for="row in rows"
        :key="row.label"
        class="flex items-center justify-between gap-3 py-1 border-b border-opacity-10 last:border-0"
      >
        <span class="text-caption text-medium-emphasis">{{ row.label }}</span>
        <span
          class="text-body-2 text-end truncate"
          :class="{
            'font-mono': row.mono,
            'text-success': statusColor(row.status) === 'success',
            'text-error': statusColor(row.status) === 'error',
            'text-warning': statusColor(row.status) === 'warning',
          }"
          :title="row.value"
        >
          {{ row.value }}
        </span>
      </div>
    </div>

    <div v-if="store.status" class="mt-4 flex items-center gap-2 text-caption text-medium-emphasis">
      <v-icon icon="mdi-update" size="small" />
      <span>{{ t('tunnel.diagnostics.lastUpdated') }}:</span>
      <DateDisplay :value="store.status.updatedAt" />
    </div>

    <div v-if="store.lastError" class="mt-4">
      <div class="text-caption text-medium-emphasis mb-1">
        {{ t('tunnel.diagnostics.lastError') }}
      </div>
      <pre class="text-caption text-error whitespace-pre-wrap break-words mb-0">{{ store.lastError }}</pre>
    </div>
  </v-card>
</template>
