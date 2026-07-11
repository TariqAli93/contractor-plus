import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { t } from '@/i18n';
import { customersApi } from '@/services/api/customers.api';
import { useApiError } from './useApiError';
import { useToast } from './useToast';
import type { CreateCustomerInput } from '@/types/customer';

// Owns the form state for the customer create/edit view. The form's shape
// equals CreateCustomerInput byte-for-byte - no DTO translation, the body
// is passed straight to the API.
export function useCustomerForm(id?: string) {
  const router = useRouter();
  const toast = useToast();
  const { fieldErrors, handle, clear } = useApiError();

  const isEdit = Boolean(id);
  const loading = ref(false);
  const submitting = ref(false);

  const form = ref<CreateCustomerInput>({
    name: '',
    phone: null,
    email: null,
    address: null,
    notes: null,
  });

  async function load() {
    if (!id) return;
    loading.value = true;
    clear();
    try {
      const customer = await customersApi.get(id);
      form.value = {
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        address: customer.address,
        notes: customer.notes,
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
        await customersApi.update(id, form.value);
        toast.success(t('common.saved'));
        await router.push('/customers');
      } else {
        await customersApi.create(form.value);
        toast.success(t('common.saved'));
        await router.push('/customers');
      }
    } catch (e) {
      handle(e);
    } finally {
      submitting.value = false;
    }
  }

  function cancel() {
    void router.push('/customers');
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
