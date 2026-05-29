<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { t } from '@/i18n';
import { useTunnel } from '@/composables/useTunnel';
import { useTunnelStore } from '@/stores/tunnel.store';
import { useCan } from '@/composables/useCan';
import { RoleName } from '@/types/enums';
import DashboardSection from './DashboardSection.vue';

const { refresh, toneLabel, copyPublicUrl } = useTunnel();
const store = useTunnelStore();
const { can } = useCan();

const ADMIN_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN];

onMounted(() => {
  if (!store.initialized) void refresh({ silent: true });
});

const orbClass = computed(() => {
  switch (store.tone) {
    case 'green':
      return 'cp-orb cp-orb--success cp-orb--pulse';
    case 'yellow':
      return 'cp-orb cp-orb--warning';
    case 'red':
      return 'cp-orb cp-orb--error';
    default:
      return 'cp-orb';
  }
});
</script>

<template>
  <DashboardSection :title="t('tunnel.page.title')" icon="mdi-tunnel">
    <template #action>
      <v-btn
        v-if="can(ADMIN_ROLES)"
        variant="text"
        size="small"
        append-icon="mdi-arrow-left"
        to="/tunnel"
      >
        {{ t('tunnel.actions.manage') }}
      </v-btn>
    </template>

    <div class="p-4 space-y-3">
      <div class="flex items-center justify-between gap-3">
        <span class="text-medium-emphasis text-sm">{{ t('tunnel.status.label') }}</span>
        <span class="inline-flex items-center gap-2 font-medium text-sm">
          <span :class="orbClass" aria-hidden="true" />
          {{ toneLabel }}
        </span>
      </div>

      <div
        v-if="store.publicUrl"
        class="cp-tunnel-url"
      >
        <v-icon icon="mdi-link-variant" size="16" class="cp-tunnel-url__icon" />
        <a
          :href="store.publicUrl"
          target="_blank"
          rel="noopener"
          class="cp-tunnel-url__link"
        >
          {{ store.publicUrl }}
        </a>
        <v-btn
          icon="mdi-content-copy"
          size="x-small"
          variant="text"
          density="comfortable"
          :aria-label="t('tunnel.actions.copyUrl')"
          @click="copyPublicUrl"
        />
      </div>

      <div v-if="!store.cloudflaredAvailable" class="cp-tunnel-msg cp-tunnel-msg--warning">
        <v-icon icon="mdi-alert-outline" size="16" />
        <span>{{ t('tunnel.errors.binaryMissing.title') }}</span>
      </div>

      <div v-else-if="store.lastError" class="cp-tunnel-msg cp-tunnel-msg--error">
        <v-icon icon="mdi-alert-circle-outline" size="16" />
        <span class="line-clamp-2">{{ store.lastError }}</span>
      </div>
    </div>
  </DashboardSection>
</template>

<style scoped>
.cp-tunnel-url {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--cp-surface-2);
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-sm);
  font-size: 0.85rem;
}
.cp-tunnel-url__icon {
  color: var(--cp-text-muted);
  flex-shrink: 0;
}
.cp-tunnel-url__link {
  color: var(--cp-primary);
  flex: 1;
  min-width: 0;
  word-break: break-all;
  text-decoration: none;
}
.cp-tunnel-url__link:hover {
  text-decoration: underline;
}
.cp-tunnel-msg {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--cp-radius-sm);
  font-size: 0.8rem;
}
.cp-tunnel-msg--warning {
  background: var(--cp-warning-soft);
  color: var(--cp-warning);
}
.cp-tunnel-msg--error {
  background: var(--cp-error-soft);
  color: var(--cp-error);
}
</style>
