<script setup lang="ts">
import { APP_NAME } from '@/stores/setup.store';

defineEmits<{ next: [] }>();

const points = [
  { icon: 'mdi-database-check', text: 'تجهيز قاعدة البيانات وإنشاء جداول النظام' },
  { icon: 'mdi-account-key', text: 'إنشاء حساب المدير الأول للدخول إلى البرنامج' },
  { icon: 'mdi-shield-lock', text: 'حفظ الإعدادات الحساسة بشكل مشفّر على جهازك' },
];
</script>

<template>
  <div class="welcome">
    <v-icon icon="mdi-rocket-launch-outline" size="46" color="primary" class="mb-3" />
    <h2 class="title">مرحباً بك في {{ APP_NAME }}</h2>
    <p class="lead">
      سيرشدك هذا المعالج خلال خطوات بسيطة لتجهيز البرنامج للعمل لأول مرة. لا تحتاج إلى أي خبرة تقنية
      — فقط اتبع الخطوات.
    </p>

    <div class="points">
      <div v-for="p in points" :key="p.text" class="point">
        <v-icon :icon="p.icon" size="22" color="primary" />
        <span>{{ p.text }}</span>
      </div>
    </div>

    <div class="actions">
      <v-btn color="primary" size="large" variant="flat" append-icon="mdi-arrow-left" @click="$emit('next')">
        التالي
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
.welcome {
  text-align: center;
}
.title {
  font-size: 1.45rem;
  font-weight: 700;
  margin-bottom: 10px;
}
.lead {
  color: rgba(203, 213, 225, 0.78);
  line-height: 1.9;
  max-width: 460px;
  margin: 0 auto 22px;
}
.points {
  display: flex;
  flex-direction: column;
  gap: 12px;
  text-align: start;
  max-width: 420px;
  margin: 0 auto 26px;
}
.point {
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(148, 163, 184, 0.08);
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: var(--cp-radius-xl);
  padding: 12px 14px;
  font-size: 0.92rem;
  color: rgba(226, 232, 240, 0.9);
}
.actions {
  display: flex;
  justify-content: center;
}
</style>
