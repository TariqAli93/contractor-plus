<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useSetupStore } from '@/stores/setup.store';

const setup = useSetupStore();
const router = useRouter();

const copied = ref(false);
const loggingIn = ref(false);
const loginError = ref<string | null>(null);

async function copyCredentials(): Promise<void> {
  const c = setup.credentials;
  if (!c) return;
  const text = `اسم المستخدم: ${c.username}\nالرمز السري: ${c.pin}`;
  try {
    await navigator.clipboard.writeText(text);
    copied.value = true;
    window.setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    /* clipboard blocked — user can still read the values on screen */
  }
}

function printCredentials(): void {
  window.print();
}

async function goToLogin(): Promise<void> {
  loggingIn.value = true;
  loginError.value = null;
  try {
    const res = await setup.completeAndLaunch();
    if (!res.ok) {
      loginError.value = res.error ?? 'تعذّر بدء التطبيق.';
      return;
    }
    // In production the main process navigates the window to the backend origin;
    // in dev we route to the login screen ourselves.
    await router.push({ name: 'login' }).catch(() => undefined);
  } catch {
    loginError.value = 'تعذّر بدء التطبيق.';
  } finally {
    loggingIn.value = false;
  }
}
</script>

<template>
  <div v-if="setup.credentials" class="success">
    <div class="hero">
      <v-avatar size="56" color="success" class="mb-2">
        <v-icon icon="mdi-check-bold" size="32" />
      </v-avatar>
      <h2 class="title">تم الإعداد بنجاح</h2>
      <p class="lead">تم تجهيز النظام وإنشاء حسابك. هذه بيانات الدخول الخاصة بك.</p>
    </div>

    <div class="creds">
      <div class="cred-row">
        <span class="cred-label">اسم المستخدم</span>
        <span class="cred-value" dir="ltr">{{ setup.credentials.username }}</span>
      </div>
      <v-divider />
      <div class="cred-row">
        <span class="cred-label">الرمز السري (PIN)</span>
        <span class="cred-value" dir="ltr">{{ setup.credentials.pin }}</span>
      </div>
    </div>

    <v-alert
      type="warning"
      variant="tonal"
      density="comfortable"
      class="mt-3"
      icon="mdi-alert"
      text="احفظ هذه البيانات الآن في مكان آمن — لن يظهر الرمز السري مرة أخرى."
    />

    <div class="tools">
      <v-btn variant="tonal" size="small" :color="copied ? 'success' : undefined" prepend-icon="mdi-content-copy" @click="copyCredentials">
        {{ copied ? 'تم النسخ' : 'نسخ' }}
      </v-btn>
      <v-btn variant="tonal" size="small" prepend-icon="mdi-printer" @click="printCredentials">طباعة</v-btn>
      <v-btn variant="tonal" size="small" prepend-icon="mdi-file-document-outline" @click="setup.exportTxt()">
        تصدير TXT
      </v-btn>
      <v-btn variant="tonal" size="small" prepend-icon="mdi-file-pdf-box" @click="setup.exportPdf()">
        تصدير PDF
      </v-btn>
    </div>

    <v-alert
      v-if="loginError"
      type="error"
      variant="tonal"
      density="compact"
      class="mt-3"
      :text="loginError"
    />

    <v-btn
      block
      color="primary"
      size="large"
      variant="flat"
      class="mt-4"
      append-icon="mdi-login"
      :loading="loggingIn"
      @click="goToLogin"
    >
      تسجيل الدخول
    </v-btn>
  </div>
</template>

<style scoped>
.success {
  text-align: center;
}
.hero {
  margin-bottom: 18px;
}
.title {
  font-size: 1.4rem;
  font-weight: 700;
}
.lead {
  color: rgba(203, 213, 225, 0.78);
  font-size: 0.92rem;
  margin-top: 4px;
}
.creds {
  background: rgba(148, 163, 184, 0.08);
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 14px;
  padding: 4px 18px;
  text-align: start;
}
.cred-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 0;
}
.cred-label {
  color: rgba(203, 213, 225, 0.72);
  font-size: 0.9rem;
}
.cred-value {
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: 1px;
  color: #fff;
}
.tools {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin-top: 16px;
}
</style>
