import { ref } from 'vue';
import { ApiError } from '@/types/api';
import { useToast } from './useToast';

// Surfaces a thrown error from an API call:
//  - validation errors are returned as field-level maps (controller assigns to form)
//  - everything else fires a toast with the message + reqId
export function useApiError() {
  const toast = useToast();
  const fieldErrors = ref<Record<string, string[]>>({});

  function handle(err: unknown): { handled: boolean; isValidation: boolean } {
    if (err instanceof ApiError) {
      if (err.isValidation()) {
        fieldErrors.value = err.fieldErrors();
        return { handled: true, isValidation: true };
      }
      toast.error(err.message, err.reqId);
      return { handled: true, isValidation: false };
    }
    if (err instanceof Error) {
      toast.error(err.message);
    } else {
      toast.error('Unexpected error');
    }
    return { handled: false, isValidation: false };
  }

  function clear() {
    fieldErrors.value = {};
  }

  return { fieldErrors, handle, clear };
}
