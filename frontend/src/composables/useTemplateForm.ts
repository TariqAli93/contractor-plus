import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { t } from '@/i18n';
import { templatesApi } from '@/services/api/templates.api';
import { useApiError } from './useApiError';
import { useToast } from './useToast';
import type { CreateTemplateInput } from '@/types/template';

// Owns the top-level template's general fields only — name, description,
// duration, margin, isActive. Items and steps live in their own tabs and
// own their own state.
//
// CREATE redirects to /templates/<newId> so the user can immediately fill in
// the Materials / Steps tabs. UPDATE stays on the same view with a toast.
export function useTemplateForm(id?: string) {
  const router = useRouter();
  const toast = useToast();
  const { fieldErrors, handle, clear } = useApiError();

  const isEdit = Boolean(id);
  const loading = ref(false);
  const submitting = ref(false);

  const form = ref<CreateTemplateInput>({
    name: '',
    description: null,
    estimatedDurationDays: null,
    suggestedProfitMargin: null,
    isActive: true,
  });

  async function load() {
    if (!id) return;
    loading.value = true;
    clear();
    try {
      const t = await templatesApi.get(id);
      form.value = {
        name: t.name,
        description: t.description,
        estimatedDurationDays: t.estimatedDurationDays,
        suggestedProfitMargin:
          t.suggestedProfitMargin !== null ? Number(t.suggestedProfitMargin) : null,
        isActive: t.isActive,
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
        await templatesApi.update(id, form.value);
        toast.success(t('common.saved'));
      } else {
        const created = await templatesApi.create(form.value);
        toast.success(t('common.saved'));
        await router.push(`/templates/${created.id}`);
      }
    } catch (e) {
      handle(e);
    } finally {
      submitting.value = false;
    }
  }

  function cancel() {
    void router.push('/templates');
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
