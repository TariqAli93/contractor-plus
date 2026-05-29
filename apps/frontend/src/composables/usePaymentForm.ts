import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { t } from '@/i18n';
import { paymentsApi } from '@/services/api/payments.api';
import { useApiError } from './useApiError';
import { useToast } from './useToast';
import { toDateInput } from '@/lib/date';
import type { CreatePaymentInput } from '@/types/payment';
import type { PaymentMethod } from '@/types/enums';

interface FormState {
  projectId: string;
  amount: number | null;
  dueDate: string;
  method: PaymentMethod | null;
  reference: string | null;
  notes: string | null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function usePaymentForm(id?: string, initialProjectId?: string) {
  const router = useRouter();
  const toast = useToast();
  const { fieldErrors, handle, clear } = useApiError();

  const isEdit = Boolean(id);
  const loading = ref(false);
  const submitting = ref(false);

  const form = ref<FormState>({
    projectId: initialProjectId ?? '',
    amount: null,
    dueDate: todayIso(),
    method: null,
    reference: null,
    notes: null,
  });

  async function load() {
    if (!id) return;
    loading.value = true;
    clear();
    try {
      const p = await paymentsApi.get(id);
      form.value = {
        projectId: p.projectId,
        amount: Number(p.amount),
        dueDate: toDateInput(p.dueDate),
        method: p.method,
        reference: p.reference,
        notes: p.notes,
      };
    } catch (e) {
      handle(e);
    } finally {
      loading.value = false;
    }
  }

  async function submit() {
    clear();
    submitting.value = true;
    try {
      const payload: CreatePaymentInput = {
        projectId: form.value.projectId,
        amount: form.value.amount ?? 0,
        dueDate: form.value.dueDate,
        method: form.value.method,
        reference: form.value.reference,
        notes: form.value.notes,
      };
      if (id) {
        const { projectId: _drop, ...patch } = payload;
        void _drop;
        await paymentsApi.update(id, patch);
      } else {
        await paymentsApi.create(payload);
      }
      toast.success(t('common.saved'));
      void router.back();
    } catch (e) {
      handle(e);
    } finally {
      submitting.value = false;
    }
  }

  function cancel() {
    void router.back();
  }

  return {
    form,
    isEdit,
    loading,
    submitting,
    fieldErrors,
    load,
    submit,
    cancel,
  };
}
