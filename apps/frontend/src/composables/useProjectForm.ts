import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { projectsApi } from '@/services/api/projects.api';
import { useApiError } from './useApiError';
import { useToast } from './useToast';
import { toDateInput } from '@/lib/date';
import type { CreateProjectInput } from '@/types/project';

// Owns the General tab form. Mirrors useContractForm. After CREATE, redirects
// to /projects/<newId> so the user lands on the lifecycle workflow.
export function useProjectForm(id?: string) {
  const router = useRouter();
  const toast = useToast();
  const { t } = useI18n();
  const { fieldErrors, handle, clear } = useApiError();

  const isEdit = Boolean(id);
  const loading = ref(false);
  const submitting = ref(false);

  const form = ref<CreateProjectInput>({
    contractId: null,
    name: '',
    startDate: null,
    deliveryDate: null,
    notes: null,
  });

  async function load() {
    if (!id) return;
    loading.value = true;
    clear();
    try {
      const p = await projectsApi.get(id);
      form.value = {
        contractId: p.contractId,
        name: p.name,
        // Native/Vuetify date inputs require `yyyy-MM-dd`; backend returns
        // full ISO timestamps. Normalize on read; empty string == "no value".
        startDate: toDateInput(p.startDate),
        deliveryDate: toDateInput(p.deliveryDate),
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
      // toDateInput returns '' for missing dates; backends z.coerce.date()
      // empty strings as invalid, so normalize back to null before send.
      const emptyToNull = (v: string | Date | null | undefined) =>
        v === '' || v === undefined ? null : v;

      if (id) {
        // Update — contractId is immutable post-creation, omit it from PATCH.
        await projectsApi.update(id, {
          name: form.value.name,
          startDate: emptyToNull(form.value.startDate),
          deliveryDate: emptyToNull(form.value.deliveryDate),
          notes: form.value.notes ?? null,
        });
        toast.success(t('common.saved'));
      } else {
        const created = await projectsApi.create({
          ...form.value,
          startDate: emptyToNull(form.value.startDate),
          deliveryDate: emptyToNull(form.value.deliveryDate),
        });
        toast.success(t('common.saved'));
        await router.push(`/projects/${created.id}`);
      }
    } catch (e) {
      handle(e);
    } finally {
      submitting.value = false;
    }
  }

  function cancel() {
    void router.push('/projects');
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
