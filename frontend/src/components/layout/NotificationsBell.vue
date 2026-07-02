<script setup lang="ts">
// Topbar alerts bell: a count badge + dropdown of actionable alerts (delayed
// projects, overdue payments) pulled from existing report endpoints via
// useAlerts. Each item deep-links to its project. Self-gated to roles that act
// on these (VIEWER excluded); the backend still enforces per-endpoint.
import { computed, onMounted } from 'vue';
import { t } from '@/i18n';
import { useAlerts } from '@/composables/useAlerts';
import { useAccess } from '@/composables/useAccess';
import { RoleName } from '@/types/enums';

const { canAccess } = useAccess();
const canSee = computed(() =>
  canAccess({ roles: [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT, RoleName.ENGINEER] }),
);

const { items, count, loading, refresh } = useAlerts();

onMounted(() => {
  if (canSee.value) void refresh();
});
</script>

<template>
  <v-menu v-if="canSee" offset="10" location="bottom end" :close-on-content-click="true">
    <template #activator="{ props }">
      <v-btn v-bind="props" icon variant="text" class="me-1" :aria-label="t('alerts.title')">
        <v-badge :model-value="count > 0" :content="count" color="error">
          <v-icon>mdi-bell-outline</v-icon>
        </v-badge>
      </v-btn>
    </template>

    <v-card min-width="360" max-width="440">
      <v-card-title class="d-flex align-center text-subtitle-1 py-2">
        <span>{{ t('alerts.title') }}</span>
        <v-spacer />
        <v-btn
          icon="mdi-refresh"
          size="x-small"
          variant="text"
          :loading="loading"
          @click.stop="refresh"
        />
      </v-card-title>
      <v-divider />

      <v-list v-if="items.length" density="compact" max-height="440" class="overflow-y-auto py-0">
        <v-list-item v-for="a in items" :key="a.id" :to="a.to" lines="two">
          <template #prepend>
            <v-icon :color="a.severity" class="me-2">
              {{ a.kind === 'overdue' ? 'mdi-cash-clock' : 'mdi-clock-alert-outline' }}
            </v-icon>
          </template>
          <v-list-item-title class="font-medium">{{ a.title }}</v-list-item-title>
          <v-list-item-subtitle>{{ a.subtitle }}</v-list-item-subtitle>
        </v-list-item>
      </v-list>

      <div v-else class="pa-6 text-center text-medium-emphasis">
        <v-icon size="32" color="success" class="mb-2 d-block mx-auto">mdi-check-circle-outline</v-icon>
        {{ t('alerts.empty') }}
      </div>
    </v-card>
  </v-menu>
</template>
