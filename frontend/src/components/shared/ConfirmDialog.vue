<script setup lang="ts">
import { t } from '@/i18n';
import { useConfirm } from '@/composables/useConfirm';

const { state, resolve } = useConfirm();
</script>

<template>
  <v-dialog
    :model-value="state.active"
    max-width="420"
    persistent
    @update:model-value="(v) => !v && resolve(false)"
  >
    <v-card>
      <v-card-title class="text-h6">{{ state.options.title }}</v-card-title>
      <v-card-text>{{ state.options.message }}</v-card-text>
      <v-card-actions class="px-4 pb-4">
        <v-spacer />
        <v-btn variant="text" @click="resolve(false)">
          {{ state.options.cancelText || t('common.cancel') }}
        </v-btn>
        <v-btn
          :color="state.options.destructive ? 'error' : 'primary'"
          variant="flat"
          @click="resolve(true)"
        >
          {{ state.options.confirmText || t('common.confirm') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
