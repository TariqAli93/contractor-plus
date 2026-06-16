<script setup lang="ts">
import TopBar from './TopBar.vue';
import SideNav from './SideNav.vue';
</script>

<template>
  <v-app>
    <TopBar />
    <SideNav />
    <v-main class="cp-main">
      <div class="cp-page">
        <router-view v-slot="{ Component, route }">
          <transition name="cp-fade" mode="out-in">
            <component :is="Component" :key="route.fullPath" />
          </transition>
        </router-view>
      </div>
    </v-main>
  </v-app>
</template>

<style scoped>
.cp-main {
  background: var(--cp-bg);
}
.cp-page {
  margin-inline: auto;
  padding: 24px clamp(16px, 3vw, 32px) 48px;
}
@media (max-width: 600px) {
  .cp-page {
    padding: 16px 12px 32px;
  }
}
</style>
