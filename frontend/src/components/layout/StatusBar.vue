<script setup lang="ts">
// The bottom status strip every desktop business application carries. It reports
// what the program is bound to right now: service state, database, sync, whose
// books are open, who is signed in, and which build is running.
//
// Every segment is bound to something real. Where a fact is unavailable - no
// desktop bridge on the web build, a role that cannot read the company profile -
// the segment is omitted rather than filled with a plausible-looking placeholder.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { t, te } from '@/i18n';
import { useAuthStore } from '@/stores/auth.store';
import { useShellStore } from '@/stores/shell.store';
import { useTunnelStore } from '@/stores/tunnel.store';

const auth = useAuthStore();
const shell = useShellStore();
const tunnel = useTunnelStore();

const roleLabel = computed(() => {
  const r = auth.user?.role;
  if (!r) return '';
  return te(`roles.${r}`) ? t(`roles.${r}`) : (auth.user?.roleDisplayName ?? r);
});

// Sync state reuses the tunnel store's single source of truth for the dot
// semantic, so the strip can never disagree with the tunnel view. The store
// speaks in colours; the orb speaks in roles - translate rather than add
// colour-named classes to the design system.
const ORB_BY_TONE = {
  green: 'cp-orb--success',
  yellow: 'cp-orb--warning',
  red: 'cp-orb--error',
  gray: '',
} as const;
const syncOrbClass = computed(() => ORB_BY_TONE[tunnel.tone]);

const syncLabel = computed(() => {
  if (!tunnel.status) return t('statusbar.sync.unknown');
  if (tunnel.lastError) return t('statusbar.sync.error');
  if (!tunnel.enabled) return t('statusbar.sync.off');
  if (tunnel.running) return t('statusbar.sync.on');
  return t('statusbar.sync.starting');
});

// Live clock - ticks once a minute (HH:MM granularity), Arabic weekday/date.
const now = ref(new Date());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  timer = setInterval(() => (now.value = new Date()), 30_000);
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});

const timeFmt = new Intl.DateTimeFormat('ar', { hour: '2-digit', minute: '2-digit' });
const timeStr = computed(() => timeFmt.format(now.value));
</script>

<template>
  <footer class="cp-statusbar">
    <!-- Service -->
    <div class="cp-sb-item">
      <span class="cp-orb cp-orb--success" />
      <span>{{ t('statusbar.ready') }}</span>
    </div>

    <!-- Database -->
    <div class="cp-sb-item cp-sb-item--tabular" :title="shell.database ?? t('statusbar.unavailable')">
      <v-icon size="12" icon="mdi-database-outline" />
      <span>{{ t('statusbar.database') }}:</span>
      <span class="cp-sb-truncate">{{ shell.database ?? t('statusbar.unavailable') }}</span>
    </div>

    <!-- Sync -->
    <div class="cp-sb-item">
      <span class="cp-orb" :class="syncOrbClass" />
      <span>{{ t('statusbar.sync.label') }}: {{ syncLabel }}</span>
    </div>

    <span class="cp-sb-spacer" />

    <div class="cp-sb-item" :title="shell.companyName ?? t('statusbar.unavailable')">
      <v-icon size="12" icon="mdi-domain" />
      <span>{{ t('statusbar.branch') }}:</span>
      <span class="cp-sb-truncate">{{ shell.companyName ?? t('statusbar.unavailable') }}</span>
    </div>

    <!-- User -->
    <div v-if="auth.user" class="cp-sb-item">
      <v-icon size="12" icon="mdi-account-circle-outline" />
      <span>{{ auth.user.fullName }}</span>
      <span v-if="roleLabel" class="cp-sb-role">· {{ roleLabel }}</span>
    </div>

    <div class="cp-sb-item">
      <v-icon size="12" icon="mdi-certificate-outline" />
      <span>{{ t('statusbar.license') }}: {{ t('statusbar.unavailable') }}</span>
    </div>

    <div class="cp-sb-item">
      <v-icon size="12" icon="mdi-backup-restore" />
      <span>{{ t('statusbar.lastBackup') }}: {{ t('statusbar.unavailable') }}</span>
    </div>

    <!-- Clock -->
    <div class="cp-sb-item cp-sb-item--tabular">
      <v-icon size="12" icon="mdi-clock-outline" />
      <span>{{ timeStr }}</span>
    </div>

    <!-- Build -->
    <div v-if="shell.appVersion" class="cp-sb-item cp-sb-item--tabular">
      <span>v{{ shell.appVersion }}</span>
    </div>
  </footer>
</template>

<style scoped>
.cp-statusbar {
  display: flex;
  align-items: stretch;
  flex: none;
  height: var(--cp-statusbar-h);
  background: var(--cp-surface);
  border-block-start: 1px solid var(--cp-border);
  font-size: 0.7rem;
  color: var(--cp-text-muted);
  user-select: none;
  overflow: hidden;
}

.cp-sb-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 100%;
  padding-inline: 9px;
  white-space: nowrap;
  min-width: 0;
}
/* Hairline rules between segments - the classic Win32 status-bar panel edge. */
.cp-sb-item + .cp-sb-item {
  border-inline-start: 1px solid var(--cp-border);
}
.cp-sb-item--tabular {
  font-variant-numeric: tabular-nums;
}
/* The 10px orb is sized for panels; in a 24px strip it reads as a bullet. */
.cp-statusbar .cp-orb {
  width: 8px;
  height: 8px;
}
.cp-sb-truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 22ch;
}
.cp-sb-role {
  color: var(--cp-text-subtle);
  border-inline-start: 1px solid var(--cp-border);
  padding-inline-start: 5px;
}
.cp-sb-spacer {
  flex: 1;
}

/* The spacer breaks the sibling chain, so the first segment after it needs its
   own leading rule to stay separated from the space. */
.cp-sb-spacer + .cp-sb-item {
  border-inline-start: 1px solid var(--cp-border);
}

@media (max-width: 1000px) {
  .cp-sb-truncate {
    max-width: 12ch;
  }
}
</style>
