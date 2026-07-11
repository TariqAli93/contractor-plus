import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { TunnelStatusResponse } from '@/services/api/tunnel.api';

// Holds the last server response verbatim plus in-flight flags. The store is
// the single source of truth: the dashboard widget, the topbar chip, and the
// /tunnel view all read from here and never optimistically mutate it - every
// state change comes from a server response we received back.

export type TunnelTone = 'green' | 'yellow' | 'red' | 'gray';

export const useTunnelStore = defineStore('tunnel', () => {
  const status = ref<TunnelStatusResponse | null>(null);

  // Discrete in-flight flags so the UI can show "refreshing…" without
  // disabling the action buttons, and vice versa.
  const refreshing = ref(false);
  const acting = ref(false);

  // True only after the very first successful fetch - used to choose between
  // skeleton-on-empty vs preserve-last-known on subsequent refreshes.
  const initialized = ref(false);

  function setStatus(next: TunnelStatusResponse) {
    status.value = next;
    initialized.value = true;
  }

  function reset() {
    status.value = null;
    refreshing.value = false;
    acting.value = false;
    initialized.value = false;
  }

  // Convenience selectors. Components import these to avoid recomputing
  // the same fallback chains in template land.
  const enabled = computed(() => status.value?.enabled ?? false);
  const running = computed(() => status.value?.running ?? false);
  const publicUrl = computed(() => status.value?.publicUrl ?? null);
  const lastError = computed(() => status.value?.lastError ?? null);
  const cloudflaredAvailable = computed(() => status.value?.cloudflaredAvailable ?? true);
  const configExists = computed(() => status.value?.configExists ?? false);

  // Single source of truth for the colored-dot semantic. Every chip,
  // widget, and view derives its color from this - no per-component drift.
  //   red    = something is broken we need the user to act on
  //   yellow = transient or partially-working (starting, warning)
  //   green  = enabled + running + no error
  //   gray   = feature is off and there's nothing to report
  const tone = computed<TunnelTone>(() => {
    const s = status.value;
    if (!s) return 'gray';
    if (s.lastError) return 'red';
    if (s.enabled && !s.cloudflaredAvailable) return 'red';
    if (s.enabled && !s.configExists) return 'red';
    if (s.enabled && !s.running) return 'yellow';
    if (s.enabled && s.running) return 'green';
    return 'gray';
  });

  return {
    status,
    refreshing,
    acting,
    initialized,
    setStatus,
    reset,
    enabled,
    running,
    publicUrl,
    lastError,
    cloudflaredAvailable,
    configExists,
    tone,
  };
});
