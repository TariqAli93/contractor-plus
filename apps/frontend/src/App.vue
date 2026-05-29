<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import LoginLayout from '@/components/layout/LoginLayout.vue';
import ConfirmDialog from '@/components/shared/ConfirmDialog.vue';
import { useToast } from '@/composables/useToast';

const route = useRoute();
const layout = computed(() => (route.meta.layout === 'login' ? LoginLayout : AppLayout));

const toast = useToast();
</script>

<template>
  <component :is="layout" />

  <!-- global confirm dialog host -->
  <ConfirmDialog />

  <!-- global toast host -->
  <v-snackbar
    v-for="t in toast.toasts"
    :key="t.id"
    :model-value="true"
    :color="t.kind"
    :timeout="t.timeout"
    location="top end"
    multi-line
  >
    <div class="flex flex-col">
      <div>{{ t.message }}</div>
      <div v-if="t.reqId" class="text-caption opacity-80">reqId: {{ t.reqId }}</div>
    </div>
    <template #actions>
      <v-btn variant="text" @click="toast.dismiss(t.id)">×</v-btn>
    </template>
  </v-snackbar>
</template>
