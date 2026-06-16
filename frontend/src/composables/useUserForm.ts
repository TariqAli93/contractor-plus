import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { t } from '@/i18n';
import { usersApi } from '@/services/api/users.api';
import { RoleName } from '@/types/enums';
import { useApiError } from './useApiError';
import { useToast } from './useToast';

interface UserFormState {
  username: string;
  password: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  roleName: RoleName;
  isActive: boolean;
}

// Owns create/edit form state for a user. On create the full shape is sent; on
// edit, username/password are immutable and excluded from the payload.
export function useUserForm(id?: string) {
  const router = useRouter();
  const toast = useToast();
  const { fieldErrors, handle, clear } = useApiError();

  const isEdit = Boolean(id);
  const loading = ref(false);
  const submitting = ref(false);

  const form = ref<UserFormState>({
    username: '',
    password: '',
    fullName: '',
    email: null,
    phone: null,
    roleName: RoleName.VIEWER,
    isActive: true,
  });

  async function load() {
    if (!id) return;
    loading.value = true;
    clear();
    try {
      const user = await usersApi.get(id);
      form.value = {
        username: user.username,
        password: '',
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        roleName: user.role,
        isActive: user.isActive,
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
        await usersApi.update(id, {
          fullName: form.value.fullName,
          email: form.value.email,
          phone: form.value.phone,
          roleName: form.value.roleName,
          isActive: form.value.isActive,
        });
      } else {
        await usersApi.create({
          username: form.value.username,
          password: form.value.password,
          fullName: form.value.fullName,
          email: form.value.email,
          phone: form.value.phone,
          roleName: form.value.roleName,
          isActive: form.value.isActive,
        });
      }
      toast.success(t('common.saved'));
      await router.push('/users');
    } catch (e) {
      handle(e);
    } finally {
      submitting.value = false;
    }
  }

  function cancel() {
    void router.push('/users');
  }

  return { form, isEdit, loading, submitting, fieldErrors, load, submit, cancel };
}
