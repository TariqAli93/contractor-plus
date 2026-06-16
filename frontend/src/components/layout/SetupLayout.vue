<script setup lang="ts">
// Dark, full-screen shell for the first-run setup wizard. Forces the dark
// Vuetify theme regardless of the user's saved preference so the installer
// experience always looks like a polished desktop setup.
</script>

<template>
  <v-app>
    <v-theme-provider theme="contractorPlusDark" with-background>
      <v-main>
        <div class="setup-bg">
          <div class="setup-center">
            <router-view />
          </div>
        </div>
      </v-main>
    </v-theme-provider>
  </v-app>
</template>

<style scoped>
.setup-bg {
  min-height: 100vh;
  background:
    radial-gradient(1100px 700px at 50% -15%, rgba(79, 155, 208, 0.18) 0%, transparent 55%),
    linear-gradient(160deg, #0f172a 0%, #131c30 55%, #0b1220 100%);
}
.setup-center {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px 20px;
}
</style>
