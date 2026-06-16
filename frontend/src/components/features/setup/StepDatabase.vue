<script setup lang="ts">
import { ref } from 'vue';
import { useSetupStore } from '@/stores/setup.store';

defineEmits<{ next: []; back: [] }>();

const setup = useSetupStore();
const showPassword = ref(false);
const testing = ref(false);
const result = ref<{ ok: boolean; message: string } | null>(null);

function onFieldInput(): void {
  // Editing any field invalidates a previous successful test.
  setup.invalidateConnection();
  result.value = null;
}

async function test(): Promise<void> {
  testing.value = true;
  result.value = null;
  try {
    result.value = await setup.testConnection();
  } catch {
    result.value = { ok: false, message: 'تعذّر إجراء الاختبار.' };
  } finally {
    testing.value = false;
  }
}

const requiredRule = (v: unknown) => (!!v && String(v).trim().length > 0) || ' ';
</script>

<template>
  <div>
    <h3 class="step-title">إعداد قاعدة البيانات</h3>
    <p class="step-sub">
      أدخل بيانات خادم PostgreSQL. سيتم استخدام حساب المدير للاتصال وإنشاء قاعدة البيانات.
    </p>

    <v-form @submit.prevent="test">
      <div class="grid">
        <v-text-field
          v-model="setup.db.host"
          label="المضيف (Host)"
          prepend-inner-icon="mdi-server-network"
          :rules="[requiredRule]"
          hide-details="auto"
          @update:model-value="onFieldInput"
        />
        <v-text-field
          v-model.number="setup.db.port"
          label="المنفذ (Port)"
          type="number"
          prepend-inner-icon="mdi-numeric"
          :rules="[requiredRule]"
          hide-details="auto"
          @update:model-value="onFieldInput"
        />
      </div>

      <v-text-field
        v-model="setup.db.database"
        label="اسم قاعدة البيانات"
        prepend-inner-icon="mdi-database"
        hint="ستُنشأ تلقائياً إن لم تكن موجودة"
        persistent-hint
        :rules="[requiredRule]"
        class="mt-3"
        @update:model-value="onFieldInput"
      />

      <div class="grid mt-3">
        <v-text-field
          v-model="setup.db.adminUser"
          label="اسم مستخدم المدير"
          prepend-inner-icon="mdi-account-tie"
          :rules="[requiredRule]"
          hide-details="auto"
          autocomplete="off"
          @update:model-value="onFieldInput"
        />
        <v-text-field
          v-model="setup.db.adminPassword"
          label="كلمة مرور المدير"
          :type="showPassword ? 'text' : 'password'"
          prepend-inner-icon="mdi-lock"
          :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
          hide-details="auto"
          autocomplete="off"
          @click:append-inner="showPassword = !showPassword"
          @update:model-value="onFieldInput"
        />
      </div>

      <div class="test-row">
        <v-btn
          variant="tonal"
          color="info"
          prepend-icon="mdi-lan-connect"
          :loading="testing"
          @click="test"
        >
          اختبار الاتصال
        </v-btn>
        <v-fade-transition>
          <span v-if="result" class="test-result" :class="result.ok ? 'ok' : 'err'">
            <v-icon :icon="result.ok ? 'mdi-check-circle' : 'mdi-alert-circle'" size="18" />
            {{ result.message }}
          </span>
        </v-fade-transition>
      </div>

      <v-alert
        v-if="setup.connectionVerified"
        type="success"
        variant="tonal"
        density="comfortable"
        class="mt-3"
        text="تم الاتصال بنجاح. يمكنك المتابعة إلى الخطوة التالية."
      />
    </v-form>

    <div class="nav">
      <v-btn variant="text" prepend-icon="mdi-arrow-right" @click="$emit('back')">رجوع</v-btn>
      <v-btn
        color="primary"
        variant="flat"
        append-icon="mdi-arrow-left"
        :disabled="!setup.connectionVerified"
        @click="$emit('next')"
      >
        التالي
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
.step-title {
  font-size: 1.25rem;
  font-weight: 700;
  margin-bottom: 4px;
}
.step-sub {
  color: rgba(203, 213, 225, 0.72);
  font-size: 0.9rem;
  margin-bottom: 18px;
  line-height: 1.7;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.test-row {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 18px;
  flex-wrap: wrap;
}
.test-result {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.88rem;
}
.test-result.ok {
  color: rgb(var(--v-theme-success));
}
.test-result.err {
  color: rgb(var(--v-theme-error));
}
.nav {
  display: flex;
  justify-content: space-between;
  margin-top: 26px;
}
</style>
