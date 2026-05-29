import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { costsApi } from '@/services/api/costs.api';
import { useApiError } from './useApiError';
import { useToast } from './useToast';
import { toDateInput } from '@/lib/date';
import { CostCategory } from '@/types/enums';
import type { CreateCostInput } from '@/types/cost';

interface FormState {
  projectId: string;
  category: CostCategory;
  materialId: string | null;
  description: string;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  totalAmount: number | null;
  date: string;
  notes: string | null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function useCostForm(id?: string, initialProjectId?: string) {
  const router = useRouter();
  const toast = useToast();
  const { t } = useI18n();
  const { fieldErrors, handle, clear } = useApiError();

  const isEdit = Boolean(id);
  const loading = ref(false);
  const submitting = ref(false);

  const form = ref<FormState>({
    projectId: initialProjectId ?? '',
    category: CostCategory.MATERIAL,
    materialId: null,
    description: '',
    quantity: null,
    unit: null,
    unitPrice: null,
    totalAmount: null,
    date: todayIso(),
    notes: null,
  });

  async function load() {
    if (!id) return;
    loading.value = true;
    clear();
    try {
      const c = await costsApi.get(id);
      form.value = {
        projectId: c.projectId,
        category: c.category,
        materialId: c.materialId,
        description: c.description,
        quantity: c.quantity === null ? null : Number(c.quantity),
        unit: c.unit,
        unitPrice: c.unitPrice === null ? null : Number(c.unitPrice),
        totalAmount: Number(c.totalAmount),
        date: toDateInput(c.date),
        notes: c.notes,
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
      // Backend computes totalAmount from qty*unitPrice when both are set
      // and the field is omitted. We only forward totalAmount when the user
      // typed it explicitly (non-null and non-zero — zero means "free").
      const payload: CreateCostInput = {
        projectId: form.value.projectId,
        category: form.value.category,
        materialId: form.value.materialId,
        description: form.value.description,
        quantity: form.value.quantity,
        unit: form.value.unit,
        unitPrice: form.value.unitPrice,
        ...(form.value.totalAmount !== null
          ? { totalAmount: form.value.totalAmount }
          : {}),
        date: form.value.date,
        notes: form.value.notes,
      };
      if (id) {
        const { projectId: _drop, ...patch } = payload;
        void _drop;
        await costsApi.update(id, patch);
      } else {
        await costsApi.create(payload);
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
