import { ref } from 'vue';
import { aiApi } from '@/services/api/ai.api';
import { ApiError } from '@/types/api';
import type { GuardWarning } from '@/types/ai';

// Soft ceiling for the pre-save advisory check: past it we save without
// warnings rather than make the user wait on a model round-trip.
const SOFT_TIMEOUT_MS = 8_000;

/**
 * Pre-save AI guard — ADVISORY ONLY. The contract with the caller:
 *   - check() returns whatever warnings arrived in time (possibly none);
 *   - any failure or timeout means "no warnings" — saving is never blocked;
 *   - once a result was shown, `shown` latches so the next submit goes
 *     straight through ("حفظ رغم التحذيرات"), except a 400 (incomplete
 *     draft), which lets the form's own validation speak and re-checks later.
 */
export function useSaveGuard(entity: 'cost' | 'payment') {
  const warnings = ref<GuardWarning[]>([]);
  const checking = ref(false);
  const shown = ref(false);

  async function check(payload: Record<string, unknown>): Promise<GuardWarning[]> {
    checking.value = true;
    try {
      const result = await Promise.race([
        entity === 'cost' ? aiApi.guardCost(payload) : aiApi.guardPayment(payload),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), SOFT_TIMEOUT_MS)),
      ]);
      warnings.value = result?.warnings ?? [];
      shown.value = true;
    } catch (e) {
      warnings.value = [];
      // Invalid draft (400) — not "checked": the save's own validation will
      // surface field errors, and the guard retries once the form is valid.
      shown.value = !(e instanceof ApiError && e.statusCode === 400);
    } finally {
      checking.value = false;
    }
    return warnings.value;
  }

  function reset() {
    warnings.value = [];
    shown.value = false;
  }

  return { warnings, checking, shown, check, reset };
}
