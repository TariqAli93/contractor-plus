<script setup lang="ts">
// Bottom application status bar — the strip every desktop business app carries:
// connection/ready state on the inline-start, current section in the middle,
// signed-in user + a live clock on the inline-end. Dense, quiet, always-on.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { t, te } from '@/i18n';
import { useAuthStore } from '@/stores/auth.store';

const route = useRoute();
const auth = useAuthStore();

// Section label from the first path segment, reusing the nav i18n keys.
const sectionKey = computed(() => {
  const seg = route.path.split('/').filter(Boolean)[0];
  if (!seg) return 'nav.dashboard';
  return `nav.${seg}`;
});
const sectionLabel = computed(() => (te(sectionKey.value) ? t(sectionKey.value) : ''));

const roleLabel = computed(() => {
  const r = auth.user?.role;
  if (!r) return '';
  return te(`roles.${r}`) ? t(`roles.${r}`) : (auth.user?.roleDisplayName ?? r);
});

// Live clock — ticks once a minute (HH:MM granularity), Arabic weekday/date.
const now = ref(new Date());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  timer = setInterval(() => (now.value = new Date()), 30_000);
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});

const timeFmt = new Intl.DateTimeFormat('ar', { hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('ar', { weekday: 'long', day: 'numeric', month: 'long' });
const timeStr = computed(() => timeFmt.format(now.value));
const dateStr = computed(() => dateFmt.format(now.value));
</script>

<template>
  <v-footer app class="cp-statusbar" tag="footer">
    <div class="cp-statusbar-item">
      <span class="cp-orb cp-orb--success" />
      <span>{{ t('statusbar.ready') }}</span>
    </div>

    <div v-if="sectionLabel" class="cp-statusbar-item">
      {{ sectionLabel }}
    </div>

    <v-spacer />

    <div v-if="auth.user" class="cp-statusbar-item">
      <v-icon size="13">mdi-account-circle-outline</v-icon>
      <span>{{ auth.user.fullName }}</span>
      <span v-if="roleLabel" class="cp-statusbar-role">· {{ roleLabel }}</span>
    </div>

    <div class="cp-statusbar-item cp-statusbar-item--tabular">
      <v-icon size="13">mdi-calendar-blank-outline</v-icon>
      <span>{{ dateStr }}</span>
    </div>
    <div class="cp-statusbar-item cp-statusbar-item--tabular">
      <v-icon size="13">mdi-clock-outline</v-icon>
      <span>{{ timeStr }}</span>
    </div>
  </v-footer>
</template>

<style scoped>
.cp-statusbar-role {
  color: var(--cp-text-subtle);
}
</style>
