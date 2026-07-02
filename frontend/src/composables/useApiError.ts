import { ref } from 'vue';
import { ApiError } from '@/types/api';
import { friendlyError } from '@/lib/errorMessages';
import { useToast } from './useToast';

// Surfaces a thrown error from an API call:
//  - validation errors are returned as field-level maps (controller assigns to form)
//  - everything else fires a toast with a plain-Arabic "what + how to fix" message
//    (never the raw backend/JS message, which may be technical English).
export function useApiError() {
  const toast = useToast();
  const fieldErrors = ref<Record<string, string[]>>({});

  function handle(err: unknown): { handled: boolean; isValidation: boolean } {
    if (err instanceof ApiError) {
      if (err.isValidation()) {
        fieldErrors.value = err.fieldErrors();
        return { handled: true, isValidation: true };
      }
      toast.error(friendlyError(err), err.reqId);
      return { handled: true, isValidation: false };
    }
    toast.error(friendlyError(err));
    return { handled: false, isValidation: false };
  }

  function clear() {
    fieldErrors.value = {};
  }

  return { fieldErrors, handle, clear };
}
