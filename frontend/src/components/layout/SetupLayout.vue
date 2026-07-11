<script setup lang="ts">
// Setup uses the same opaque, single light theme as the completed application.
</script>

<template>
  <v-app>
    <div class="cp-drag setup-titlebar" />
    <v-main>
      <div class="setup-bg">
        <div class="setup-center">
          <router-view />
        </div>
      </div>
    </v-main>
  </v-app>
</template>

<style scoped>
.setup-titlebar {
  position: fixed;
  inset-block-start: 0;
  inset-inline: 0;
  height: var(--cp-titlebar-h);
  z-index: 1;
  background: var(--cp-surface);
  border-block-end: 1px solid var(--cp-border);
}
.setup-bg {
  min-height: 100vh;
  background: var(--cp-bg);
}
.setup-center {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px 20px;
}
</style>
