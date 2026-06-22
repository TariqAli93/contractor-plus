import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import type {
  DesktopApi,
  DesktopCredentials,
  DesktopStepId,
  DesktopStepStatus,
} from '@/types/desktop';

/** Display name for the desktop app (installer/window/wizard). */
export const APP_NAME = 'إدارة المقاولات';

export interface ChecklistStep {
  id: DesktopStepId;
  label: string;
  status: DesktopStepStatus;
  message?: string;
}

const STEP_LABELS: Record<DesktopStepId, string> = {
  test: 'اختبار الاتصال بقاعدة البيانات',
  createdb: 'إنشاء قاعدة البيانات',
  migrate: 'تجهيز جداول النظام',
  owner: 'إنشاء المستخدم الأول',
  finalize: 'إنهاء الإعداد',
};

const STEP_ORDER: DesktopStepId[] = ['test', 'createdb', 'migrate', 'owner', 'finalize'];

function freshChecklist(): ChecklistStep[] {
  return STEP_ORDER.map((id) => ({ id, label: STEP_LABELS[id], status: 'pending' as DesktopStepStatus }));
}

export const useSetupStore = defineStore('setup', () => {
  const desktop: DesktopApi | undefined = typeof window !== 'undefined' ? window.desktop : undefined;
  const isDesktop = computed(() => Boolean(desktop?.isDesktop));

  const setupComplete = ref(false);
  const appVersion = ref('');

  // ----- Step 2: database connection -----
  const db = reactive({
    host: 'localhost',
    port: 5432,
    database: 'contractor_plus',
    adminUser: 'postgres',
    adminPassword: '',
  });
  const connectionVerified = ref(false);

  // ----- Step 3: first user -----
  const owner = reactive({ username: '', pin: '', confirmPin: '' });

  // ----- Step 4: initialization checklist -----
  const checklist = ref<ChecklistStep[]>(freshChecklist());
  const initializing = ref(false);
  const initDone = ref(false);
  const initError = ref<string | null>(null);

  // ----- Step 5: credentials (shown once) -----
  const credentials = ref<DesktopCredentials | null>(null);

  async function loadState(): Promise<void> {
    if (!desktop) return;
    try {
      const state = await desktop.getState();
      setupComplete.value = state.setupComplete;
      appVersion.value = state.appVersion;
      db.host = state.defaultDb.host;
      db.port = state.defaultDb.port;
      db.database = state.defaultDb.database;
      db.adminUser = state.defaultDb.adminUser;
    } catch {
      /* leave defaults; the wizard still works against manual input */
    }
  }

  /** Any edit to the connection fields invalidates a prior successful test. */
  function invalidateConnection(): void {
    connectionVerified.value = false;
  }

  async function testConnection(): Promise<{ ok: boolean; message: string }> {
    if (!desktop) return { ok: false, message: 'هذه الميزة متاحة في تطبيق سطح المكتب فقط.' };
    const res = await desktop.setup.testConnection({ ...db });
    connectionVerified.value = res.ok;
    return { ok: res.ok, message: res.message };
  }

  function normalizedUsername(): string {
    return owner.username.trim().toLowerCase();
  }

  async function runInitialize(): Promise<void> {
    if (!desktop) {
      initError.value = 'هذه الميزة متاحة في تطبيق سطح المكتب فقط.';
      return;
    }
    initializing.value = true;
    initDone.value = false;
    initError.value = null;
    checklist.value = freshChecklist();

    const setStep = (id: DesktopStepId, status: DesktopStepStatus, message?: string): void => {
      const step = checklist.value.find((s) => s.id === id);
      if (step) {
        step.status = status;
        step.message = message;
      }
    };

    const unsubscribe = desktop.setup.onProgress((event) => {
      setStep(event.step, event.status, event.message);
    });

    try {
      console.info('[setup/ui] initialize → sending');
      const res = await desktop.setup.initialize({
        db: { ...db },
        owner: { username: normalizedUsername(), pin: owner.pin },
      });
      console.info('[setup/ui] initialize ← ok=%s error=%s', res?.ok, res?.error ?? '-');
      if (res.ok) {
        initDone.value = true;
        credentials.value = {
          appName: APP_NAME,
          username: normalizedUsername(),
          pin: owner.pin,
          createdAt: new Date().toLocaleString('ar-IQ'),
        };
      } else {
        initError.value = res.error ?? 'تعذّر إكمال الإعداد.';
      }
    } catch {
      initError.value = 'حدث خطأ غير متوقع أثناء الإعداد.';
    } finally {
      unsubscribe();
      initializing.value = false;
    }
  }

  async function completeAndLaunch(): Promise<{ ok: boolean; error?: string }> {
    if (!desktop) return { ok: false, error: 'غير متاح.' };
    console.info('[setup/ui] complete → sending');
    const res = await desktop.setup.complete();
    console.info('[setup/ui] complete ← ok=%s error=%s', res?.ok, res?.error ?? '-');
    if (res.ok) setupComplete.value = true;
    return { ok: res.ok, error: res.error };
  }

  async function exportTxt(): Promise<void> {
    if (desktop && credentials.value) await desktop.exportTxt(credentials.value);
  }

  async function exportPdf(): Promise<void> {
    if (desktop && credentials.value) await desktop.exportPdf(credentials.value);
  }

  return {
    isDesktop,
    setupComplete,
    appVersion,
    db,
    connectionVerified,
    owner,
    checklist,
    initializing,
    initDone,
    initError,
    credentials,
    loadState,
    invalidateConnection,
    testConnection,
    runInitialize,
    completeAndLaunch,
    exportTxt,
    exportPdf,
  };
});
