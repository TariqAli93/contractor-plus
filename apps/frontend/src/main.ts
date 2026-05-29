import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { vuetify } from "./plugins/vuetify";
import { useAuthStore } from "./stores/auth.store";
import { useThemeStore } from "./stores/theme.store";
import { registerAuthBindings } from "./services/api/client";

import "./assets/styles/main.css";

async function bootstrap() {
  const app = createApp(App);
  const pinia = createPinia();

  // 1. Pinia must be installed before any store is used.
  app.use(pinia);

  // 2. Arabic-only, RTL. (index.html already sets these, but keep them
  //    authoritative here in case the document is reused.)
  document.documentElement.lang = "ar";
  document.documentElement.dir = "rtl";

  // 3. Plugins.
  app.use(vuetify);

  // 3b. Apply the persisted/system theme and start watching OS changes.
  useThemeStore().initializeTheme();

  // 4. Wire the axios client to the auth store (avoids circular import).
  const auth = useAuthStore();
  registerAuthBindings({
    getAccessToken: () => auth.accessToken,
    setAccessToken: (t) => {
      auth.accessToken = t;
    },
    onAuthFailure: async () => {
      auth.clear();
      if (router.currentRoute.value.name !== "login") {
        await router.push({ name: "login" });
      }
    },
  });

  // 5. Try to restore the session BEFORE mounting so the first guard sees
  //    the hydrated store and we don't flash /login for logged-in users.
  await auth.initialize();

  // 5b. If the session restored, prime app-wide settings (currency + logo)
  //     so the first paint already has the branded layout. Soft fail —
  //     non-admins simply see the fallback app icon, that's expected.
  if (auth.isAuthenticated) {
    const { useSettingsStore } = await import('./stores/settings.store');
    const settings = useSettingsStore();
    void settings.ensureCompanyAssetsLoaded();
    void settings.ensureLoaded();
  }

  // 6. Router last (its guards depend on the auth store).
  app.use(router);

  await router.isReady();
  app.mount("#app");
}

void bootstrap();
