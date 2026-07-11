<script setup lang="ts">
// The window is frameless, so this screen - which renders outside AppLayout and
// therefore has no title bar - must supply its own drag strip. Without it the
// sign-in window cannot be moved. The strip leaves the caption buttons alone by
// starting where `titlebar-area-x` starts.
</script>

<template>
  <v-app>
    <div class="cp-drag cp-login-titlebar" />
    <v-main class="bg-background">
      <div class="min-h-screen flex items-center justify-center px-4">
        <router-view />
      </div>
    </v-main>
  </v-app>
</template>

<style scoped>
.cp-login-titlebar {
  position: fixed;
  inset-block-start: 0;
  inset-inline: 0;
  height: var(--cp-titlebar-h);
  z-index: 1;
  background: var(--cp-surface);
  border-block-end: 1px solid var(--cp-border);
}
</style>
