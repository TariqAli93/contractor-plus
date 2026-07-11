<script setup lang="ts">
import { computed, ref } from 'vue';
import { useSetupStore } from '@/stores/setup.store';

const emit = defineEmits<{ next: []; back: [] }>();

const setup = useSetupStore();
const showPin = ref(false);

const usernameError = computed(() => {
  const u = setup.owner.username.trim().toLowerCase();
  if (!u) return 'أدخل اسم المستخدم';
  if (u.length < 3) return 'اسم المستخدم 3 أحرف على الأقل';
  if (!/^[a-z0-9._-]+$/.test(u)) return 'يُسمح بالحروف الإنجليزية والأرقام والنقطة والشرطة فقط';
  return '';
});

const pinError = computed(() => {
  const p = setup.owner.pin;
  if (!p) return 'أدخل الرمز السري';
  if (!/^\d+$/.test(p)) return 'الرمز السري أرقام فقط';
  if (p.length < 4) return 'الرمز السري 4 أرقام على الأقل';
  return '';
});

const confirmError = computed(() => {
  if (!setup.owner.confirmPin) return 'أعد إدخال الرمز السري';
  if (setup.owner.confirmPin !== setup.owner.pin) return 'الرمز السري غير متطابق';
  return '';
});

const showErrors = ref(false);
const isValid = computed(
  () => !usernameError.value && !pinError.value && !confirmError.value,
);

function onlyDigits(model: 'pin' | 'confirmPin', value: string): void {
  setup.owner[model] = value.replace(/\D/g, '');
}

function submit(): void {
  showErrors.value = true;
  if (isValid.value) emit('next');
}
</script>

<template>
  <div>
    <h3 class="step-title">إنشاء أول مستخدم</h3>
    <p class="step-sub">
      هذا الحساب هو حساب المدير العام (Super Admin) بأعلى صلاحيات. احفظ بياناته جيداً.
    </p>

    <v-form @submit.prevent="submit">
      <v-text-field
        v-model="setup.owner.username"
        label="اسم المستخدم"
        prepend-inner-icon="mdi-account"
        autocomplete="off"
        dir="ltr"
        :error-messages="showErrors && usernameError ? [usernameError] : []"
        hide-details="auto"
      />

      <v-text-field
        v-model="setup.owner.pin"
        label="الرمز السري (PIN)"
        :type="showPin ? 'text' : 'password'"
        inputmode="numeric"
        prepend-inner-icon="mdi-form-textbox-password"
        :append-inner-icon="showPin ? 'mdi-eye-off' : 'mdi-eye'"
        autocomplete="off"
        dir="ltr"
        class="mt-3"
        :error-messages="showErrors && pinError ? [pinError] : []"
        hide-details="auto"
        @click:append-inner="showPin = !showPin"
        @update:model-value="(v) => onlyDigits('pin', v)"
      />

      <v-text-field
        v-model="setup.owner.confirmPin"
        label="تأكيد الرمز السري"
        :type="showPin ? 'text' : 'password'"
        inputmode="numeric"
        prepend-inner-icon="mdi-form-textbox-password"
        autocomplete="off"
        dir="ltr"
        class="mt-3"
        :error-messages="showErrors && confirmError ? [confirmError] : []"
        hide-details="auto"
        @update:model-value="(v) => onlyDigits('confirmPin', v)"
      />

      <v-alert
        type="info"
        variant="tonal"
        density="comfortable"
        class="mt-4"
        icon="mdi-shield-account"
        text="سيتم تخزين الرمز السري بشكل مشفّر (hash) ولن يُحفظ كنص صريح."
      />
    </v-form>

    <div class="nav">
      <v-btn variant="text" prepend-icon="mdi-arrow-right" @click="$emit('back')">رجوع</v-btn>
      <v-btn color="primary" variant="flat" append-icon="mdi-arrow-left" @click="submit">التالي</v-btn>
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
  color: var(--cp-text-muted);
  font-size: 0.9rem;
  margin-bottom: 12px;
  line-height: 1.5;
}
.nav {
  display: flex;
  justify-content: space-between;
  margin-top: 14px;
}
</style>
