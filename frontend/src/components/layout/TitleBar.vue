<script setup lang="ts">
// The application title bar. Windows draws the caption buttons (Snap Layouts and
// RTL placement come free); we own the strip they sit in and report what the
// window currently holds - "‹app› - ‹section›", the way a document-oriented
// desktop program titles itself.
//
// The whole strip is a drag region. Anything interactive inside it must opt out
// with `.cp-no-drag`, or the pointer will move the window instead of clicking.
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { t, te } from '@/i18n';

const route = useRoute();

const APP_TITLE = 'إدارة المقاولات';

// The active section, resolved from the first path segment against the nav keys
// the sidebar already uses - one vocabulary, not two.
const sectionLabel = computed(() => {
  const seg = route.path.split('/').filter(Boolean)[0];
  if (!seg) return t('nav.dashboard');
  const key = `nav.${seg}`;
  return te(key) ? t(key) : '';
});
</script>

<template>
  <div class="cp-titlebar">
    <div class="cp-titlebar__area">
      <span class="cp-titlebar__app">{{ APP_TITLE }}</span>
      <template v-if="sectionLabel">
        <span class="cp-titlebar__dash" aria-hidden="true">-</span>
        <span class="cp-titlebar__doc">{{ sectionLabel }}</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.cp-titlebar {
  position: relative;
  height: var(--cp-titlebar-h);
  flex: none;
  background: var(--cp-surface);
  border-block-end: 1px solid var(--cp-border);
  -webkit-app-region: drag;
  user-select: none;
}

/* `titlebar-area-*` is the rectangle Windows leaves us beside its caption
   buttons. The vars are physical (left/width), not logical, so they stay correct
   when Windows moves the buttons to the inline-start edge under RTL. Outside the
   overlay (plain browser, Linux frame) the fallbacks give the full strip. */
.cp-titlebar__area {
  position: absolute;
  top: 0;
  left: env(titlebar-area-x, 0px);
  width: env(titlebar-area-width, 100%);
  height: var(--cp-titlebar-h);
  display: flex;
  align-items: center;
  gap: 6px;
  padding-inline: 10px;
  font-size: 0.75rem;
  overflow: hidden;
  white-space: nowrap;
}

.cp-titlebar__app {
  font-weight: 600;
  color: var(--cp-text);
}
.cp-titlebar__dash,
.cp-titlebar__doc {
  color: var(--cp-text-muted);
}
.cp-titlebar__doc {
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
