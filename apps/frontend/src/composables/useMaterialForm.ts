import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { materialsApi } from '@/services/api/materials.api';
import { useApiError } from './useApiError';
import { useToast } from './useToast';
import type { CreateMaterialInput } from '@/types/material';

export function useMaterialForm(id?: string) {
  const router = useRouter();
  const toast = useToast();
  const { t } = useI18n();
  const { fieldErrors, handle, clear } = useApiError();

  const isEdit = Boolean(id);
  const loading = ref(false);
  const submitting = ref(false);

  const form = ref<CreateMaterialInput>({
    name: '',
    unit: '',
    defaultPrice: null,
    notes: null,
    isActive: true,
  });

  async function load() {
    if (!id) return;
    loading.value = true;
    clear();
    try {
      const m = await materialsApi.get(id);
      form.value = {
        name: m.name,
        unit: m.unit,
        // Decimal arrives as string; the form input wants a number.
        defaultPrice: m.defaultPrice !== null ? Number(m.defaultPrice) : null,
        notes: m.notes,
        isActive: m.isActive,
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
      if (id) {
        await materialsApi.update(id, form.value);
      } else {
        await materialsApi.create(form.value);
      }
      toast.success(t('common.saved'));
      await router.push('/materials');
    } catch (e) {
      handle(e);
    } finally {
      submitting.value = false;
    }
  }

  function cancel() {
    void router.push('/materials');
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
