import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { contractsApi } from '@/services/api/contracts.api';
import { useApiError } from './useApiError';
import { useToast } from './useToast';
import type { CreateContractInput } from '@/types/contract';

// Owns the General tab form. Loads itself by id (consistent with
// useCustomerForm / useMaterialForm / useTemplateForm). CREATE redirects to
// /contracts/<newId> so the user can continue to estimate + approval flow.
export function useContractForm(id?: string) {
  const router = useRouter();
  const toast = useToast();
  const { t } = useI18n();
  const { fieldErrors, handle, clear } = useApiError();

  const isEdit = Boolean(id);
  const loading = ref(false);
  const submitting = ref(false);

  const form = ref<CreateContractInput>({
    contractNumber: '',
    customerId: '',
    templateId: null,
    buildingArea: 0,
    floors: 1,
    meterPrice: 0,
    expectedProfitMargin: null,
    notes: null,
  });

  async function load() {
    if (!id) return;
    loading.value = true;
    clear();
    try {
      const c = await contractsApi.get(id);
      form.value = {
        contractNumber: c.contractNumber,
        customerId: c.customerId,
        templateId: c.templateId,
        buildingArea: Number(c.buildingArea),
        floors: c.floors,
        meterPrice: Number(c.meterPrice),
        expectedProfitMargin:
          c.expectedProfitMargin !== null ? Number(c.expectedProfitMargin) : null,
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
      if (id) {
        await contractsApi.update(id, form.value);
        toast.success(t('common.saved'));
      } else {
        const created = await contractsApi.create(form.value);
        toast.success(t('common.saved'));
        await router.push(`/contracts/${created.id}`);
      }
    } catch (e) {
      handle(e);
    } finally {
      submitting.value = false;
    }
  }

  function cancel() {
    void router.push('/contracts');
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
