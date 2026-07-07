import { computed, ref } from 'vue';
import { estimationTemplatesApi } from '@/services/api/estimationTemplates.api';
import { useApiError } from '@/composables/useApiError';
import { useToast } from '@/composables/useToast';
import { t } from '@/i18n';
import type {
  EstimationGenerateResult,
  EstimationDraftResult,
  EstimationClarificationResult,
  EstimationPreview,
  EstimationMaterialDecision,
  EstimationUpdateItemRequest,
} from '@contractor-plus/shared';

/**
 * Drives the multi-step estimation-builder wizard. The server-persisted draft
 * (keyed by draftId) IS the state — this composable is a thin, error-handled
 * wrapper over the API that keeps the current draft/clarification/preview in
 * sync. All money/quantity math stays on the backend; the UI only displays and
 * forwards edits.
 */
export function useEstimationTemplateBuilder() {
  const { handle } = useApiError();
  const toast = useToast();

  const processing = ref(false);
  const draftId = ref<string | null>(null);
  const draft = ref<EstimationDraftResult | null>(null);
  const clarification = ref<EstimationClarificationResult | null>(null);
  const preview = ref<EstimationPreview | null>(null);
  const rejectedMessage = ref<string | null>(null);

  const needsClarification = computed(() => clarification.value !== null && draft.value === null);
  const hasDraft = computed(() => draft.value !== null);
  const hasPendingMaterials = computed(
    () => draft.value?.items.some((i) => i.resolutionStatus === 'PENDING_APPROVAL') ?? false,
  );

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    processing.value = true;
    rejectedMessage.value = null;
    try {
      return await fn();
    } catch (e) {
      handle(e);
      return undefined;
    } finally {
      processing.value = false;
    }
  }

  function apply(res: EstimationGenerateResult | EstimationDraftResult) {
    if (res.kind === 'rejected') {
      rejectedMessage.value = res.message;
      return;
    }
    draftId.value = res.draftId;
    if (res.kind === 'clarification') {
      clarification.value = res;
      draft.value = null;
    } else {
      draft.value = res;
      clarification.value = null;
    }
  }

  async function generate(command: string, continueDraft = false) {
    const res = await run(() =>
      estimationTemplatesApi.generate(command, continueDraft ? (draftId.value ?? undefined) : undefined),
    );
    if (res) apply(res);
  }

  async function resolveMaterials(decisions: EstimationMaterialDecision[]) {
    if (!draftId.value) return;
    const res = await run(() => estimationTemplatesApi.resolveMaterials(draftId.value!, decisions));
    if (res) apply(res);
  }

  async function updateItem(tempId: string, patch: EstimationUpdateItemRequest) {
    if (!draftId.value) return;
    const res = await run(() => estimationTemplatesApi.updateItem(draftId.value!, tempId, patch));
    if (res) apply(res);
  }

  async function updateWaste(wastePercentage: number) {
    if (!draftId.value) return;
    const res = await run(() => estimationTemplatesApi.updateWaste(draftId.value!, wastePercentage));
    if (res) apply(res);
  }

  async function loadPreview(): Promise<EstimationPreview | undefined> {
    if (!draftId.value) return;
    const res = await run(() => estimationTemplatesApi.preview(draftId.value!));
    if (res) preview.value = res;
    return res;
  }

  /** Returns the new template id on success, or null on rejection/error. */
  async function confirm(templateName: string): Promise<string | null> {
    if (!draftId.value) return null;
    const res = await run(() => estimationTemplatesApi.confirm(draftId.value!, templateName));
    if (!res) return null;
    if (res.kind === 'rejected') {
      rejectedMessage.value = res.message;
      toast.error(res.message);
      return null;
    }
    toast.success(t('estimation.confirmed'));
    return res.templateId;
  }

  async function cancel() {
    if (!draftId.value) return;
    await run(() => estimationTemplatesApi.cancel(draftId.value!));
    reset();
  }

  function reset() {
    draftId.value = null;
    draft.value = null;
    clarification.value = null;
    preview.value = null;
    rejectedMessage.value = null;
  }

  return {
    processing,
    draftId,
    draft,
    clarification,
    preview,
    rejectedMessage,
    needsClarification,
    hasDraft,
    hasPendingMaterials,
    generate,
    resolveMaterials,
    updateItem,
    updateWaste,
    loadPreview,
    confirm,
    cancel,
    reset,
  };
}
