<script setup lang="ts">
import { t } from '@/i18n';
import { useThemeStore, type ThemeMode } from '@/stores/theme.store';

const theme = useThemeStore();

const options: Array<{ value: ThemeMode; label: string; icon: string }> = [
  { value: 'light', label: t('appearance.modes.light'), icon: 'mdi-weather-sunny' },
  { value: 'dark', label: t('appearance.modes.dark'), icon: 'mdi-weather-night' },
  { value: 'system', label: t('appearance.modes.system'), icon: 'mdi-monitor' },
];
</script>

<template>
  <div class="cp-panel p-4">
    <h2 class="cp-section-title mb-1">{{ t('appearance.title') }}</h2>
    <p class="text-medium-emphasis text-sm mb-4">{{ t('appearance.description') }}</p>

    <div class="cp-theme-grid">
      <button
        v-for="opt in options"
        :key="opt.value"
        type="button"
        class="cp-theme-card"
        :class="{ 'cp-theme-card--active': theme.mode === opt.value }"
        @click="theme.setTheme(opt.value)"
      >
        <v-icon size="22" class="mb-2">{{ opt.icon }}</v-icon>
        <span class="cp-theme-card__label">{{ opt.label }}</span>
        <v-icon
          v-if="theme.mode === opt.value"
          size="18"
          color="primary"
          class="cp-theme-card__check"
        >
          mdi-check-circle
        </v-icon>
      </button>
    </div>
  </div>
</template>

<style scoped>
.cp-theme-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  max-width: 520px;
}
.cp-theme-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px 12px;
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-md);
  background: var(--cp-surface);
  color: var(--cp-text);
  transition: border-color var(--cp-dur-fast) var(--cp-ease),
    background-color var(--cp-dur-fast) var(--cp-ease),
    box-shadow var(--cp-dur-fast) var(--cp-ease);
}
.cp-theme-card:hover {
  border-color: var(--cp-border-strong);
  background: var(--cp-surface-2);
}
.cp-theme-card--active {
  border-color: var(--cp-primary);
  background: var(--cp-primary-soft);
  color: var(--cp-primary);
  box-shadow: var(--cp-shadow-sm);
}
.cp-theme-card__label {
  font-size: 0.9rem;
  font-weight: 600;
}
.cp-theme-card__check {
  position: absolute;
  top: 8px;
  inset-inline-end: 8px;
}
</style>
