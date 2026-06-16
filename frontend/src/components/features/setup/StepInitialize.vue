<script setup lang="ts">
import { useSetupStore } from '@/stores/setup.store';
import type { DesktopStepStatus } from '@/types/desktop';

defineEmits<{ back: [] }>();

const setup = useSetupStore();

const ICON: Record<DesktopStepStatus, string> = {
  pending: 'mdi-circle-outline',
  loading: 'mdi-loading',
  success: 'mdi-check-circle',
  error: 'mdi-alert-circle',
};
const COLOR: Record<DesktopStepStatus, string> = {
  pending: 'rgba(148,163,184,0.5)',
  loading: 'rgb(var(--v-theme-info))',
  success: 'rgb(var(--v-theme-success))',
  error: 'rgb(var(--v-theme-error))',
};

function retry(): void {
  void setup.runInitialize();
}
</script>

<template>
  <div>
    <h3 class="step-title">جارٍ تهيئة النظام</h3>
    <p class="step-sub">يرجى الانتظار حتى تكتمل جميع الخطوات. قد يستغرق ذلك بضع لحظات.</p>

    <ul class="check">
      <li v-for="item in setup.checklist" :key="item.id" class="row" :class="item.status">
        <v-icon
          :icon="ICON[item.status]"
          :class="{ spin: item.status === 'loading' }"
          :style="{ color: COLOR[item.status] }"
          size="22"
        />
        <div class="row-text">
          <span class="row-label">{{ item.label }}</span>
          <span v-if="item.message && item.status === 'error'" class="row-msg">{{ item.message }}</span>
        </div>
      </li>
    </ul>

    <v-alert
      v-if="setup.initError"
      type="error"
      variant="tonal"
      density="comfortable"
      class="mt-4"
      :text="setup.initError"
    />

    <div class="nav">
      <v-btn
        variant="text"
        prepend-icon="mdi-arrow-right"
        :disabled="setup.initializing"
        @click="$emit('back')"
      >
        رجوع
      </v-btn>
      <v-btn
        v-if="setup.initError && !setup.initializing"
        color="primary"
        variant="flat"
        prepend-icon="mdi-refresh"
        @click="retry"
      >
        إعادة المحاولة
      </v-btn>
      <v-progress-circular v-else-if="setup.initializing" indeterminate color="primary" size="26" />
    </div>
  </div>
</template>

<style scoped>
.step-title {
  font-size: 1.25rem;
  font-weight: 700;
  margin-bottom: 4px;
}
.step-sub {
  color: rgba(203, 213, 225, 0.72);
  font-size: 0.9rem;
  margin-bottom: 20px;
  line-height: 1.7;
}
.check {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(148, 163, 184, 0.06);
  border: 1px solid transparent;
  transition: all 0.25s ease;
}
.row.loading {
  background: rgba(56, 189, 248, 0.08);
  border-color: rgba(56, 189, 248, 0.25);
}
.row.success {
  background: rgba(34, 197, 94, 0.07);
}
.row.error {
  background: rgba(248, 113, 113, 0.09);
  border-color: rgba(248, 113, 113, 0.3);
}
.row-text {
  display: flex;
  flex-direction: column;
}
.row-label {
  font-size: 0.94rem;
  color: rgba(226, 232, 240, 0.92);
}
.row-msg {
  font-size: 0.78rem;
  color: rgb(var(--v-theme-error));
  margin-top: 2px;
}
.nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 24px;
  min-height: 40px;
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
