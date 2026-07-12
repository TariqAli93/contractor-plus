import { computed, ref } from 'vue';
import { aiApi } from '@/services/api/ai.api';
import { ApiError } from '@/types/api';
import type { AiReportType, AiStatus, ReportNarrative } from '@/types/ai';

// /ai/status is stable for the whole session, and all four report views mount
// this composable — fetch it once and share (module-level cache).
const status = ref<AiStatus | null>(null);
let statusInFlight: Promise<void> | null = null;

async function ensureStatus(): Promise<void> {
  if (status.value) return;
  statusInFlight ??= aiApi
    .status()
    .then((s) => {
      status.value = s;
    })
    .catch(() => {
      // Unknown status (e.g. offline) — treat as disabled, never break the page.
      status.value = { enabled: false };
    })
    .finally(() => {
      statusInFlight = null;
    });
  return statusInFlight;
}

/**
 * On-demand AI narrative for one report view. The narrative is an OPTIONAL
 * layer: it loads only when the user asks, and any failure stays inside the
 * card — the numeric report is never affected.
 */
export function useAiReports(reportType: AiReportType) {
  const narrative = ref<ReportNarrative | null>(null);
  const loading = ref(false);
  const error = ref<ApiError | null>(null);

  const statusKnown = computed(() => status.value !== null);
  const aiEnabled = computed(() => status.value?.enabled === true);

  void ensureStatus();

  async function generate(filters: Record<string, unknown> = {}): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      narrative.value = await aiApi.reportNarrative(reportType, filters);
    } catch (e) {
      error.value = e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', String(e));
    } finally {
      loading.value = false;
    }
  }

  return { narrative, loading, error, statusKnown, aiEnabled, generate };
}
