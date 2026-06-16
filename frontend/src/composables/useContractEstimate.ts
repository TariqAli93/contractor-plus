import { ref } from 'vue';
import { contractsApi } from '@/services/api/contracts.api';
import { ApiError } from '@/types/api';
import type { ContractEstimate } from '@/types/contract';

// Holds the most recent /generate-estimate response in memory.
// The endpoint is a POST that mutates the contract (replaces items + may
// adopt the template's suggested margin). The frontend shows the returned
// numbers; the contract list/header refetches separately.
export function useContractEstimate(contractId: string) {
  const result = ref<ContractEstimate | null>(null);
  const generating = ref(false);
  const error = ref<ApiError | null>(null);

  async function generate(): Promise<ContractEstimate | null> {
    generating.value = true;
    error.value = null;
    try {
      result.value = await contractsApi.generateEstimate(contractId);
      return result.value;
    } catch (e) {
      error.value = e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', String(e));
      return null;
    } finally {
      generating.value = false;
    }
  }

  return { result, generating, error, generate };
}
