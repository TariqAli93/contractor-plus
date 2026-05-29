<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { t } from '@/i18n';
import {
  contractDocxApi,
  documentTemplatesApi,
  generatedDocumentsApi,
} from '@/services/api/document-templates.api';
import { useApiError } from '@/composables/useApiError';
import { useToast } from '@/composables/useToast';
import { useCan } from '@/composables/useCan';
import { RoleName } from '@/types/enums';
import type { DocumentTemplate, GeneratedDocument } from '@/types/document-template';
import DateDisplay from '@/components/shared/DateDisplay.vue';
import RoleGate from '@/components/shared/RoleGate.vue';

// Drop-in panel for the Contract details page. Owns:
//   - listing active CONTRACT templates so the user can pick one
//   - calling /contracts/:id/generate-docx
//   - showing the generated-documents history for this contract
//   - triggering an authenticated download of any past generation
//
// Server is the source of truth — no optimistic insertion of generated
// rows; on success we refetch the history.

const props = defineProps<{ contractId: string }>();

const { handle } = useApiError();
const toast = useToast();
const { can } = useCan();

const GENERATE_ROLES: RoleName[] = [
  RoleName.OWNER,
  RoleName.ADMIN,
  RoleName.ACCOUNTANT,
  RoleName.ENGINEER,
];

const templates = ref<DocumentTemplate[]>([]);
const templatesLoading = ref(false);
const templatesError = ref<unknown>(null);

const history = ref<GeneratedDocument[]>([]);
const historyLoading = ref(false);
const historyError = ref<unknown>(null);

const generating = ref(false);
const downloadingId = ref<string | null>(null);
const selectedTemplateId = ref<string | undefined>(undefined);

async function loadTemplates() {
  templatesLoading.value = true;
  templatesError.value = null;
  try {
    const res = await documentTemplatesApi.list({ category: 'CONTRACT' });
    templates.value = res.items.filter((t1) => t1.isActive);
    // Default selection: the marked-default template if present, otherwise
    // the most recently updated active one.
    const def = templates.value.find((t1) => t1.isDefault);
    selectedTemplateId.value = def?.id ?? templates.value[0]?.id;
  } catch (e) {
    templatesError.value = e;
  } finally {
    templatesLoading.value = false;
  }
}

async function loadHistory() {
  historyLoading.value = true;
  historyError.value = null;
  try {
    const res = await contractDocxApi.listForContract(props.contractId);
    history.value = res.items;
  } catch (e) {
    historyError.value = e;
  } finally {
    historyLoading.value = false;
  }
}

onMounted(async () => {
  await Promise.all([loadTemplates(), loadHistory()]);
});

const templateOptions = computed(() =>
  templates.value.map((t1) => ({
    value: t1.id,
    title: t1.isDefault ? `${t1.name} ★` : t1.name,
  })),
);

const noTemplates = computed(
  () => !templatesLoading.value && templates.value.length === 0 && !templatesError.value,
);

const canGenerate = computed(
  () =>
    can(GENERATE_ROLES) &&
    !generating.value &&
    selectedTemplateId.value !== undefined,
);

async function generate() {
  if (!canGenerate.value) return;
  generating.value = true;
  try {
    const result = await contractDocxApi.generate(props.contractId, selectedTemplateId.value);
    toast.success(t('contracts.docx.generated'));
    // Immediately trigger a download of the just-generated file so the
    // operator's expectation ("click → file appears in Downloads") holds.
    void generatedDocumentsApi.download(result.id, result.filename).catch((e) => handle(e));
    await loadHistory();
  } catch (e) {
    handle(e);
  } finally {
    generating.value = false;
  }
}

async function download(g: GeneratedDocument) {
  if (downloadingId.value) return;
  downloadingId.value = g.id;
  try {
    await generatedDocumentsApi.download(g.id, g.filename);
  } catch (e) {
    handle(e);
  } finally {
    downloadingId.value = null;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
</script>

<template>
  <RoleGate :roles="GENERATE_ROLES">
    <v-card variant="outlined" class="mb-4">
      <v-card-title class="d-flex align-center text-subtitle-1">
        <v-icon icon="mdi-file-word-box-outline" class="me-2" />
        {{ t('contracts.docx.title') }}
        <v-spacer />
      </v-card-title>
      <v-divider />

      <v-card-text class="space-y-4">
        <!-- No templates configured -->
        <v-alert
          v-if="noTemplates"
          type="info"
          variant="tonal"
          density="comfortable"
          class="text-sm"
        >
          {{ t('contracts.docx.noTemplates') }}
          <template #append>
            <v-btn size="small" variant="text" to="/settings">
              {{ t('contracts.docx.openSettings') }}
            </v-btn>
          </template>
        </v-alert>

        <!-- Templates picker + generate button -->
        <div v-else class="flex items-end gap-3 flex-wrap">
          <v-select
            v-model="selectedTemplateId"
            :items="templateOptions"
            :label="t('contracts.docx.template')"
            density="comfortable"
            variant="outlined"
            hide-details
            style="min-width: 260px; flex: 1"
            :disabled="generating"
          />
          <v-btn
            color="primary"
            prepend-icon="mdi-file-download-outline"
            :loading="generating"
            :disabled="!canGenerate"
            @click="generate"
          >
            {{ t('contracts.docx.generate') }}
          </v-btn>
        </div>

        <!-- History -->
        <div v-if="history.length > 0">
          <p class="cp-eyebrow mb-1">{{ t('contracts.docx.history') }}</p>
          <v-table density="compact">
            <thead>
              <tr>
                <th>{{ t('contracts.docx.generatedAt') }}</th>
                <th>{{ t('contracts.docx.templateColumn') }}</th>
                <th>{{ t('contracts.docx.size') }}</th>
                <th class="text-end" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="g in history" :key="g.id">
                <td><DateDisplay :value="g.createdAt" /></td>
                <td>{{ g.templateName }}</td>
                <td class="text-caption text-medium-emphasis">{{ formatSize(g.size) }}</td>
                <td class="text-end">
                  <v-btn
                    size="small"
                    variant="text"
                    prepend-icon="mdi-download"
                    :loading="downloadingId === g.id"
                    @click="download(g)"
                  >
                    {{ t('common.download') }}
                  </v-btn>
                </td>
              </tr>
            </tbody>
          </v-table>
        </div>
        <p v-else-if="!historyLoading" class="text-caption text-medium-emphasis mb-0">
          {{ t('contracts.docx.noHistory') }}
        </p>
      </v-card-text>
    </v-card>
  </RoleGate>
</template>
