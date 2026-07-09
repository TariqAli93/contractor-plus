<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useSetupStore, APP_NAME } from '@/stores/setup.store';
import StepWelcome from '@/components/features/setup/StepWelcome.vue';
import StepDatabase from '@/components/features/setup/StepDatabase.vue';
import StepUser from '@/components/features/setup/StepUser.vue';
import StepInitialize from '@/components/features/setup/StepInitialize.vue';
import StepSuccess from '@/components/features/setup/StepSuccess.vue';

const setup = useSetupStore();

// 1=welcome 2=database 3=user 4=initialize 5=success (header caps at 4).
const step = ref(1);

const headerSteps = [
  { n: 1, label: 'الترحيب', icon: 'mdi-hand-wave' },
  { n: 2, label: 'قاعدة البيانات', icon: 'mdi-database' },
  { n: 3, label: 'المستخدم الأول', icon: 'mdi-account-key' },
  { n: 4, label: 'تهيئة النظام', icon: 'mdi-cog-sync' },
];
const activeHeader = computed(() => Math.min(step.value, 4));

function goNext(): void {
  if (step.value < 5) step.value += 1;
}
function goBack(): void {
  if (step.value > 1) step.value -= 1;
}

// Entering the initialization step kicks off the work automatically.
watch(step, (value) => {
  if (value === 4) void setup.runInitialize();
});

// When initialization finishes successfully, reveal the success screen.
watch(
  () => setup.initDone,
  (done) => {
    if (done && step.value === 4) step.value = 5;
  },
);
</script>

<template>
  <v-card class="setup-card" elevation="12" rounded="xl">
    <!-- Brand header -->
    <div class="setup-head">
      <div class="brand">
        <v-avatar size="40" color="primary" class="brand-badge">
          <v-icon icon="mdi-office-building" size="24" />
        </v-avatar>
        <div>
          <div class="brand-name">{{ APP_NAME }}</div>
          <div class="brand-sub">إعداد النظام لأول مرة</div>
        </div>
      </div>
      <div v-if="setup.appVersion" class="version">الإصدار {{ setup.appVersion }}</div>
    </div>

    <!-- Step indicator -->
    <div class="steps">
      <template v-for="(s, i) in headerSteps" :key="s.n">
        <div class="step" :class="{ active: activeHeader === s.n, done: activeHeader > s.n }">
          <div class="dot">
            <v-icon v-if="activeHeader > s.n" icon="mdi-check" size="18" />
            <span v-else>{{ s.n }}</span>
          </div>
          <div class="step-label">{{ s.label }}</div>
        </div>
        <div v-if="i < headerSteps.length - 1" class="rail" :class="{ filled: activeHeader > s.n }" />
      </template>
    </div>

    <v-divider class="opacity-25" />

    <!-- Step content -->
    <div class="setup-body">
      <v-window v-model="step" :touch="false" class="setup-window">
        <v-window-item :value="1">
          <StepWelcome @next="goNext" />
        </v-window-item>
        <v-window-item :value="2">
          <StepDatabase @next="goNext" @back="goBack" />
        </v-window-item>
        <v-window-item :value="3">
          <StepUser @next="goNext" @back="goBack" />
        </v-window-item>
        <v-window-item :value="4">
          <StepInitialize @back="goBack" />
        </v-window-item>
        <v-window-item :value="5">
          <StepSuccess />
        </v-window-item>
      </v-window>
    </div>
  </v-card>
</template>

<style scoped>
.setup-card {
  width: 100%;
  max-width: 600px;
  background: rgba(23, 33, 53, 0.92);
  border: 1px solid rgba(148, 163, 184, 0.16);
  backdrop-filter: blur(6px);
  overflow: hidden;
}
.setup-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 16px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}
.brand-badge {
  box-shadow: 0 6px 18px rgba(79, 155, 208, 0.35);
}
.brand-name {
  font-size: 1.05rem;
  font-weight: 700;
  line-height: 1.2;
}
.brand-sub {
  font-size: 0.78rem;
  color: rgba(203, 213, 225, 0.7);
}
.version {
  font-size: 0.72rem;
  color: rgba(148, 163, 184, 0.7);
}

.steps {
  display: flex;
  align-items: center;
  padding: 8px 24px 18px;
  gap: 6px;
}
.step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 56px;
}
.dot {
  width: 34px;
  height: 34px;
  border-radius: var(--cp-radius-pill);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.9rem;
  background: rgba(148, 163, 184, 0.16);
  color: rgba(203, 213, 225, 0.75);
  border: 1px solid transparent;
  transition: all 0.25s ease;
}
.step.active .dot {
  background: rgb(var(--v-theme-primary));
  color: #06121f;
  box-shadow: 0 6px 16px rgba(79, 155, 208, 0.45);
}
.step.done .dot {
  background: rgba(34, 197, 94, 0.2);
  color: rgb(var(--v-theme-success));
  border-color: rgba(34, 197, 94, 0.5);
}
.step-label {
  font-size: 0.72rem;
  color: rgba(203, 213, 225, 0.6);
  white-space: nowrap;
}
.step.active .step-label {
  color: rgba(226, 232, 240, 0.95);
  font-weight: 600;
}
.rail {
  flex: 1;
  height: 2px;
  background: rgba(148, 163, 184, 0.18);
  border-radius: var(--cp-radius-sm);
  margin-bottom: 22px;
  transition: background 0.3s ease;
}
.rail.filled {
  background: rgba(34, 197, 94, 0.5);
}

.setup-body {
  padding: 26px 28px 30px;
}
.setup-window {
  overflow: visible;
}
</style>
